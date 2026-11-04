// Coordinated application shell: top bar, five permanent modes, side panel,
// import surface, and every honest state surface (loading / empty /
// unlocated / unsupported-partial / package-validation / runtime-error).
// No document-specific rendering lives here.

import React, { useCallback, useRef, useState } from "react";
import { negotiateCapabilities } from "../capabilities/negotiate.ts";
import { useInteraction } from "../interaction/store.tsx";
import { MapView } from "../map/MapView.tsx";
import { NarrativePanel, ReportPanel } from "../narrative/panels.tsx";
import { MAX_PACKAGE_BYTES, PACKAGE_SCHEMA_VERSION, validatePackage } from "../package-adapter/validate.ts";
import type { SceneModel } from "../scene-model/types.ts";
import { createEmptyScene } from "../scene-model/types.ts";
import { ThreeViewport } from "../three/ThreeViewport.tsx";

const MODES = ["map", "3d", "split", "narrative", "report"] as const;

class ShellErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false, message: "" };
  }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="errorpanel" data-testid="runtime-error" role="alert">
          <h2>Something went wrong</h2>
          <p>{this.state.message || "The view hit an unexpected error. Nothing was uploaded."}</p>
          <button
            type="button"
            data-testid="btn-error-reset"
            onClick={() => this.setState({ failed: false, message: "" })}
          >
            Reset view
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ImportSurface({
  onImport,
  errors,
}: {
  onImport: (file: File) => void;
  errors: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <section aria-label="Package import" className={dragging ? "dropzone dragging" : "dropzone"}
      data-testid="import-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onImport(file);
      }}
    >
      <h2>Import package</h2>
      <p className="muted">
        JSON only · max {MAX_PACKAGE_BYTES / (1024 * 1024)} MB · validated locally, never uploaded.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      {errors.length > 0 && (
        <ul className="errors" data-testid="import-errors" role="alert">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function App() {
  const { state, dispatch } = useInteraction();
  const [scene, setScene] = useState<SceneModel>(() => createEmptyScene(PACKAGE_SCHEMA_VERSION));
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [mapBooted, setMapBooted] = useState(false);
  const onReady = useCallback(() => setMapBooted(true), []);

  const threeBlocked = !scene.has3DEvidence;
  const emptyScene = scene.metadata === null;
  const negotiation = negotiateCapabilities({
    layerCapabilityIds: scene.layers.map((l) => l.capabilityId),
    featureCount: scene.features.length,
  });

  function handleImport(file: File) {
    setImportErrors([]);
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setImportErrors([`"${file.name}" is not a JSON file. Choose a .json package.`]);
      return;
    }
    if (file.size > MAX_PACKAGE_BYTES) {
      setImportErrors([
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_PACKAGE_BYTES / (1024 * 1024)} MB.`,
      ]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = validatePackage(JSON.parse(String(reader.result)));
        if (!result.ok) {
          // Failure preserves the previously active scene (last valid wins).
          setImportErrors(result.errors);
          return;
        }
        setScene(result.scene);
        dispatch({ type: "setLayers", layerIds: result.scene.layers.map((l) => l.id) });
        dispatch({ type: "select", featureId: null });
      } catch {
        setImportErrors([`"${file.name}" is not valid JSON.`]);
      }
    };
    reader.onerror = () => setImportErrors([`Could not read "${file.name}".`]);
    reader.readAsText(file);
  }

  function clearPackage() {
    setScene(createEmptyScene(PACKAGE_SCHEMA_VERSION));
    setImportErrors([]);
    dispatch({ type: "reset" });
  }

  const selected = scene.features.find((f) => f.id === state.activeFeatureId) ?? null;
  const modeLabel: Record<string, string> = {
    map: "Map",
    "3d": "3D",
    split: "Split",
    narrative: "Narrative",
    report: "Report",
  };

  return (
    <ShellErrorBoundary>
      <div className="shell" data-testid="app-shell">
        <header className="topbar">
          <h1>Muse · Adaptive Visualization</h1>
          <p data-testid="package-status" role="status">
            {emptyScene ? "No package loaded" : `Package: ${scene.metadata?.title ?? "Imported package"}`}
          </p>
          <nav aria-label="Application modes" className="modes">
            {MODES.map((mode) => {
              const blocked = (mode === "3d" || mode === "split") && threeBlocked;
              return (
                <button
                  key={mode}
                  type="button"
                  data-testid={`mode-${mode}`}
                  disabled={blocked}
                  aria-pressed={state.viewMode === mode}
                  title={blocked ? "Needs located 3D evidence" : modeLabel[mode]}
                  className={state.viewMode === mode ? "mode active" : "mode"}
                  onClick={() => dispatch({ type: "setMode", viewMode: mode })}
                >
                  {modeLabel[mode]}
                </button>
              );
            })}
          </nav>
          {threeBlocked && (
            <p className="muted" data-testid="mode-3d-reason" role="note">
              3D and Split need located 3D evidence — import a validated package with anchored metric
              geometry to enable them.
            </p>
          )}
        </header>

        <div className="layout">
          <aside className="side" aria-label="Scene panel">
            <section aria-label="Layers">
              <h2>Layers</h2>
              <label className="layerrow" key="__basemap">
                <input type="checkbox" checked disabled data-testid="layer-toggle-basemap" /> Basemap
              </label>
              {scene.layers.length === 0 && (
                <p className="muted" data-testid="layers-empty">No study layers yet.</p>
              )}
              {scene.layers.map((layer) => (
                <label className="layerrow" key={layer.id}>
                  <input
                    type="checkbox"
                    data-testid={`layer-toggle-${layer.id}`}
                    checked={state.activeLayerIds.includes(layer.id)}
                    onChange={() => dispatch({ type: "toggleLayer", layerId: layer.id })}
                  />
                  {layer.title} <span className="muted">({layer.featureIds.length})</span>
                </label>
              ))}
            </section>

            <section aria-label="Legend" data-testid="legend">
              <h2>Legend</h2>
              {scene.layers.length === 0 ? (
                <p className="muted">Nothing to show yet.</p>
              ) : (
                <ul>
                  {scene.layers.map((l) => (
                    <li key={l.id}>
                      <span className="swatch" aria-hidden="true" /> {l.title} · {l.capabilityId}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Selection details" data-testid="selection-details">
              <h2>Selection</h2>
              {selected ? (
                <p>
                  <strong>{selected.label}</strong>
                  <br />
                  <span className="muted">
                    {selected.id} · layer {selected.layerId} · {selected.geometry.kind}
                  </span>
                </p>
              ) : (
                <p className="muted">Nothing selected.</p>
              )}
            </section>

            <section aria-label="Limitations" data-testid="limitations">
              <h2>Limitations</h2>
              <ul>
                {scene.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              {negotiation.kind === "no-evidence" && (
                <p className="muted">Capabilities: {negotiation.reason}</p>
              )}
            </section>

            <ImportSurface onImport={handleImport} errors={importErrors} />
            {!emptyScene && (
              <button type="button" data-testid="btn-clear-package" onClick={clearPackage}>
                Clear package
              </button>
            )}
          </aside>

          <main className="stage">
            {!mapBooted && (state.viewMode === "map" || state.viewMode === "split") && (
              <div className="loadingveil" data-testid="loading-state" role="status">
                <p>Loading world…</p>
              </div>
            )}
            {!emptyScene && scene.unlocated && (
              <p className="notice" data-testid="unlocated-banner" role="status">
                Location unavailable: this package has no validated spatial bounds, so the map
                holds the world view. Narrative and report content below remain fully usable.
                {scene.unresolved.length > 0 && ` (${scene.unresolved[0]})`}
              </p>
            )}
            {(state.viewMode === "map" || state.viewMode === "split") && (
              <div className={state.viewMode === "split" ? "splitpane" : "fullpane"}>
                <MapView scene={scene} onReady={onReady} />
              </div>
            )}
            {(state.viewMode === "3d" || state.viewMode === "split") && (
              <div className={state.viewMode === "split" ? "splitpane" : "fullpane"}>
                <ThreeViewport
                  enabledReason={
                    threeBlocked ? "No located 3D evidence yet. Import a validated package with anchored metric geometry to enable 3D." : null
                  }
                  scene={scene}
                  activeFeatureId={state.activeFeatureId}
                />
              </div>
            )}
            {state.viewMode === "narrative" && <NarrativePanel items={scene.narrative} />}
            {state.viewMode === "report" && <ReportPanel sections={scene.reports} />}
          </main>
        </div>

        <footer className="foot">
          <span>Map data: OpenFreeMap / OpenMapTiles · © OpenStreetMap contributors · fallback: bundled graticule</span>
        </footer>
      </div>
    </ShellErrorBoundary>
  );
}
