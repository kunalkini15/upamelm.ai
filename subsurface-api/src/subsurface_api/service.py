from __future__ import annotations

from typing import Any

from .errors import ApiError
from .repository import RunRepository


LANGUAGES = {
    "en": ("English", "English"),
    "hi": ("Hindi", "हिन्दी"),
    "kn": ("Kannada", "ಕನ್ನಡ"),
    "ta": ("Tamil", "தமிழ்"),
    "te": ("Telugu", "తెలుగు"),
    "ml": ("Malayalam", "മലയാളം"),
    "mr": ("Marathi", "मराठी"),
    "bn": ("Bengali", "বাংলা"),
    "gu": ("Gujarati", "ગુજરાતી"),
}


def label_identifier(value: str) -> str:
    return " ".join(part.capitalize() for part in value.replace("_", "-").split("-") if part)


class CatalogService:
    def __init__(self, repository: RunRepository, default_city: str | None, default_language: str) -> None:
        self.repository = repository
        self.default_city = default_city
        self.default_language = default_language

    def language_descriptor(self, code: str) -> dict[str, str]:
        label, native = LANGUAGES.get(code, (code.upper(), code.upper()))
        return {"code": code, "label": label, "nativeLabel": native}

    @staticmethod
    def asset_base_url(city_id: str, source_id: str) -> str:
        return f"/api/v1/cities/{city_id}/studies/{source_id}/files/"

    def city_summary(self, city_id: str) -> dict[str, Any]:
        city_dir = self.repository.city_dir(city_id)
        manifest = self.repository.optional_json(city_dir / "ingestion" / "manifest.json")
        city_metadata = self.repository.optional_json(city_dir / "city.json")
        sources = self.repository.source_ids(city_id)
        label = (
            city_metadata.get("label")
            if isinstance(city_metadata.get("label"), str)
            else manifest.get("city")
            if isinstance(manifest.get("city"), str)
            else label_identifier(city_id)
        )
        geometry = city_metadata.get("geometry")
        if not (
            isinstance(geometry, dict)
            and geometry.get("type") == "Point"
            and isinstance(geometry.get("coordinates"), list)
            and len(geometry["coordinates"]) == 2
            and all(isinstance(value, (int, float)) for value in geometry["coordinates"])
        ):
            geometry = None
        bbox = city_metadata.get("bbox")
        if not (
            isinstance(bbox, list)
            and len(bbox) == 4
            and all(isinstance(value, (int, float)) for value in bbox)
        ):
            bbox = None
        default_zoom = city_metadata.get("default_zoom")
        return {
            "id": city_id,
            "label": label,
            "studyCount": len(sources),
            "defaultStudy": self._ordered_source_ids(city_id)[0] if sources else None,
            "geometry": geometry,
            "bbox": bbox,
            "defaultZoom": default_zoom if isinstance(default_zoom, (int, float)) else None,
        }

    def cities(self) -> list[dict[str, Any]]:
        return [self.city_summary(city_id) for city_id in self.repository.city_ids()]

    def _source_metadata(self, city_id: str) -> dict[str, dict[str, Any]]:
        manifest = self.repository.optional_json(
            self.repository.city_dir(city_id) / "ingestion" / "manifest.json"
        )
        sources = manifest.get("sources", [])
        if not isinstance(sources, list):
            return {}
        return {
            item["source_id"]: item
            for item in sources
            if isinstance(item, dict) and isinstance(item.get("source_id"), str)
        }

    def _ordered_source_ids(self, city_id: str) -> list[str]:
        available = self.repository.source_ids(city_id)
        summary = self.repository.optional_json(self.repository.city_dir(city_id) / "pipeline_summary.json")
        selected = summary.get("selected_docs", [])
        ranked = sorted(
            (item for item in selected if isinstance(item, dict)),
            key=lambda item: item.get("rank", 1_000_000),
        ) if isinstance(selected, list) else []
        ordered = [item.get("source_id") for item in ranked if item.get("source_id") in available]
        ordered.extend(source_id for source_id in available if source_id not in ordered)
        return ordered

    def study_summary(self, city_id: str, source_id: str, source_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        path = self.repository.package_path(city_id, source_id, "en")
        package = self.repository.read_json(path, package=True)
        if not isinstance(package, dict):
            raise ApiError(422, "invalid_package", f"Study '{source_id}' must contain a JSON object.")
        metadata = source_metadata or {}
        source = package.get("source") if isinstance(package.get("source"), dict) else {}
        title = metadata.get("title") or source.get("title") or package.get("study_id") or source_id
        return {
            "id": source_id,
            "studyId": package.get("study_id"),
            "documentId": package.get("document_id"),
            "title": title,
            "publisher": metadata.get("publisher"),
            "publicationDate": metadata.get("publication_date"),
            "languages": self.repository.languages(city_id, source_id),
            "defaultLanguage": "en",
            "schemaVersion": package.get("schema_version"),
            "primaryRenderingMode": package.get("primary_rendering_mode"),
            "status": package.get("status"),
        }

    def studies(self, city_id: str) -> list[dict[str, Any]]:
        metadata = self._source_metadata(city_id)
        return [
            self.study_summary(city_id, source_id, metadata.get(source_id))
            for source_id in self._ordered_source_ids(city_id)
        ]

    def study(self, city_id: str, source_id: str, language: str) -> dict[str, Any]:
        summary = self.study_summary(city_id, source_id, self._source_metadata(city_id).get(source_id))
        package = self.repository.read_json(
            self.repository.package_path(city_id, source_id, language), package=True
        )
        return {
            "study": summary,
            "selectedLanguage": language.lower(),
            "assetBaseUrl": self.asset_base_url(city_id, source_id),
            "package": package,
        }

    def bootstrap(self, city: str | None, study: str | None, language: str | None) -> dict[str, Any]:
        cities = self.cities()
        if not cities:
            raise ApiError(503, "catalog_empty", "No city runs are available.")
        city_ids = [item["id"] for item in cities]
        selected_city = city or (self.default_city if self.default_city in city_ids else city_ids[0])
        city_studies = self.studies(selected_city)
        if not city_studies:
            raise ApiError(503, "city_empty", f"City '{selected_city}' has no available studies.")
        study_ids = [item["id"] for item in city_studies]
        selected_study = study or study_ids[0]
        if selected_study not in study_ids:
            self.repository.study_dir(selected_city, selected_study)
        selected_summary = next(item for item in city_studies if item["id"] == selected_study)
        requested_language = (language or self.default_language).lower()
        if requested_language not in selected_summary["languages"]:
            if language is not None:
                self.repository.package_path(selected_city, selected_study, requested_language)
            requested_language = "en" if "en" in selected_summary["languages"] else selected_summary["languages"][0]
        package = self.repository.read_json(
            self.repository.package_path(selected_city, selected_study, requested_language), package=True
        )
        return {
            "selection": {
                "city": selected_city,
                "study": selected_study,
                "language": requested_language,
            },
            "cities": cities,
            "studies": city_studies,
            "availableLanguages": [
                self.language_descriptor(code) for code in selected_summary["languages"]
            ],
            "assetBaseUrl": self.asset_base_url(selected_city, selected_study),
            "package": package,
        }
