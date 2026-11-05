# UI Public Assets & Study Catalog (`ui/public`)

This directory houses static assets, web workers, test fixtures, and pre-packaged scientific studies served directly by Vite or static web servers.

---

## 📁 Key Files & Directories

- **`study-catalog.json`**:
  Legacy static fixture retained for regression and offline development only. Production application loading now discovers studies through `/api/v1/bootstrap`.
- **`studies/`**:
  Legacy materialized study fixtures. Runtime packages and referenced assets are served by `backend`.
- **`study_package.json`**:
  Legacy package fixture; it is not used by production application loading.
- **`capability-envelope-fixture.json`**:
  Synthetic benchmark package that exercises every supported visual primitive (points, corridors, polygons, raster overlays, 3D lithological slabs, borehole logs, time-series, and quantitative distributions) to test rendering resilience.
- **`maplibre-gl-worker.mjs`**:
  Bundled local Web Worker script for MapLibre GL JS, ensuring vector map tiles and glyphs decode without remote CDN dependencies.

---

## 🚀 Adding a New Runtime Study

Promote the study into the central city bundle consumed by `backend`. The UI discovers the study, its translations, and its package-relative assets from the bootstrap response; no frontend catalog edit is required.
