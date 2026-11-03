from __future__ import annotations

import csv
import json
import math
import os
import shutil
import zipfile
from abc import ABC, abstractmethod
from collections import Counter
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .models import Artifact, ContentUnit, SourceBundle, SourceLocator
from .materialization import MaterializationPlan, MaterializationScheduler, MaterializationWorkResult, MaterializationWorkUnit, adaptive_chunk_size, adaptive_worker_capacity
from .util import media_type, read_json, relative, sha256_file, stable_id, write_json


def _range_work_units(total: int, kind: str, path: Path, config: Any, memory_mb: int = 64) -> tuple[int, list[MaterializationWorkUnit]]:
    worker_limit = config.materialization_workers or adaptive_worker_capacity("process")
    chunk_size = adaptive_chunk_size(total, worker_limit, config.materialization_chunk_size)
    units = []
    for ordinal, start in enumerate(range(0, total, chunk_size), 1):
        end = min(total, start + chunk_size)
        units.append(MaterializationWorkUnit(work_unit_id=f"{kind}-{start + 1:08d}-{end:08d}", ordinal=ordinal, kind=kind, start=start, end=end, estimated_bytes=max(1, path.stat().st_size * (end - start) // max(1, total)), estimated_memory_mb=memory_mb))
    return chunk_size, units


def _discovery_chunk(root: Path, unit: MaterializationWorkUnit, value: Any) -> str:
    target = root / "stages" / "materialization" / "discovery" / f"{unit.work_unit_id}.json"
    write_json(target, value)
    return relative(target, root)


class SourceAdapter(ABC):
    suffixes: set[str] = set()

    def supports(self, path: Path) -> bool:
        return path.suffix.lower() in self.suffixes

    @abstractmethod
    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle: ...

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        unit = MaterializationWorkUnit(work_unit_id="unit-000001", ordinal=1, kind="file", start=0, end=1, estimated_bytes=path.stat().st_size, estimated_memory_mb=max(64, min(512, math.ceil(path.stat().st_size / (1024 * 1024)) * 2)))
        return MaterializationPlan(source_id=source_id, adapter=type(self).__name__, work_unit_kind="file", total_native_units=1, estimated_work=path.stat().st_size, preferred_backend="sequential", chunk_size=1, work_units=[unit])

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        return {"bundle": self.materialize(path, root, source_id).model_dump(mode="json")}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        if len(results) != 1 or "bundle" not in results[0].output:
            raise ValueError(f"{type(self).__name__} expected one complete bundle work result")
        return SourceBundle.model_validate(results[0].output["bundle"])

    def _base(self, path: Path, root: Path, source_id: str, adapter: str) -> tuple[Path, SourceBundle]:
        source_root = root / "sources" / source_id
        original = source_root / "original" / path.name
        original.parent.mkdir(parents=True, exist_ok=True)
        if not original.exists() or sha256_file(original) != sha256_file(path):
            shutil.copy2(path, original)
        checksum = sha256_file(original)
        artifact = Artifact(artifact_id=f"{source_id}:original", kind="source", media_type=media_type(path), path=relative(original, root), sha256=checksum)
        bundle = SourceBundle(source_id=source_id, original_path=relative(original, root), filename=path.name, media_type=media_type(path), sha256=checksum, size_bytes=path.stat().st_size, adapter=adapter, artifacts=[artifact])
        return source_root, bundle


class TextAdapter(SourceAdapter):
    suffixes = {".txt", ".md", ".html", ".htm", ".xml"}

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        # Count first, then stream into bounded discovery chunks. This keeps
        # discovery memory independent of the size of the input document.
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            line_count = sum(1 for _ in handle)
        chunk_size, units = _range_work_units(max(1, line_count), "lines", path, config, 32)
        unit_iter = iter(units)
        current = next(unit_iter, None)
        buffer: list[str] = []
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            for line_index, line in enumerate(handle):
                if current is None:
                    break
                buffer.append(line)
                if line_index + 1 == current.end:
                    current.payload["chunk_path"] = _discovery_chunk(root, current, {"text": "".join(buffer)})
                    buffer = []
                    current = next(unit_iter, None)
        # Empty files still have one schedulable unit.
        if current is not None:
            current.payload["chunk_path"] = _discovery_chunk(root, current, {"text": "".join(buffer)})
        return MaterializationPlan(source_id=source_id, adapter="text", work_unit_kind="line_range", total_native_units=line_count, estimated_work=path.stat().st_size, preferred_backend="thread", chunk_size=chunk_size, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        return {"start": unit.start, "text": read_json(root / unit.payload["chunk_path"])["text"]}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        _, bundle = self._base(path, root, source_id, "text")
        text = "".join(result.output["text"] for result in sorted(results, key=lambda item: item.ordinal))
        # splitlines cannot preserve the absence of a final newline for an empty
        # final segment; use the source as the canonical byte-decoded value.
        canonical = path.read_text(encoding="utf-8", errors="replace")
        if text != canonical:
            text = canonical
        locator = SourceLocator(kind="file", artifact_id=bundle.artifacts[0].artifact_id, unit_id=f"{source_id}:text")
        bundle.units.append(ContentUnit(unit_id=f"{source_id}:text", artifact_id=locator.artifact_id, kind="text", sequence=1, text=text, locator=locator))
        bundle.capabilities = ["read_text", "search"]
        return bundle

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "text")
        text = path.read_text(encoding="utf-8", errors="replace")
        locator = SourceLocator(kind="file", artifact_id=bundle.artifacts[0].artifact_id, unit_id=f"{source_id}:text")
        bundle.units.append(ContentUnit(unit_id=f"{source_id}:text", artifact_id=locator.artifact_id, kind="text", sequence=1, text=text, locator=locator))
        bundle.capabilities = ["read_text", "search"]
        return bundle


class JSONAdapter(SourceAdapter):
    suffixes = {".json", ".geojson"}

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        data = json.loads(path.read_text(encoding="utf-8"))
        features = data.get("features") if isinstance(data, dict) else None
        total = len(features) if isinstance(features, list) else 1
        chunk_size, units = _range_work_units(max(1, total), "json-records", path, config, 96)
        for unit in units:
            unit.payload["feature_collection"] = isinstance(features, list)
            value = {"features": features[unit.start or 0:unit.end]} if isinstance(features, list) else {"data": data}
            unit.payload["chunk_path"] = _discovery_chunk(root, unit, value)
        return MaterializationPlan(source_id=source_id, adapter="json", work_unit_kind="json_records", total_native_units=total, estimated_work=path.stat().st_size, preferred_backend="process" if total > 1 else "sequential", chunk_size=chunk_size, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        value = read_json(root / unit.payload["chunk_path"])
        return value | ({"start": unit.start or 0} if unit.payload.get("feature_collection") else {})

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "json")
        feature_mode = bool(plan.work_units and plan.work_units[0].payload.get("feature_collection"))
        if feature_mode:
            features = [feature for result in sorted(results, key=lambda item: item.ordinal) for feature in result.output.get("features", [])]
            original = json.loads(path.read_text(encoding="utf-8"))
            data = dict(original)
            data["features"] = features
        else:
            data = results[0].output["data"]
            features = None
        normalized = source_root / "derived" / "normalized.json"
        write_json(normalized, data)
        aid = f"{source_id}:json"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="structured_data", media_type="application/json", path=relative(normalized, root), sha256=sha256_file(normalized)))
        if isinstance(features, list):
            bundle.spatial_assets.append({"asset_id": f"{source_id}:features", "artifact_id": aid, "geometry_type_counts": dict(Counter(str((f.get("geometry") or {}).get("type")) for f in features if isinstance(f, dict))), "feature_count": len(features), "source_path": relative(normalized, root)})
            for idx, feature in enumerate(features):
                text = json.dumps({"id": feature.get("id"), "properties": feature.get("properties"), "geometry_type": (feature.get("geometry") or {}).get("type")}, ensure_ascii=False, default=str)
                uid = f"{source_id}:feature:{idx + 1}"
                bundle.units.append(ContentUnit(unit_id=uid, artifact_id=aid, kind="geojson_feature", sequence=idx + 1, text=text, locator=SourceLocator(kind="json_pointer", artifact_id=aid, unit_id=uid, json_pointer=f"/features/{idx}")))
        else:
            text = json.dumps(data, ensure_ascii=False, default=str)
            bundle.units.append(ContentUnit(unit_id=f"{source_id}:json", artifact_id=aid, kind="json", sequence=1, text=text, locator=SourceLocator(kind="json_pointer", artifact_id=aid, unit_id=f"{source_id}:json", json_pointer="/")))
        bundle.capabilities = ["read_records", "read_metadata", "query_records"]
        return bundle

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "json")
        data = json.loads(path.read_text(encoding="utf-8"))
        normalized = source_root / "derived" / "normalized.json"
        write_json(normalized, data)
        aid = f"{source_id}:json"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="structured_data", media_type="application/json", path=relative(normalized, root), sha256=sha256_file(normalized)))
        features = data.get("features") if isinstance(data, dict) else None
        if isinstance(features, list):
            bundle.spatial_assets.append({"asset_id": f"{source_id}:features", "artifact_id": aid, "geometry_type_counts": dict(Counter(str((f.get("geometry") or {}).get("type")) for f in features if isinstance(f, dict))), "feature_count": len(features), "source_path": relative(normalized, root)})
            for idx, feature in enumerate(features):
                text = json.dumps({"id": feature.get("id"), "properties": feature.get("properties"), "geometry_type": (feature.get("geometry") or {}).get("type")}, ensure_ascii=False, default=str)
                uid = f"{source_id}:feature:{idx + 1}"
                bundle.units.append(ContentUnit(unit_id=uid, artifact_id=aid, kind="geojson_feature", sequence=idx + 1, text=text, locator=SourceLocator(kind="json_pointer", artifact_id=aid, unit_id=uid, json_pointer=f"/features/{idx}")))
        else:
            text = json.dumps(data, ensure_ascii=False, default=str)
            bundle.units.append(ContentUnit(unit_id=f"{source_id}:json", artifact_id=aid, kind="json", sequence=1, text=text, locator=SourceLocator(kind="json_pointer", artifact_id=aid, unit_id=f"{source_id}:json", json_pointer="/")))
        bundle.capabilities = ["read_records", "read_metadata", "query_records"]
        return bundle


