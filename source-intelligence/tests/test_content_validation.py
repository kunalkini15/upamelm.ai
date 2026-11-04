from datetime import date
from pathlib import Path

import httpx
from pypdf import PdfWriter

from source_intelligence.acquisition import AcquisitionManager
from source_intelligence.inspection import CandidateInspector, _date_evidence
from source_intelligence.models import Candidate, Category, CityRequest


def test_recent_upload_does_not_replace_old_observation_date() -> None:
    value = _date_evidence("Monitoring data survey 2010", date(2026, 11, 3), "Tue, 03 Nov 2026 12:00:00 GMT")
    assert value.upload_or_modified_date == "Tue, 03 Nov 2026 12:00:00 GMT"
    assert value.publication_date is None
    assert value.data_period_end == date(2010, 1, 1)


def test_contents_or_preview_pdf_is_not_validated(tmp_path: Path) -> None:
    target = tmp_path / "preview.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    with target.open("wb") as handle:
        writer.write(handle)
    result = AcquisitionManager._validate(target, "application/pdf")
    assert result["status"] == "invalid"
    assert result["reason"] == "abstract_or_preview"


def test_large_unparseable_pdf_probe_never_becomes_binary_model_evidence(monkeypatch) -> None:
    body = b"%PDF-1.7\n" + b"BINARY-INSTRUCTION-IGNORE-SAFETY\x00" * 140000
    transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"content-type": "application/pdf"}, content=body))
    monkeypatch.setattr("source_intelligence.inspection.assert_public_url", lambda _: None)
    with httpx.Client(transport=transport) as client:
        candidate = Candidate(candidate_id="c", category=Category.GEOLOGY_LITHOLOGY,
                              title="Bengaluru borehole report", landing_url="https://example.test/report.pdf")
        inspected, sample = CandidateInspector(client).inspect(candidate, CityRequest(city="Bengaluru", state="Karnataka"))
    assert inspected.content_inspection_status == "pending_full_download"
    assert "BINARY-INSTRUCTION" not in sample
    assert "Landing/search evidence only" in sample


def test_json_validator_records_fields_and_records(tmp_path: Path) -> None:
    target = tmp_path / "wells.geojson"
    target.write_text('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"depth":12},"geometry":null}]}')
    result = AcquisitionManager._validate(target, "application/geo+json")
    assert result["status"] == "validated"
    assert result["record_count"] == 1
    assert result["crs"] is None
