# UI Component Architecture (`ui/src/components`)

This directory houses the presentation layer for the Subsurface Explorer, structured around a coordinated dual-canvas paradigm (2D GIS Map + 3D Subsurface Explorer) and an evidence-grounded executive dossier.

---

## 🏛 Component Hierarchy & Layout

```
src/components/
├── hud/                      # Heads-Up Display controls & chrome
│   ├── ScientificHeader.tsx  # Title bar, location metadata, study switcher
│   ├── FloatingHUD.tsx       # Bottom HUD: viewport modes, layer badges, borehole cards
│   └── StudySwitcher.tsx     # API-driven city, study, and language selectors
├── map/                      # 2D Geospatial GIS engine
│   ├── SeamlessMap.tsx       # MapLibre GL map wrapper with responsive framing
│   └── LayerControl.tsx      # Multi-layer toggle & opacity menu
├── scene/                    # 3D Subsurface spatial engine
│   └── SubsurfaceExplorer.tsx # Three.js / React Three Fiber 3D geological canvas
├── report/                   # Plain-language narrative & synthesis
│   └── ExecutiveDossierDrawer.tsx # Slide-out dossier with findings & citations
├── evidence/                 # Multi-capability analytical workspaces
│   ├── EvidenceWorkspace.tsx # Tabbed workspace container (charts, tables, assets)
│   ├── AdaptivePanels.tsx    # Responsive side-by-side or stacked evidence panels
│   ├── GenericChart.tsx      # Dynamic Recharts visualization driven by RendererRegistry
│   └── CorridorBrowser.tsx   # Alignment & transit corridor chainage inspector
└── inspector/                # Feature-level metadata inspection
    ├── FeatureInspector.tsx  # Detailed property inspector for selected map/3D entities
    └── InspectorPanel.tsx    # Slide-over panel for borehole & layer stratigraphy
```

---

## 🎮 Coordinated Interaction Paradigm

All viewports share a centralized, decoupled interaction state defined in `src/App.tsx`:

1. **`activeFeatureId`**: Selecting any feature on the 2D map, in the 3D scene, or within the Executive Dossier highlights the same entity everywhere.
2. **`viewMode`**:
   - `map`: Full-screen 2D GIS map with layer overlays.
   - `subsurface` (or `3d`): Full-screen 3D spatial scene with stratigraphic layers, depth grids, and borehole logs.
   - `split`: Synchronized side-by-side 2D map and 3D subsurface view.
   - `dossier`: Expands the executive synthesis drawer with page-level citations.
3. **`focusFinding`**: Clicking a scientific finding or risk callout in the dossier flies the camera directly to the relevant geographic coordinates or depth interval in both 2D and 3D.

---

## 🛠 Adding a New Component

When introducing a new visual component or workspace:
1. Ensure it imports types strictly from `src/types/scientific.ts`.
2. Wrap external data access through normalized models (`ScientificUIModel`).
3. Maintain honest empty states: if a study package lacks data for this view, render an explanatory notice rather than throwing errors.