class CSVAdapter(SourceAdapter):
    suffixes = {".csv", ".tsv"}

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=delimiter)
            fieldnames = list(reader.fieldnames or [])
            total = sum(1 for _ in reader)
        chunk_size, units = _range_work_units(max(1, total), "csv-rows", path, config, 64)
        for unit in units:
            unit.payload["delimiter"] = delimiter
            unit.payload["empty"] = total == 0
        unit_iter = iter(units)
        current = next(unit_iter, None)
        rows: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=delimiter)
            for row_index, row in enumerate(reader):
                if current is None:
                    break
                rows.append(row)
                if row_index + 1 == current.end:
                    current.payload["chunk_path"] = _discovery_chunk(root, current, {"rows": rows, "fieldnames": fieldnames})
                    rows = []
                    current = next(unit_iter, None)
        if current is not None:
            current.payload["chunk_path"] = _discovery_chunk(root, current, {"rows": rows, "fieldnames": fieldnames})
        return MaterializationPlan(source_id=source_id, adapter="csv", work_unit_kind="csv_rows", total_native_units=total, estimated_work=path.stat().st_size, preferred_backend="thread", chunk_size=chunk_size, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        return read_json(root / unit.payload["chunk_path"])

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "csv")
        ordered = sorted(results, key=lambda item: item.ordinal)
        rows = [row for result in ordered for row in result.output["rows"]]
        columns = next((result.output["fieldnames"] for result in ordered if result.output.get("fieldnames")), [])
        normalized = source_root / "derived" / "records.json"
        write_json(normalized, rows)
        aid = f"{source_id}:records"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="table", media_type="application/json", path=relative(normalized, root), sha256=sha256_file(normalized), metadata={"row_count": len(rows), "columns": columns}))
        bundle.structured_assets.append({"asset_id": aid, "kind": "table", "row_count": len(rows), "columns": columns, "path": relative(normalized, root)})
        for idx, row in enumerate(rows):
            uid = f"{source_id}:row:{idx + 2}"
            bundle.units.append(ContentUnit(unit_id=uid, artifact_id=aid, kind="table_row", sequence=idx + 1, text=json.dumps(row, ensure_ascii=False), locator=SourceLocator(kind="table_row", artifact_id=aid, unit_id=uid, row=idx + 2)))
        bundle.capabilities = ["read_records", "query_records"]
        return bundle

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "csv")
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
            rows = list(csv.DictReader(handle, delimiter=delimiter))
        normalized = source_root / "derived" / "records.json"
        write_json(normalized, rows)
        aid = f"{source_id}:records"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="table", media_type="application/json", path=relative(normalized, root), sha256=sha256_file(normalized), metadata={"row_count": len(rows), "columns": list(rows[0]) if rows else []}))
        bundle.structured_assets.append({"asset_id": aid, "kind": "table", "row_count": len(rows), "columns": list(rows[0]) if rows else [], "path": relative(normalized, root)})
        for idx, row in enumerate(rows):
            uid = f"{source_id}:row:{idx + 2}"
            bundle.units.append(ContentUnit(unit_id=uid, artifact_id=aid, kind="table_row", sequence=idx + 1, text=json.dumps(row, ensure_ascii=False), locator=SourceLocator(kind="table_row", artifact_id=aid, unit_id=uid, row=idx + 2)))
        bundle.capabilities = ["read_records", "query_records"]
        return bundle


