# UI V2 Public Assets & Study Catalog (`ui-v2/public`)

This directory houses static assets, web workers, test fixtures, and pre-packaged scientific studies served directly by Vite or static web servers.

---

## 📁 Key Files & Directories

- **`study-catalog.json`**:
  The active catalog manifest consumed by `StudySwitcher.tsx`. Declares all available studies, titles, and relative paths to their `study_package.json`:
  ```json
  {
    "studies": [
      {
        "id": "naquim-bangalore-north-v1",
        "title": "Bangalore North Aquifer Plan",
        "package": "/studies/naquim-bangalore-north-v1/study_package.json",
        "family": "NAQUIM aquifer management plan"
      },
      {
        "id": "naquim-bangalore-east-v1",
        "title": "Bangalore East Aquifer Plan",
        "package": "/studies/naquim-bangalore-east-v1/study_package.json",
        "family": "NAQUIM aquifer management plan"
      }
    ]
  }
  ```
- **`studies/`**:
  Contains self-contained study directories with their respective `study_package.json` and materialized figures/assets.
- **`study_package.json`**:
  The default fallback study package loaded when no `?package=` URL parameter is specified.
- **`capability-envelope-fixture.json`**:
  Synthetic benchmark package that exercises every supported visual primitive (points, corridors, polygons, raster overlays, 3D lithological slabs, borehole logs, time-series, and quantitative distributions) to test rendering resilience.
- **`maplibre-gl-worker.mjs`**:
  Bundled local Web Worker script for MapLibre GL JS, ensuring vector map tiles and glyphs decode without remote CDN dependencies.

---

## 🚀 Adding a New Study to the Catalog

To register a new study:
1. Export the study package from `muse-document-processing` or materialize it using:
   ```bash
   npm run materialize:package -- <path/to/extracted/study_package.json> public/studies/<my-new-study>
   ```
2. Add an entry to `public/study-catalog.json` with a unique `id`, human-readable `title`, and relative path to `study_package.json`.
3. The new study will automatically appear in the `StudySwitcher` dropdown in the application header.
