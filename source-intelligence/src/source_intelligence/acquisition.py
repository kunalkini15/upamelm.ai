from __future__ import annotations

import hashlib
import csv
import json
import mimetypes
import zipfile
from io import TextIOWrapper
from pathlib import Path
from urllib.parse import unquote, urlsplit

import httpx

from .inspection import assert_public_url, public_request
from .models import AcquiredSource, Candidate
from .util import safe_filename, stable_id

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None


MAGIC = {
    "application/pdf": b"%PDF", "application/zip": b"PK",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": b"PK",
    "application/vnd.google-earth.kmz": b"PK",
}


class AcquisitionManager:
    def __init__(self, client: httpx.Client, max_bytes: int):
        self.client = client
        self.max_bytes = max_bytes

    def acquire(self, candidate: Candidate, root: Path) -> AcquiredSource:
        if not candidate.eligible or not candidate.download_url:
            raise ValueError("only eligible candidates can be acquired")
        url = str(candidate.download_url)
        assert_public_url(url)
        category_dir = root / "documents" / candidate.category.value
        category_dir.mkdir(parents=True, exist_ok=True)
        url_name = Path(unquote(urlsplit(url).path)).name
        suffix = Path(url_name).suffix.lower()
        if not suffix:
            suffix = mimetypes.guess_extension(candidate.media_type or "") or ".bin"
        filename = safe_filename(url_name or candidate.title, "document" + suffix)
        if not Path(filename).suffix:
            filename += suffix
        target = category_dir / filename
        temporary = target.with_suffix(target.suffix + ".part")
        digest = hashlib.sha256()
        size = 0
        prefix = b""
        try:
            response = public_request(self.client, "GET", url, stream=True)
            try:
                response.raise_for_status()
                declared = int(response.headers.get("content-length", "0") or 0)
                if declared > self.max_bytes:
                    raise ValueError("document exceeds configured download limit")
                with temporary.open("wb") as handle:
                    for chunk in response.iter_bytes(64 * 1024):
                        size += len(chunk)
                        if size > self.max_bytes:
                            raise ValueError("document exceeds configured download limit")
                        if len(prefix) < 16:
                            prefix += chunk[:16 - len(prefix)]
                        digest.update(chunk)
                        handle.write(chunk)
            finally:
                response.close()
            expected = MAGIC.get(candidate.media_type or "")
            if expected and not prefix.lstrip().startswith(expected):
                raise ValueError(f"downloaded bytes do not match {candidate.media_type}")
            checksum = digest.hexdigest()
            final = category_dir / f"{checksum[:12]}-{filename}"
            if final.exists():
                temporary.unlink(missing_ok=True)
            else:
                temporary.replace(final)
            validation = self._validate(final, candidate.media_type or "application/octet-stream")
            if validation.get("status") != "validated":
                final.unlink(missing_ok=True)
                raise ValueError(f"downloaded asset validation failed: {validation.get('reason', validation.get('status'))}")
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        evidence = candidate.date_evidence
        candidate.lifecycle_status = "validated"
        candidate.validation_results.update(validation)
        return AcquiredSource(
            source_id=stable_id("source", checksum), category=candidate.category, title=candidate.title,
            publisher=candidate.publisher, landing_url=candidate.landing_url, download_url=candidate.download_url,
            publication_date=evidence.publication_date, data_period_start=evidence.data_period_start,
            data_period_end=evidence.data_period_end, freshness_basis=evidence.basis,
            freshness_confidence=evidence.confidence, media_type=candidate.media_type or "application/octet-stream",
            filename=final.name, local_path=final.relative_to(root).as_posix(), sha256=checksum,
            size_bytes=size, selected_score=candidate.score,
            selection_reason="Highest-ranked candidate passing authority, geography, freshness, and utility gates",
            candidate_id=candidate.candidate_id, originating_query_ids=candidate.search_queries,
            final_resolved_url=candidate.resolved_url or candidate.download_url,
            evidence_categories=list(dict.fromkeys([*(candidate.evidence_categories or [candidate.category]),
                                                    *[item.category for item in candidate.evidence_contributions if item.category]])), evidence_types=candidate.evidence_types,
            evidence_contributions=candidate.evidence_contributions,
            validation_status="validated", validation_results=validation,
        )

    @staticmethod
    def _validate(path: Path, media_type: str) -> dict:
        suffix = path.suffix.lower()
        try:
            if media_type == "application/pdf" or suffix == ".pdf":
                if PdfReader is None:
                    return {"status": "unsupported", "reason": "pypdf unavailable"}
                reader = PdfReader(path, strict=False)
                pages = len(reader.pages)
                texts = [(reader.pages[i].extract_text() or "") for i in range(min(pages, 12))]
                chars = sum(len(x.strip()) for x in texts)
                if pages < 2:
                    return {"status": "invalid", "reason": "abstract_or_preview", "page_count": pages}
                joined = " ".join(texts).lower()
                contents_only = pages <= 4 and "table of contents" in joined and chars < 3000
                if contents_only:
                    return {"status": "invalid", "reason": "contents_only", "page_count": pages}
                return {"status": "validated", "format": "pdf", "page_count": pages, "parser_success": True,
                        "content_completeness": "complete", "requires_ocr": chars < 500}
            if suffix in {".json", ".geojson"}:
                value = json.loads(path.read_text(encoding="utf-8"))
                records = len(value.get("features", [])) if isinstance(value, dict) and isinstance(value.get("features"), list) else (len(value) if isinstance(value, list) else 1)
                fields = sorted(value.keys()) if isinstance(value, dict) else []
                return {"status": "validated", "format": suffix[1:], "record_count": records, "fields": fields, "crs": value.get("crs") if isinstance(value, dict) else None}
            if suffix in {".csv", ".tsv"}:
                with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
                    rows = csv.reader(handle, delimiter="\t" if suffix == ".tsv" else ",")
                    header = next(rows, [])
                    count = sum(1 for _ in rows)
                return {"status": "validated", "format": suffix[1:], "fields": header, "record_count": count}
            if suffix in {".zip", ".kmz", ".xlsx"}:
                with zipfile.ZipFile(path) as archive:
                    members = archive.infolist()
                    if len(members) > 500 or sum(x.file_size for x in members) > 500 * 1024 * 1024:
                        return {"status": "invalid", "reason": "archive_limits_exceeded"}
                    names = [x.filename for x in members[:100]]
                    bad = any(".." in Path(name).parts or name.startswith(("/", "\\")) for name in names)
                    if bad:
                        return {"status": "invalid", "reason": "unsafe_archive_member"}
                return {"status": "validated", "format": suffix[1:], "member_count": len(members), "members": names}
            if suffix == ".kml":
                text = path.read_text(encoding="utf-8", errors="strict")
                if "<kml" not in text.lower():
                    return {"status": "invalid", "reason": "invalid_kml"}
                return {"status": "validated", "format": "kml", "coordinate_information": "<coordinates" in text.lower(), "crs": "EPSG:4326 implied by KML"}
            return {"status": "unsupported", "reason": f"no validator for {media_type}"}
        except Exception as exc:
            return {"status": "invalid", "reason": str(exc), "parser_success": False}