class ExcelAdapter(SourceAdapter):
    suffixes = {".xlsx", ".xlsm"}

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        from openpyxl import load_workbook
        workbook = load_workbook(path, read_only=True, data_only=False)
        units = []
        for index, sheet in enumerate(workbook.worksheets, 1):
            units.append(MaterializationWorkUnit(work_unit_id=f"sheet-{index:06d}", ordinal=index, kind="excel_sheet", start=index - 1, end=index, estimated_bytes=max(1, path.stat().st_size // max(1, len(workbook.worksheets))), estimated_memory_mb=max(64, min(1024, math.ceil(max(1, sheet.max_row * sheet.max_column) / 5000) * 32)), payload={"sheet_index": index - 1, "sheet_title": sheet.title}))
        workbook.close()
        return MaterializationPlan(source_id=source_id, adapter="excel", work_unit_kind="excel_sheet", total_native_units=len(units), estimated_work=sum(unit.estimated_bytes for unit in units), preferred_backend="process" if len(units) > 1 else "sequential", chunk_size=1, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        from openpyxl import load_workbook
        workbook = load_workbook(path, data_only=False, read_only=False)
        sheet = workbook.worksheets[unit.payload["sheet_index"]]
        rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
        result = {"sheet_index": unit.payload["sheet_index"] + 1, "title": sheet.title, "rows": rows, "merged_ranges": [str(x) for x in sheet.merged_cells.ranges], "max_row": sheet.max_row, "max_column": sheet.max_column}
        workbook.close()
        return {"sheet": result}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "excel")
        for result in sorted(results, key=lambda item: item.ordinal):
            sheet = result.output["sheet"]
            sheet_index = sheet["sheet_index"]
            target = source_root / "derived" / "sheets" / f"{sheet_index:03d}.json"
            write_json(target, {"title": sheet["title"], "rows": sheet["rows"], "merged_ranges": sheet["merged_ranges"]})
            aid = f"{source_id}:sheet:{sheet_index}"
            bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="spreadsheet_sheet", media_type="application/json", path=relative(target, root), sha256=sha256_file(target), metadata={"sheet": sheet["title"], "rows": sheet["max_row"], "columns": sheet["max_column"]}))
            bundle.structured_assets.append({"asset_id": aid, "kind": "spreadsheet_sheet", "sheet": sheet["title"], "row_count": sheet["max_row"], "column_count": sheet["max_column"], "path": relative(target, root)})
            for row_index, values in enumerate(sheet["rows"], 1):
                if not any(value is not None for value in values):
                    continue
                uid = f"{source_id}:sheet:{sheet_index}:row:{row_index}"
                final_column = self._excel_column(max(1, sheet["max_column"]))
                bundle.units.append(ContentUnit(unit_id=uid, artifact_id=aid, kind="spreadsheet_row", sequence=len(bundle.units) + 1, text=json.dumps(values, ensure_ascii=False, default=str), locator=SourceLocator(kind="spreadsheet_range", artifact_id=aid, unit_id=uid, sheet=sheet["title"], cell_range=f"A{row_index}:{final_column}{row_index}")))
        bundle.capabilities = ["read_records", "read_formulas", "query_records"]
        return bundle

    @staticmethod
    def _excel_column(index: int) -> str:
        value = ""
        while index:
            index, remainder = divmod(index - 1, 26)
            value = chr(65 + remainder) + value
        return value

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        from openpyxl import load_workbook
        source_root, bundle = self._base(path, root, source_id, "excel")
        workbook = load_workbook(path, data_only=False, read_only=False)
        for sheet_index, sheet in enumerate(workbook.worksheets, 1):
            rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
            target = source_root / "derived" / "sheets" / f"{sheet_index:03d}.json"
            write_json(target, {"title": sheet.title, "rows": rows, "merged_ranges": [str(x) for x in sheet.merged_cells.ranges]})
            aid = f"{source_id}:sheet:{sheet_index}"
            bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="spreadsheet_sheet", media_type="application/json", path=relative(target, root), sha256=sha256_file(target), metadata={"sheet": sheet.title, "rows": sheet.max_row, "columns": sheet.max_column}))
            bundle.structured_assets.append({"asset_id": aid, "kind": "spreadsheet_sheet", "sheet": sheet.title, "row_count": sheet.max_row, "column_count": sheet.max_column, "path": relative(target, root)})
            for row_index, values in enumerate(rows, 1):
                if not any(value is not None for value in values):
                    continue
                uid = f"{source_id}:sheet:{sheet_index}:row:{row_index}"
                bundle.units.append(ContentUnit(unit_id=uid, artifact_id=aid, kind="spreadsheet_row", sequence=len(bundle.units) + 1, text=json.dumps(values, ensure_ascii=False, default=str), locator=SourceLocator(kind="spreadsheet_range", artifact_id=aid, unit_id=uid, sheet=sheet.title, cell_range=f"A{row_index}:{sheet.cell(row_index, max(1, sheet.max_column)).coordinate}")))
        bundle.capabilities = ["read_records", "read_formulas", "query_records"]
        return bundle


