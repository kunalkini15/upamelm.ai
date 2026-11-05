from __future__ import annotations

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings
from .errors import ApiError
from .repository import RunRepository
from .service import CatalogService


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    repository = RunRepository(settings.runs_root, settings.max_package_bytes)
    service = CatalogService(repository, settings.default_city, settings.default_language)

    app = FastAPI(
        title="Backend",
        version="0.1.0",
        description="Read-only API for city-level Subsurface pipeline outputs.",
    )
    app.state.settings = settings
    app.state.catalog = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, object]:
        return {
            "name": "Backend",
            "version": "0.1.0",
            "status": "ok",
            "health": "/api/v1/health",
            "bootstrap": "/api/v1/bootstrap",
            "documentation": "/docs",
        }

    @app.get("/api/v1/health", tags=["system"])
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "runsRoot": str(settings.runs_root),
            "cityCount": len(repository.city_ids()),
        }

    @app.get("/api/v1/cities", tags=["catalog"])
    def cities() -> dict[str, object]:
        return {"cities": service.cities()}

    @app.get("/api/v1/cities/{city_id}", tags=["catalog"])
    def city(city_id: str) -> dict[str, object]:
        return {"city": service.city_summary(city_id), "studies": service.studies(city_id)}

    @app.get("/api/v1/cities/{city_id}/studies", tags=["catalog"])
    def studies(city_id: str) -> dict[str, object]:
        return {"city": service.city_summary(city_id), "studies": service.studies(city_id)}

    @app.get("/api/v1/cities/{city_id}/studies/{source_id}", tags=["studies"])
    def study(city_id: str, source_id: str, language: str = Query("en", min_length=2, max_length=16)) -> dict[str, object]:
        return service.study(city_id, source_id, language)

    @app.get(
        "/api/v1/cities/{city_id}/studies/{source_id}/files/{asset_path:path}",
        tags=["study files"],
        response_class=FileResponse,
    )
    def study_file(city_id: str, source_id: str, asset_path: str) -> FileResponse:
        return FileResponse(repository.asset_path(city_id, source_id, asset_path))

    @app.get("/api/v1/bootstrap", tags=["bootstrap"])
    def bootstrap(
        city: str | None = Query(None),
        study: str | None = Query(None),
        language: str | None = Query(None, min_length=2, max_length=16),
    ) -> dict[str, object]:
        return service.bootstrap(city, study, language)

    return app


app = create_app()
