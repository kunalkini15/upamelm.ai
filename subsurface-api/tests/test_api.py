from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from subsurface_api.config import Settings
from subsurface_api.main import create_app


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def client_for(tmp_path: Path) -> TestClient:
    city = tmp_path / "bengaluru"
    write_json(
        city / "ingestion" / "manifest.json",
        {
            "city": "Bengaluru",
            "sources": [{"source_id": "SRC-01", "title": "Groundwater Study", "publisher": "CGWB"}],
        },
    )
    write_json(city / "pipeline_summary.json", {"selected_docs": [{"rank": 1, "source_id": "SRC-01"}]})
    write_json(
        city / "city.json",
        {
            "schema_version": "city-catalog.v1",
            "id": "bengaluru",
            "label": "Bengaluru",
            "geometry": {"type": "Point", "coordinates": [77.5946, 12.9716]},
            "bbox": [77.3, 12.7, 77.9, 13.2],
            "default_zoom": 9,
        },
    )
    package = {
        "schema_version": "document-study.v2",
        "study_id": "groundwater-v1",
        "document_id": "document:groundwater-v1",
        "primary_rendering_mode": "map",
        "source": {"title": "Fallback title"},
        "native_assets": [{"path": "resources/figure.json"}],
    }
    write_json(city / "studies" / "SRC-01" / "study_package.json", package)
    write_json(city / "studies" / "SRC-01" / "study_package_kn.json", {**package, "translated": True})
    write_json(city / "studies" / "SRC-01" / "resources" / "figure.json", {"kind": "fixture"})
    settings = Settings(tmp_path, "bengaluru", "en", 25 * 1024 * 1024, ("http://localhost:5173",))
    return TestClient(create_app(settings))


def test_bootstrap_discovers_catalog_and_languages(tmp_path: Path) -> None:
    response = client_for(tmp_path).get("/api/v1/bootstrap")
    assert response.status_code == 200
    body = response.json()
    assert body["selection"] == {"city": "bengaluru", "study": "SRC-01", "language": "en"}
    assert body["cities"][0]["studyCount"] == 1
    assert body["cities"][0]["defaultStudy"] == "SRC-01"
    assert body["cities"][0]["geometry"] == {"type": "Point", "coordinates": [77.5946, 12.9716]}
    assert body["cities"][0]["bbox"] == [77.3, 12.7, 77.9, 13.2]
    assert body["cities"][0]["defaultZoom"] == 9
    assert body["studies"][0]["studyId"] == "groundwater-v1"
    assert body["studies"][0]["languages"] == ["en", "kn"]
    assert body["assetBaseUrl"] == "/api/v1/cities/bengaluru/studies/SRC-01/files/"


def test_root_links_to_api_documentation(tmp_path: Path) -> None:
    response = client_for(tmp_path).get("/")
    assert response.status_code == 200
    assert response.json()["documentation"] == "/docs"


def test_translated_package(tmp_path: Path) -> None:
    response = client_for(tmp_path).get(
        "/api/v1/cities/bengaluru/studies/SRC-01", params={"language": "kn"}
    )
    assert response.status_code == 200
    assert response.json()["package"]["translated"] is True
    assert response.json()["assetBaseUrl"] == "/api/v1/cities/bengaluru/studies/SRC-01/files/"


def test_package_reference_resolves_through_asset_base_url(tmp_path: Path) -> None:
    client = client_for(tmp_path)
    study = client.get("/api/v1/cities/bengaluru/studies/SRC-01").json()
    reference = study["package"]["native_assets"][0]["path"]
    response = client.get(f"{study['assetBaseUrl']}{reference}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"kind": "fixture"}


def test_asset_path_traversal_is_rejected(tmp_path: Path) -> None:
    response = client_for(tmp_path).get(
        "/api/v1/cities/bengaluru/studies/SRC-01/files/"
        "%2E%2E/%2E%2E/pipeline_summary.json"
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_asset_path"


def test_missing_translation_is_explicit(tmp_path: Path) -> None:
    response = client_for(tmp_path).get(
        "/api/v1/cities/bengaluru/studies/SRC-01", params={"language": "ta"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "translation_not_found"


def test_path_traversal_is_rejected(tmp_path: Path) -> None:
    response = client_for(tmp_path).get("/api/v1/cities/%2E%2E/studies")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_city"