def _xml_local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _xml_children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _xml_local_name(child) == name]


def _xml_first_text(element: ET.Element, name: str) -> str:
    child = next((item for item in element if _xml_local_name(item) == name), None)
    return (child.text or "").strip() if child is not None else ""


def _kml_coordinates(text: str | None, comma_separated: bool = True) -> list[list[float]]:
    coordinates: list[list[float]] = []
    if not text:
        return coordinates
    values = text.split()
    for value in values:
        parts = value.split(",") if comma_separated else value.split()
        try:
            coordinate = [float(part) for part in parts if part != ""]
        except ValueError:
            continue
        if len(coordinate) >= 2:
            coordinates.append(coordinate)
    return coordinates


def _kml_geometry(element: ET.Element) -> tuple[dict[str, Any] | None, list[str]]:
    """Convert one KML geometry recursively without assuming a namespace."""
    kind = _xml_local_name(element)
    if kind in {"Point", "LineString", "LinearRing"}:
        coordinate_element = next((child for child in element.iter() if _xml_local_name(child) == "coordinates"), None)
        coordinates = _kml_coordinates(coordinate_element.text if coordinate_element is not None else None)
        if not coordinates:
            return None, [kind]
        if kind == "Point":
            return {"type": "Point", "coordinates": coordinates[0]}, [kind]
        # GeoJSON has no standalone LinearRing. Preserve it as a closed
        # LineString and retain the source KML type in feature properties.
        if kind == "LinearRing" and coordinates[0] != coordinates[-1]:
            coordinates.append(list(coordinates[0]))
        return {"type": "LineString", "coordinates": coordinates}, [kind]
    if kind == "Polygon":
        rings: list[list[list[float]]] = []
        source_types = [kind]
        for boundary_name in ("outerBoundaryIs", "innerBoundaryIs"):
            for boundary in _xml_children(element, boundary_name):
                ring = next((child for child in boundary.iter() if _xml_local_name(child) == "LinearRing"), None)
                if ring is None:
                    continue
                geometry, types = _kml_geometry(ring)
                source_types.extend(types)
                if geometry and geometry["coordinates"]:
                    rings.append(geometry["coordinates"])
        return ({"type": "Polygon", "coordinates": rings} if rings else None), source_types
    if kind == "MultiGeometry":
        geometries: list[dict[str, Any]] = []
        source_types = [kind]
        for child in element:
            if _xml_local_name(child) not in {"Point", "LineString", "LinearRing", "Polygon", "MultiGeometry", "Track", "MultiTrack"}:
                continue
            geometry, types = _kml_geometry(child)
            source_types.extend(types)
            if geometry:
                geometries.append(geometry)
        return ({"type": "GeometryCollection", "geometries": geometries} if geometries else None), source_types
    if kind == "Track":
        coordinates = []
        for child in element.iter():
            if _xml_local_name(child) != "coord" or not child.text:
                continue
            try:
                coordinate = [float(part) for part in child.text.split()]
            except ValueError:
                continue
            if len(coordinate) >= 2:
                coordinates.append(coordinate)
        return ({"type": "LineString", "coordinates": coordinates} if coordinates else None), [kind]
    if kind == "MultiTrack":
        lines: list[list[list[float]]] = []
        source_types = [kind]
        for track in element:
            if _xml_local_name(track) != "Track":
                continue
            geometry, types = _kml_geometry(track)
            source_types.extend(types)
            if geometry:
                lines.append(geometry["coordinates"])
        return ({"type": "MultiLineString", "coordinates": lines} if lines else None), source_types
    return None, []


def _kml_placemark_feature(placemark: ET.Element, ordinal: int) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    for name in ("name", "description", "styleUrl", "address", "phoneNumber", "visibility", "open", "Snippet"):
        value = _xml_first_text(placemark, name)
        if value != "":
            properties[name] = value
    if placemark.attrib:
        properties["kml_attributes"] = dict(placemark.attrib)
    extended: dict[str, Any] = {}
    display_names: dict[str, str] = {}
    for item in placemark.iter():
        kind = _xml_local_name(item)
        if kind == "Data":
            key = item.attrib.get("name")
            if not key:
                continue
            value = next((child.text for child in item if _xml_local_name(child) == "value"), None)
            display = next((child.text for child in item if _xml_local_name(child) == "displayName"), None)
            extended[key] = value
            if display:
                display_names[key] = display
        elif kind == "SimpleData" and item.attrib.get("name"):
            extended[item.attrib["name"]] = item.text
    if extended:
        properties["extended_data"] = extended
    if display_names:
        properties["extended_data_display_names"] = display_names
    for temporal in placemark:
        kind = _xml_local_name(temporal)
        if kind in {"TimeStamp", "TimeSpan"}:
            properties[kind] = {_xml_local_name(child): (child.text or "").strip() for child in temporal}

    geometries: list[dict[str, Any]] = []
    source_types: list[str] = []
    geometry_names = {"Point", "LineString", "LinearRing", "Polygon", "MultiGeometry", "Track", "MultiTrack"}
    for child in placemark:
        if _xml_local_name(child) not in geometry_names:
            continue
        geometry, types = _kml_geometry(child)
        source_types.extend(types)
        if geometry:
            geometries.append(geometry)
    geometry = geometries[0] if len(geometries) == 1 else {"type": "GeometryCollection", "geometries": geometries} if geometries else None
    if source_types:
        properties["kml_geometry_types"] = source_types
    feature_id = placemark.attrib.get("id") or f"placemark-{ordinal}"
    return {"type": "Feature", "id": feature_id, "properties": properties, "geometry": geometry}


