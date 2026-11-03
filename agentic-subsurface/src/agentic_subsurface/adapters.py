from __future__ import annotations

import csv
import json
import shutil
import zipfile
from abc import ABC, abstractmethod
from collections import Counter
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .models import Artifact, ContentUnit, SourceBundle, SourceLocator
from .util import media_type, relative, sha256_file, stable_id, write_json


class SourceAdapter(ABC):
    suffixes: set[str] = set()

    def supports(self, path: Path) -> bool:
        return path.suffix.lower() in self.suffixes

    @abstractmethod
    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle: ...

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

    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        source_root, bundle = self._base(path, root, source_id, "text")
        text = path.read_text(encoding="utf-8", errors="replace")
        locator = SourceLocator(kind="file", artifact_id=bundle.artifacts[0].artifact_id, unit_id=f"{source_id}:text")
        bundle.units.append(ContentUnit(unit_id=f"{source_id}:text", artifact_id=locator.artifact_id, kind="text", sequence=1, text=text, locator=locator))
        bundle.capabilities = ["read_text", "search"]
        return bundle


class JSONAdapter(SourceAdapter):
    suffixes = {".json", ".geojson"}

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


class KMLAdapter(SourceAdapter):
    suffixes = {".kml", ".kmz"}

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
        ns = {"k": "http://www.opengis.net/kml/2.2"}
        features: list[dict[str, Any]] = []
        for idx, placemark in enumerate(xml_root.findall(".//k:Placemark", ns), 1):
            name = placemark.findtext("k:name", default="", namespaces=ns)
            description = placemark.findtext("k:description", default="", namespaces=ns)
            geometry = None
            for tag, geo_type in (("Point", "Point"), ("LineString", "LineString"), ("Polygon", "Polygon")):
                element = placemark.find(f".//k:{tag}/k:coordinates", ns)
                if element is not None and element.text:
                    tuples = [[float(v) for v in item.split(",")[:2]] for item in element.text.split() if "," in item]
                    coordinates: Any = tuples[0] if geo_type == "Point" and tuples else tuples
                    if geo_type == "Polygon": coordinates = [tuples]
                    geometry = {"type": geo_type, "coordinates": coordinates}
                    break
            feature_id = placemark.attrib.get("id") or f"placemark-{idx}"
            features.append({"type": "Feature", "id": feature_id, "properties": {"name": name, "description": description}, "geometry": geometry})
        collection = {"type": "FeatureCollection", "features": features}
        target = source_root / "derived" / "features.geojson"
        write_json(target, collection)
        aid = f"{source_id}:features"
        bundle.artifacts.append(Artifact(artifact_id=aid, parent_artifact_id=bundle.artifacts[0].artifact_id, kind="vector_features", media_type="application/geo+json", path=relative(target, root), sha256=sha256_file(target), metadata={"feature_count": len(features)}))
        bundle.spatial_assets.append({"asset_id": aid, "kind": "vector_features", "feature_count": len(features), "geometry_type_counts": dict(Counter(str((f.get("geometry") or {}).get("type")) for f in features)), "path": relative(target, root)})
        # The complete geometry collection is preserved above. The model needs
        # the collection profile and a bounded semantic sample, not 100k
        # repetitive coordinate-bearing records copied into its context.
        sample_size = min(100, len(features))
        stride = max(1, len(features) // max(1, sample_size))
        sampled = features[::stride][:sample_size]
        profile_uid = f"{source_id}:collection-profile"
        profile = {"asset_id": aid, "feature_count": len(features), "geometry_type_counts": bundle.spatial_assets[0]["geometry_type_counts"], "sample_features": [{"id": f["id"], "properties": f["properties"], "geometry_type": (f.get("geometry") or {}).get("type")} for f in sampled]}
        bundle.units.append(ContentUnit(unit_id=profile_uid, artifact_id=aid, kind="vector_collection_profile", sequence=1, text=json.dumps(profile, ensure_ascii=False), locator=SourceLocator(kind="file", artifact_id=aid, unit_id=profile_uid)))
        bundle.capabilities = ["read_geometry", "read_records", "query_records", "render_preview"]
        return bundle


class ImageAdapter(SourceAdapter):
    suffixes = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}

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
                # Keep every render as an immutable raw artifact, but only send
                # strong visual candidates automatically. Other pages remain
                # available for targeted recovery.
                if visual_score >= 4:
                    refs.append(render_aid)
            uid = f"{source_id}:page:{index}"
            table_projection = ""
            if found_tables:
                table_projection = "\n\n--- DETERMINISTIC TABLES ---\n" + json.dumps([{"table_id": f"{source_id}:table:{index}:{i}", "rows": table.extract()} for i, table in enumerate(found_tables, 1)], ensure_ascii=False, default=str)
            bundle.units.append(ContentUnit(unit_id=uid, artifact_id=page_aid, kind="pdf_page", sequence=index, text=text + table_projection, locator=SourceLocator(kind="pdf_page", artifact_id=page_aid, unit_id=uid, page=index), artifact_refs=refs, metadata={"visual_score": visual_score, "table_ids": table_ids}))
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

    def materialize(self, path: Path, root: Path) -> SourceBundle:
        source_id = stable_id("source", path.name, sha256_file(path)[:16])
        return self.for_path(path).materialize(path, root, source_id)
