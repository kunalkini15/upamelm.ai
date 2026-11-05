# Upamelm.ai Backend

Lightweight, read-only FastAPI service over the promoted city outputs in `../runs`.
It discovers cities, studies, and translated packages directly from the filesystem;
no database or hand-maintained catalog is required.

## Run

From the repository root:

```bash
./backend/run.sh
```

The first run creates an isolated virtual environment and installs the required
dependencies. The API then listens on `http://localhost:8010`.

- Landing response: `http://localhost:8010/`
- Health: `http://localhost:8010/api/v1/health`
- Bootstrap: `http://localhost:8010/api/v1/bootstrap`
- Interactive API docs: `http://localhost:8010/docs`

Pass normal Uvicorn flags after the script when needed:

```bash
./backend/run.sh --reload
```

To use a different port:

```bash
BACKEND_PORT=8020 ./backend/run.sh
```

## Content convention

```text
runs/<city>/studies/<source-id>/study_package.json
runs/<city>/studies/<source-id>/study_package_<language>.json
runs/<city>/city.json
```

The unsuffixed package is treated as English (`en`). Translations are discovered
from filenames, so adding `study_package_ta.json` automatically exposes Tamil.

`city.json` supplies catalog presentation metadata without requiring frontend
geocoding. It uses `city-catalog.v1` with a GeoJSON Point, optional bounding box,
and optional default zoom. Cities without geometry remain available through the
catalog list but are not plotted on the overview map.

## Endpoints

```text
GET /api/v1/health
GET /api/v1/bootstrap?city=bengaluru&study=SRC-LR-01&language=kn
GET /api/v1/cities
GET /api/v1/cities/{city_id}
GET /api/v1/cities/{city_id}/studies
GET /api/v1/cities/{city_id}/studies/{source_id}?language=kn
GET /api/v1/cities/{city_id}/studies/{source_id}/files/{asset_path}
```

The bootstrap endpoint returns the city catalog, selected city's studies,
available languages, current selection, and the selected study package in one
response for a fast initial UI render.

Bootstrap and individual-study responses include `assetBaseUrl`. Resolve package
references such as `resources/figure.json` relative to that URL. The file route
serves only regular files whose resolved paths remain inside the selected study
directory.

## Configuration

Configuration uses environment variables. Relative `SUBSURFACE_RUNS_ROOT` values
are resolved from this module directory.

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND_PORT` | `8010` | Uvicorn listening port used by `run.sh` |
| `SUBSURFACE_RUNS_ROOT` | `../runs` | Root containing promoted city runs |
| `SUBSURFACE_DEFAULT_CITY` | `bengaluru` | City selected when bootstrap omits one |
| `SUBSURFACE_DEFAULT_LANGUAGE` | `en` | Language selected when bootstrap omits one |
| `SUBSURFACE_MAX_PACKAGE_MB` | `25` | Maximum JSON package size read by the API |
| `SUBSURFACE_CORS_ORIGINS` | localhost and 127.0.0.1 on port `5175` | Comma-separated browser origins allowed to call the API directly |

## Tests

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/python -m pytest
```