def _geojson_component_counts(geometry: dict[str, Any] | None, counts: Counter[str]) -> None:
    if not geometry:
        counts["None"] += 1
        return
    kind = str(geometry.get("type"))
    counts[kind] += 1
    if kind == "GeometryCollection":
        for child in geometry.get("geometries", []):
            _geojson_component_counts(child, counts)


class KMLAdapter(SourceAdapter):
    suffixes = {".kml", ".kmz"}

    def _raw_kml(self, path: Path) -> bytes:
        if path.suffix.lower() == ".kmz":
            with zipfile.ZipFile(path) as archive:
                names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
                if not names:
                    raise ValueError("KMZ contains no KML")
                return archive.read(names[0])
        return path.read_bytes()

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        xml_root = ET.fromstring(self._raw_kml(path))
        placemarks = [element for element in xml_root.iter() if _xml_local_name(element) == "Placemark"]
        total = len(placemarks)
        chunk_size, units = _range_work_units(max(1, total), "kml-placemarks", path, config, 128)
        for unit in units:
            unit.payload["empty"] = total == 0
            serialized = [ET.tostring(item, encoding="unicode") for item in placemarks[unit.start or 0:unit.end]]
            unit.payload["chunk_path"] = _discovery_chunk(root, unit, {"placemarks": serialized})
        return MaterializationPlan(source_id=source_id, adapter="kml", work_unit_kind="kml_placemarks", total_native_units=total, estimated_work=path.stat().st_size, preferred_backend="process" if total > 1 else "sequential", chunk_size=chunk_size, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        if unit.payload.get("empty"):
            return {"features": []}
        serialized = read_json(root / unit.payload["chunk_path"])["placemarks"]
        placemarks = [ET.fromstring(item) for item in serialized]
        features = [_kml_placemark_feature(placemark, offset + 1) for offset, placemark in enumerate(placemarks, unit.start or 0)]
        return {"features": features}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "kml")
        features = [feature for result in sorted(results, key=lambda item: item.ordinal) for feature in result.output["features"]]
        collection = {"type": "FeatureCollection", "features": features}
        target = source_root / "derived" / "features.geojson"
        write_json(target, collection)
        aid = f"{source_id}:features"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="vector_features", media_type="application/geo+json", path=relative(target, root), sha256=sha256_file(target), metadata={"feature_count": len(features)}))
        geometry_counts = dict(Counter(str((f.get("geometry") or {}).get("type")) for f in features))
        component_counts: Counter[str] = Counter()
        for feature in features:
            _geojson_component_counts(feature.get("geometry"), component_counts)
        bundle.spatial_assets.append({"asset_id": aid, "kind": "vector_features", "feature_count": len(features), "geometry_type_counts": geometry_counts, "geometry_component_type_counts": dict(component_counts), "path": relative(target, root)})
        sample_size = min(100, len(features))
        stride = max(1, len(features) // max(1, sample_size))
        sampled = features[::stride][:sample_size]
        profile_uid = f"{source_id}:collection-profile"
        profile = {"asset_id": aid, "feature_count": len(features), "geometry_type_counts": geometry_counts, "geometry_component_type_counts": dict(component_counts), "sample_features": [{"id": f["id"], "properties": f["properties"], "geometry_type": (f.get("geometry") or {}).get("type")} for f in sampled]}
        bundle.units.append(ContentUnit(unit_id=profile_uid, artifact_id=aid, kind="vector_collection_profile", sequence=1, text=json.dumps(profile, ensure_ascii=False), locator=SourceLocator(kind="file", artifact_id=aid, unit_id=profile_uid)))
        bundle.capabilities = ["read_geometry", "read_records", "query_records", "render_preview"]
        return bundle

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "kml")
        if path.suffix.lower() == ".kmz":
            with zipfile.ZipFile(path) as archive:
                names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
                if not names:
                    raise ValueError("KMZ contains no KML")
                raw = archive.read(names[0])
        else:
            raw = path.read_bytes()
        xml_root = ET.fromstring(raw)
        placemarks = [element for element in xml_root.iter() if _xml_local_name(element) == "Placemark"]
        features = [_kml_placemark_feature(placemark, index) for index, placemark in enumerate(placemarks, 1)]
        collection = {"type": "FeatureCollection", "features": features}
        target = source_root / "derived" / "features.geojson"
        write_json(target, collection)
        aid = f"{source_id}:features"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="vector_features", media_type="application/geo+json", path=relative(target, root), sha256=sha256_file(target), metadata={"feature_count": len(features)}))
        geometry_counts = dict(Counter(str((f.get("geometry") or {}).get("type")) for f in features))
        component_counts: Counter[str] = Counter()
        for feature in features:
            _geojson_component_counts(feature.get("geometry"), component_counts)
        bundle.spatial_assets.append({"asset_id": aid, "kind": "vector_features", "feature_count": len(features), "geometry_type_counts": geometry_counts, "geometry_component_type_counts": dict(component_counts), "path": relative(target, root)})
        # The complete geometry collection is preserved above. The model needs
        # the collection profile and a bounded semantic sample, not 100k
        # repetitive coordinate-bearing records copied into its context.
        sample_size = min(100, len(features))
        stride = max(1, len(features) // max(1, sample_size))
        sampled = features[::stride][:sample_size]
        profile_uid = f"{source_id}:collection-profile"
        profile = {"asset_id": aid, "feature_count": len(features), "geometry_type_counts": geometry_counts, "geometry_component_type_counts": dict(component_counts), "sample_features": [{"id": f["id"], "properties": f["properties"], "geometry_type": (f.get("geometry") or {}).get("type")} for f in sampled]}
        bundle.units.append(ContentUnit(unit_id=profile_uid, artifact_id=aid, kind="vector_collection_profile", sequence=1, text=json.dumps(profile, ensure_ascii=False), locator=SourceLocator(kind="file", artifact_id=aid, unit_id=profile_uid)))
        bundle.capabilities = ["read_geometry", "read_records", "query_records", "render_preview"]
        return bundle


class ImageAdapter(SourceAdapter):
    suffixes = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        from PIL import Image
        with Image.open(path) as image:
            frames = int(getattr(image, "n_frames", 1))
            width, height = image.size
        units = [MaterializationWorkUnit(work_unit_id=f"frame-{index + 1:06d}", ordinal=index + 1, kind="image_frame", start=index, end=index + 1, estimated_bytes=max(1, path.stat().st_size // frames), estimated_memory_mb=max(32, math.ceil(width * height * 4 / (1024 * 1024))), payload={"frame": index}) for index in range(frames)]
        return MaterializationPlan(source_id=source_id, adapter="image", work_unit_kind="image_frame", total_native_units=frames, estimated_work=width * height * frames, preferred_backend="process" if frames > 1 else "sequential", chunk_size=1, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        from PIL import Image
        with Image.open(path) as image:
            image.seek(unit.payload["frame"])
            return {"frame": unit.payload["frame"], "width": image.width, "height": image.height, "format": image.format, "mode": image.mode}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        _, bundle = self._base(path, root, source_id, "image")
        frames = [result.output for result in sorted(results, key=lambda item: item.ordinal)]
        first = frames[0]
        bundle.artifacts[0].metadata.update({"width": first["width"], "height": first["height"], "format": first["format"], "mode": first["mode"], "frame_count": len(frames)})
        bundle.visual_assets.append({"visual_id": bundle.artifacts[0].artifact_id, "kind": "image", "artifact_id": bundle.artifacts[0].artifact_id, "path": bundle.original_path, "status": "pending_inspection", "frame_count": len(frames)})
        bundle.units.append(ContentUnit(unit_id=f"{source_id}:image", artifact_id=bundle.artifacts[0].artifact_id, kind="image", sequence=1, text="", locator=SourceLocator(kind="image", artifact_id=bundle.artifacts[0].artifact_id, unit_id=f"{source_id}:image"), artifact_refs=[bundle.artifacts[0].artifact_id]))
        bundle.capabilities = ["inspect_visual", "read_metadata"]
        return bundle

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        from PIL import Image
        _, bundle = self._base(path, root, source_id, "image")
        with Image.open(path) as image:
            bundle.artifacts[0].metadata.update({"width": image.width, "height": image.height, "format": image.format})
        bundle.visual_assets.append({"visual_id": bundle.artifacts[0].artifact_id, "kind": "image", "artifact_id": bundle.artifacts[0].artifact_id, "path": bundle.original_path, "status": "pending_inspection"})
        bundle.units.append(ContentUnit(unit_id=f"{source_id}:image", artifact_id=bundle.artifacts[0].artifact_id, kind="image", sequence=1, text="", locator=SourceLocator(kind="image", artifact_id=bundle.artifacts[0].artifact_id, unit_id=f"{source_id}:image"), artifact_refs=[bundle.artifacts[0].artifact_id]))
        bundle.capabilities = ["inspect_visual", "read_metadata"]
        return bundle


class PDFAdapter(SourceAdapter):
    suffixes = {".pdf"}

    def __init__(self, render_dpi: int = 130):
        self.render_dpi = render_dpi

    def discover(self, path: Path, root: Path, source_id: str, config: Any) -> MaterializationPlan:
        import pymupdf
        with pymupdf.open(path) as document:
            page_count = document.page_count
        worker_limit = config.materialization_workers or adaptive_worker_capacity("process")
        chunk_size = adaptive_chunk_size(page_count, worker_limit, config.materialization_chunk_size)
        units = []
        for ordinal, start in enumerate(range(0, page_count, chunk_size), 1):
            end = min(page_count, start + chunk_size)
            units.append(MaterializationWorkUnit(work_unit_id=f"pages-{start + 1:06d}-{end:06d}", ordinal=ordinal, kind="pdf_page_range", start=start, end=end, estimated_bytes=max(1, path.stat().st_size * (end - start) // max(1, page_count)), estimated_memory_mb=max(96, int(self.render_dpi * self.render_dpi / 100))))
        return MaterializationPlan(source_id=source_id, adapter="pymupdf", work_unit_kind="pdf_page_range", total_native_units=page_count, estimated_work=path.stat().st_size * max(1, page_count), preferred_backend="process", chunk_size=chunk_size, work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict[str, Any]:
        import pymupdf
        source_root = root / "sources" / source_id
        text_root = source_root / "derived" / "text"
        page_root = source_root / "derived" / "pages"
        render_root = source_root / "derived" / "renders"
        table_root = source_root / "derived" / "tables"
        original_aid = f"{source_id}:original"
        pages: list[dict[str, Any]] = []
        with pymupdf.open(path) as document:
            for zero_index in range(unit.start or 0, unit.end or 0):
                index = zero_index + 1
                page = document[zero_index]
                text = page.get_text("text") or ""
                blocks = page.get_text("blocks") or []
                # Compact drawings are materially faster to enumerate and are
                # sufficient because downstream logic only needs their count.
                drawings = page.get_cdrawings()
                images = page.get_images(full=True)
                text_path = text_root / f"page_{index:04d}.txt"
                text_path.parent.mkdir(parents=True, exist_ok=True)
                text_path.write_text(text, encoding="utf-8")
                table_ids: list[str] = []
                artifacts: list[dict[str, Any]] = []
                units: list[dict[str, Any]] = []
                structured_assets: list[dict[str, Any]] = []
                visual_assets: list[dict[str, Any]] = []
                diagnostics: list[dict[str, Any]] = []
                # PyMuPDF's default table strategy is line-based. Avoid its
                # expensive intersection analysis only when the display list
                # cannot contain the four geometric boundaries of even one
                # cell. Rectangles contribute four boundaries.
                boundary_count = sum(4 if item[0] in {"re", "qu"} else 1 if item[0] == "l" else 0 for drawing in drawings for item in drawing.get("items", []))
                if boundary_count >= 4:
                    try:
                        found_tables = page.find_tables().tables
                    except Exception as exc:
                        found_tables = []
                        diagnostics.append({"level": "warning", "code": "pdf_table_detection_failed", "page": index, "message": str(exc)})
                else:
                    found_tables = []
                page_aid = f"{source_id}:page:{index}"
                for table_index, table in enumerate(found_tables, 1):
                    rows = table.extract()
                    table_id = f"{source_id}:table:{index}:{table_index}"
                    table_path = table_root / f"page_{index:04d}_table_{table_index:02d}.json"
                    write_json(table_path, {"table_id": table_id, "page": index, "bbox": list(table.bbox), "rows": rows})
                    artifacts.append(Artifact(artifact_id=table_id, parent_artifact_id=page_aid, kind="pdf_table", media_type="application/json", path=relative(table_path, root), sha256=sha256_file(table_path), source_locator=SourceLocator(kind="pdf_region", artifact_id=original_aid, page=index, bbox=list(table.bbox)), metadata={"row_count": len(rows), "column_count": max((len(row) for row in rows), default=0)}).model_dump(mode="json"))
                    structured_assets.append({"asset_id": table_id, "kind": "pdf_table", "page": index, "row_count": len(rows), "column_count": max((len(row) for row in rows), default=0), "path": relative(table_path, root)})
                    table_ids.append(table_id)
                    table_uid = f"{table_id}:unit"
                    units.append(ContentUnit(unit_id=table_uid, artifact_id=table_id, kind="pdf_table", sequence=0, text=json.dumps({"table_id": table_id, "page": index, "bbox": list(table.bbox), "rows": rows}, ensure_ascii=False, default=str), locator=SourceLocator(kind="pdf_region", artifact_id=table_id, unit_id=table_uid, page=index, bbox=list(table.bbox))).model_dump(mode="json"))
                page_data = {"page": index, "width": page.rect.width, "height": page.rect.height, "blocks": [{"bbox": list(block[:4]), "text": block[4]} for block in blocks], "image_count": len(images), "drawing_count": len(drawings), "table_ids": table_ids}
                page_path = page_root / f"page_{index:04d}.json"
                write_json(page_path, page_data)
                artifacts.append(Artifact(artifact_id=page_aid, parent_artifact_id=original_aid, kind="pdf_page", media_type="application/json", path=relative(page_path, root), sha256=sha256_file(page_path), source_locator=SourceLocator(kind="pdf_page", artifact_id=original_aid, page=index), metadata={"text_path": relative(text_path, root), "image_count": len(images), "drawing_count": len(drawings)}).model_dump(mode="json"))
                visual_score = (3 if images else 0) + (2 if drawings else 0) + (1 if len(text.strip()) < 250 else 0)
                if visual_score >= 2:
                    render_path = render_root / f"page_{index:04d}.png"
                    render_path.parent.mkdir(parents=True, exist_ok=True)
                    page.get_pixmap(dpi=self.render_dpi, alpha=False).save(render_path)
                    render_aid = f"{source_id}:render:{index}"
                    artifacts.append(Artifact(artifact_id=render_aid, parent_artifact_id=page_aid, kind="page_render", media_type="image/png", path=relative(render_path, root), sha256=sha256_file(render_path), source_locator=SourceLocator(kind="pdf_page", artifact_id=original_aid, page=index)).model_dump(mode="json"))
                    visual_assets.append({"visual_id": render_aid, "kind": "page_render", "artifact_id": render_aid, "page": index, "path": relative(render_path, root), "visual_score": visual_score, "status": "pending_inspection"})
                uid = f"{source_id}:page:{index}"
                page_unit = ContentUnit(unit_id=uid, artifact_id=page_aid, kind="pdf_page", sequence=0, text=text, locator=SourceLocator(kind="pdf_page", artifact_id=page_aid, unit_id=uid, page=index), artifact_refs=[], metadata={"visual_score": visual_score, "table_ids": table_ids}).model_dump(mode="json")
                pages.append({"page": index, "artifacts": artifacts, "units": [page_unit, *units], "structured_assets": structured_assets, "visual_assets": visual_assets, "diagnostics": diagnostics})
        return {"pages": pages}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        _, bundle = self._base(path, root, source_id, "pymupdf")
        pages = sorted((page for result in results for page in result.output.get("pages", [])), key=lambda item: item["page"])
        if len(pages) != plan.total_native_units or [page["page"] for page in pages] != list(range(1, plan.total_native_units + 1)):
            raise ValueError("PDF materialization did not produce exactly one result per page")
        for page in pages:
            bundle.artifacts.extend(Artifact.model_validate(item) for item in page["artifacts"])
            for item in page["units"]:
                unit = ContentUnit.model_validate(item)
                unit.sequence = len(bundle.units) + 1
                bundle.units.append(unit)
            bundle.structured_assets.extend(page["structured_assets"])
            bundle.visual_assets.extend(page["visual_assets"])
            bundle.diagnostics.extend(page["diagnostics"])
        bundle.capabilities = ["read_text", "search", "inspect_visual", "render_page", "read_layout"]
        return bundle

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        import pymupdf
        source_root, bundle = self._base(path, root, source_id, "pymupdf")
        document = pymupdf.open(path)
        text_root = source_root / "derived" / "text"
        page_root = source_root / "derived" / "pages"
        render_root = source_root / "derived" / "renders"
        table_root = source_root / "derived" / "tables"
        for index, page in enumerate(document, 1):
            text = page.get_text("text") or ""
            blocks = page.get_text("blocks") or []
            drawings = page.get_drawings()
            images = page.get_images(full=True)
            text_path = text_root / f"page_{index:04d}.txt"
            text_path.parent.mkdir(parents=True, exist_ok=True)
            text_path.write_text(text, encoding="utf-8")
            table_ids: list[str] = []
            table_units: list[ContentUnit] = []
            try:
                found_tables = page.find_tables().tables
            except Exception as exc:
                found_tables = []
                bundle.diagnostics.append({"level": "warning", "code": "pdf_table_detection_failed", "page": index, "message": str(exc)})
            for table_index, table in enumerate(found_tables, 1):
                rows = table.extract()
                table_id = f"{source_id}:table:{index}:{table_index}"
                table_path = table_root / f"page_{index:04d}_table_{table_index:02d}.json"
                write_json(table_path, {"table_id": table_id, "page": index, "bbox": list(table.bbox), "rows": rows})
                bundle.artifacts.append(Artifact(artifact_id=table_id, parent_artifact_id=f"{source_id}:page:{index}", kind="pdf_table", media_type="application/json", path=relative(table_path, root), sha256=sha256_file(table_path), source_locator=SourceLocator(kind="pdf_region", artifact_id=bundle.artifacts[0].artifact_id, page=index, bbox=list(table.bbox)), metadata={"row_count": len(rows), "column_count": max((len(row) for row in rows), default=0)}))
                bundle.structured_assets.append({"asset_id": table_id, "kind": "pdf_table", "page": index, "row_count": len(rows), "column_count": max((len(row) for row in rows), default=0), "path": relative(table_path, root)})
                table_ids.append(table_id)
                table_uid = f"{table_id}:unit"
                table_units.append(ContentUnit(unit_id=table_uid, artifact_id=table_id, kind="pdf_table", sequence=0, text=json.dumps({"table_id": table_id, "page": index, "bbox": list(table.bbox), "rows": rows}, ensure_ascii=False, default=str), locator=SourceLocator(kind="pdf_region", artifact_id=table_id, unit_id=table_uid, page=index, bbox=list(table.bbox))))
            page_data = {"page": index, "width": page.rect.width, "height": page.rect.height, "blocks": [{"bbox": list(block[:4]), "text": block[4]} for block in blocks], "image_count": len(images), "drawing_count": len(drawings), "table_ids": table_ids}
            page_path = page_root / f"page_{index:04d}.json"
            write_json(page_path, page_data)
            page_aid = f"{source_id}:page:{index}"
            bundle.artifacts.append(Artifact(artifact_id=page_aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="pdf_page", media_type="application/json", path=relative(page_path, root), sha256=sha256_file(page_path), source_locator=SourceLocator(kind="pdf_page", artifact_id=bundle.artifacts[0].artifact_id, page=index), metadata={"text_path": relative(text_path, root), "image_count": len(images), "drawing_count": len(drawings)}))
            visual_score = (3 if images else 0) + (2 if drawings else 0) + (1 if len(text.strip()) < 250 else 0)
            refs: list[str] = []
            if visual_score >= 2:
                render_path = render_root / f"page_{index:04d}.png"
                render_path.parent.mkdir(parents=True, exist_ok=True)
                pix = page.get_pixmap(dpi=self.render_dpi, alpha=False)
                pix.save(render_path)
                render_aid = f"{source_id}:render:{index}"
                bundle.artifacts.append(Artifact(artifact_id=render_aid, parent_artifact_id=page_aid, kind="page_render", media_type="image/png", path=relative(render_path, root), sha256=sha256_file(render_path), source_locator=SourceLocator(kind="pdf_page", artifact_id=bundle.artifacts[0].artifact_id, page=index)))
                bundle.visual_assets.append({"visual_id": render_aid, "kind": "page_render", "artifact_id": render_aid, "page": index, "path": relative(render_path, root), "visual_score": visual_score, "status": "pending_inspection"})
                # Every visual is classified by the exhaustive visual stage;
                # text extraction must not make a hidden relevance decision.
            uid = f"{source_id}:page:{index}"
            bundle.units.append(ContentUnit(unit_id=uid, artifact_id=page_aid, kind="pdf_page", sequence=len(bundle.units) + 1, text=text, locator=SourceLocator(kind="pdf_page", artifact_id=page_aid, unit_id=uid, page=index), artifact_refs=refs, metadata={"visual_score": visual_score, "table_ids": table_ids}))
            for table_unit in table_units:
                table_unit.sequence = len(bundle.units) + 1
                bundle.units.append(table_unit)
        document.close()
        bundle.capabilities = ["read_text", "search", "inspect_visual", "render_page", "read_layout"]
        return bundle


class AdapterRegistry:
    def __init__(self, render_dpi: int = 130):
        self.adapters: list[SourceAdapter] = [PDFAdapter(render_dpi), KMLAdapter(), ExcelAdapter(), CSVAdapter(), JSONAdapter(), ImageAdapter(), TextAdapter()]

    def for_path(self, path: Path) -> SourceAdapter:
        for adapter in self.adapters:
            if adapter.supports(path): return adapter
        raise ValueError(f"unsupported source type: {path.suffix or path.name}")

    def materialize(self, path: Path, root: Path, config: Any | None = None, resume: bool = True) -> SourceBundle:
        from .models import PipelineConfig
        source_id = stable_id("source", path.name, sha256_file(path)[:16])
        effective = config or PipelineConfig(live=False)
        return MaterializationScheduler(effective).run(self.for_path(path), path, root, source_id, resume=resume)
