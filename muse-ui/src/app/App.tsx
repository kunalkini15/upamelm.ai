// Coordinated observatory shell: scene-first stage below a compact command
// bar, with layers, import, limitations, and help as on-demand surfaces.
// No document-specific rendering lives here; renderers consume the typed
// scene model plus interaction state only.

import * as Tooltip from "@radix-ui/react-tooltip";
import { Layers, OctagonAlert, Play, Upload } from "lucide-react";
import { MotionConfig } from "motion/react";
import React, { useCallback, useRef, useState } from "react";
import { CHROME_ICONS, MODE_ICONS, useReducedMotion } from "../design/components.tsx";
import { TOKENS } from "../design/tokens.ts";
import {
  Button,
  ChromeDialog,
  ChromePopover,
  ChromeTooltip,
  DisabledReason,
  EmptyState,
  LayerRow,
  MountMotion,
  StatusBadge,
  buttonClass,
} from "../design/ui.tsx";
import { negotiateCapabilities } from "../capabilities/negotiate.ts";
import { useInteraction } from "../interaction/store.tsx";
import { MapView } from "../map/MapView.tsx";
import { NarrativePanel, ReportPanel } from "../narrative/panels.tsx";
import { MAX_PACKAGE_BYTES, PACKAGE_SCHEMA_VERSION, validatePackage } from "../package-adapter/validate.ts";
import type { SceneModel } from "../scene-model/types.ts";
import { createEmptyScene } from "../scene-model/types.ts";
import { ThreeViewport } from "../three/ThreeViewport.tsx";

const MODES = ["map", "3d", "split", "narrative", "report"] as const;

export const LAYER_COLORS: string[] = [...TOKENS.cat];

export function layerColor(slot: number): string {
  return LAYER_COLORS[((slot % LAYER_COLORS.length) + LAYER_COLORS.length) % LAYER_COLORS.length]!;
}

const DISABLED_3D_REASON =
  "Needs located 3D evidence — import a validated package with anchored metric geometry to enable 3D and Split.";

const MODE_BASE =
  "inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-transparent " +
  "px-2.5 py-1.5 text-[13px] text-white transition-colors hover:border-white/40 " +
  "max-[900px]:min-h-[44px] max-[900px]:flex-1 max-[900px]:px-1";
const MODE_ACTIVE = "border-accent bg-accent font-bold underline underline-offset-4 decoration-2";
const MODE_DISABLED = "cursor-not-allowed border-white/20 opacity-55 hover:border-white/20";

const ACTION_BTN =
  "inline-flex min-h-[36px] min-w-[36px] items-center justify-center gap-1.5 rounded-md border " +
  "border-white/30 bg-transparent px-2 py-1 text-[13px] font-semibold text-white transition-colors " +
  "hover:border-white max-[900px]:min-h-[44px] max-[900px]:min-w-[44px]";

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
          <Button
            type="button"
            data-testid="btn-error-reset"
            onClick={() => this.setState({ failed: false, message: "" })}
          >
            Reset view
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ImportForm({
  onImport,
  errors,
  fileName,
}: {
  onImport: (file: File) => void;
  errors: string[];
  fileName: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <section
      aria-label="Package import"
      className={`rounded-md border-2 border-dashed p-3 ${dragging ? "border-accent bg-raised" : "border-line"}`}
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
      <p className="m-0 text-xs text-muted">
        JSON only · max {MAX_PACKAGE_BYTES / (1024 * 1024)} MB · validated locally, never uploaded.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="muse-import-input" className={`${buttonClass("primary")} cursor-pointer`}>
          <Upload size={16} aria-hidden="true" /> Choose JSON file
        </label>
        <span className="text-xs text-muted" data-testid="import-filename">
          {fileName ?? "No file chosen"}
        </span>
      </div>
      <input
        ref={inputRef}
        id="muse-import-input"
        type="file"
        accept="application/json,.json"
        className="sr-only"
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      {errors.length > 0 && (
        <ul className="errors m-0 mt-2 list-disc pl-5 text-xs" data-testid="import-errors" role="alert">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function layerTitleOf(scene: SceneModel, layerId: string): string {
  return scene.layers.find((l) => l.id === layerId)?.title ?? "Study layer";
}

function featureLabelOf(scene: SceneModel, featureId: string): string {
  return scene.features.find((f) => f.id === featureId)?.label ?? "Linked evidence";
}

function formatDepth(elevationMeters: number | null): string {
  if (elevationMeters === null || !Number.isFinite(elevationMeters)) return "Surface position (no validated depth)";
  if (elevationMeters === 0) return "0 m (datum)";
  if (elevationMeters < 0) return `${Math.abs(elevationMeters)} m below datum`;
  return `${elevationMeters} m above datum`;
}

function Inspector({ scene, onClose }: { scene: SceneModel; onClose: () => void }) {
  const { state, dispatch } = useInteraction();
  const selected = scene.features.find((f) => f.id === state.activeFeatureId) ?? null;
  if (!selected) return null;
  const layer = scene.layers.find((l) => l.id === selected.layerId) ?? null;
  const slot = Math.max(0, scene.layers.findIndex((l) => l.id === selected.layerId));
  const g = selected.geometry;
  const linkedNarrative = scene.narrative.filter((n) => n.featureIds.includes(selected.id));
  const linkedReports = scene.reports.filter((r) => r.featureIds.includes(selected.id));
  const positionText =
    g.kind === "point"
      ? `${g.coordinates[0].toFixed(4)}, ${g.coordinates[1].toFixed(4)} (lon, lat)`
      : g.kind === "line"
        ? `${g.coordinates.length} vertices, WGS84 lon/lat`
        : `polygon, ${g.coordinates[0]?.length ?? 0} ring vertices, WGS84 lon/lat`;
  const CloseIcon = CHROME_ICONS.close;
  return (
    <MountMotion id={`inspector-${selected.id}`} direction="right">
      <aside className="inspector-card" data-testid="inspector" aria-label="Evidence inspector">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-sm font-semibold">{selected.label}</h2>
          <button
            className={buttonClass("icon")}
            style={{ marginLeft: "auto" }}
            type="button"
            data-testid="btn-inspector-close"
            aria-label="Close inspector"
            title="Close inspector"
            onClick={onClose}
          >
            <CloseIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <dl>
          <dt>Feature</dt>
          <dd data-testid="inspector-feature-id">{selected.label}</dd>
          <dt>Layer</dt>
          <dd>
            <span
              className="swatch"
              style={{ background: layerColor(slot) }}
              aria-hidden="true"
            />{" "}
            {layer?.title ?? selected.layerId} · {layer?.capabilityId ?? "unknown"}
            {layer?.referenceKind === "water-level" && <span className="ref-tag">reference: water level</span>}
          </dd>
          <dt>Position</dt>
          <dd>{positionText}</dd>
          <dt>Depth</dt>
          <dd data-testid="inspector-depth">
            {formatDepth(g.elevationMeters)} · meters, validated
          </dd>
          {g.uncertaintyMeters !== null && (
            <>
              <dt>Uncertainty</dt>
              <dd data-testid="inspector-uncertainty">
                ±{g.uncertaintyMeters} m
                {selected.uncertaintyEastingMinMeters !== null &&
                  ` east of ${selected.uncertaintyEastingMinMeters} m local easting`}
              </dd>
            </>
          )}
          {g.dipDegrees !== null && (
            <>
              <dt>Dip</dt>
              <dd data-testid="inspector-dip">{g.dipDegrees}° schematic (not a surveyed strike)</dd>
            </>
          )}
          <dt>Provenance</dt>
          <dd data-testid="inspector-provenance">
            {scene.provenance.length > 0
              ? scene.provenance.map((p) => `${p.sourceCrs} → ${p.targetFrame} (${p.transformedAt})`).join("; ")
              : "No transform provenance recorded"}
          </dd>
        </dl>
        <Button
          type="button"
          data-testid="btn-show-on-map"
          title="Frame the selected evidence on the map"
          onClick={() => {
            const handle = (window as unknown as {
              __museMap?: { fitSelection?: () => void };
            }).__museMap;
            handle?.fitSelection?.();
          }}
        >
          Show on map
        </Button>
        {(linkedNarrative.length > 0 || linkedReports.length > 0) && (
          <div>
            <h3>Linked evidence</h3>
            <div className="chips">
              {linkedNarrative.map((n) => (
                <button
                  key={n.id}
                  className="chip"
                  type="button"
                  data-testid={`inspector-narrative-${n.id}`}
                  title={n.title}
                  onClick={() => dispatch({ type: "setMode", viewMode: "narrative" })}
                >
                  {n.title}
                </button>
              ))}
              {linkedReports.map((r) => (
                <button
                  key={r.id}
                  className="chip"
                  type="button"
                  data-testid={`inspector-report-${r.id}`}
                  title={r.title}
                  onClick={() => dispatch({ type: "setMode", viewMode: "report" })}
                >
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </MountMotion>
  );
}

export function App() {
  const { state, dispatch } = useInteraction();
  const [scene, setScene] = useState<SceneModel>(() => createEmptyScene(PACKAGE_SCHEMA_VERSION));
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [mapBooted, setMapBooted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const reducedMotion = useReducedMotion();
  const onReady = useCallback(() => setMapBooted(true), []);

  const threeBlocked = !scene.has3DEvidence;
  const emptyScene = scene.metadata === null;
  const negotiation = negotiateCapabilities({
    layerCapabilityIds: scene.layers.map((l) => l.capabilityId),
    featureCount: scene.features.length,
  });

  function handleImport(file: File) {
    setImportErrors([]);
    setImportFileName(file.name);
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
        setTourStep(0);
        setImportOpen(false);
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
    setImportFileName(null);
    setTourStep(0);
    dispatch({ type: "reset" });
  }

  function runTour() {
    const handle = (window as unknown as {
      __museMap?: { fitStudy?: () => void };
    }).__museMap;
    if (tourStep === 0) {
      handle?.fitStudy?.();
      setTourStep(1);
      if (!threeBlocked) dispatch({ type: "setMode", viewMode: "map" });
    } else if (!threeBlocked) {
      dispatch({ type: "setMode", viewMode: "3d" });
      setTourStep(0);
    }
  }

  const selected = scene.features.find((f) => f.id === state.activeFeatureId) ?? null;
  const modeLabel: Record<string, string> = {
    map: "Map",
    "3d": "3D",
    split: "Split",
    narrative: "Narrative",
    report: "Report",
  };
  const spatialMode = state.viewMode === "map" || state.viewMode === "3d" || state.viewMode === "split";
  const behindMap = state.viewMode === "narrative" || state.viewMode === "report";
  const showMap = spatialMode || (behindMap && !emptyScene);
  const HelpIcon = CHROME_ICONS.help;

  function modeButton(mode: (typeof MODES)[number]) {
    const Icon = MODE_ICONS[mode]!;
    const pressed = state.viewMode === mode;
    const label = modeLabel[mode]!;
    const testId = `mode-${mode}`;
    const blocked = (mode === "3d" || mode === "split") && threeBlocked;
    const control = (
      <button
        type="button"
        data-testid={testId}
        disabled={blocked}
        aria-pressed={pressed}
        title={blocked ? DISABLED_3D_REASON : label}
        className={`${MODE_BASE} ${pressed ? MODE_ACTIVE : ""} ${blocked ? MODE_DISABLED : ""}`}
        onClick={() => dispatch({ type: "setMode", viewMode: mode })}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="max-[900px]:text-xs">{label}</span>
      </button>
    );
    if (blocked) {
      return (
        <DisabledReason key={mode} reason={DISABLED_3D_REASON} reasonId={`${testId}-reason`}>
          {control}
        </DisabledReason>
      );
    }
    return (
      <ChromeTooltip key={mode} label={label}>
        {control}
      </ChromeTooltip>
    );
  }

  const spatialTrigger = (
    <button type="button" data-testid="btn-spatial" aria-label="Layers and selection" title="Layers and selection" className={ACTION_BTN}>
      <Layers size={16} aria-hidden="true" />
      <span className="hidden min-[901px]:inline">Layers</span>
    </button>
  );

  const importTrigger = (
    <button type="button" data-testid="btn-import" aria-label="Import package" title="Import package" className={ACTION_BTN}>
      <Upload size={16} aria-hidden="true" />
      <span className="hidden min-[901px]:inline">Import</span>
    </button>
  );

  const limitsTrigger = (
    <button
      type="button"
      data-testid="btn-limits"
      aria-label={`Limitations, ${scene.limitations.length}`}
      title={`Limitations (${scene.limitations.length}) — genuine constraints stay discoverable here`}
      className={ACTION_BTN}
    >
      <OctagonAlert size={16} aria-hidden="true" />
      <span aria-hidden="true" className="text-xs font-bold">
        {scene.limitations.length}
      </span>
    </button>
  );

  const helpTrigger = (
    <button
      type="button"
      data-testid="btn-help"
      aria-label="How to use this observatory"
      title="How to use this observatory"
      className={ACTION_BTN}
    >
      <HelpIcon size={16} aria-hidden="true" />
    </button>
  );

  return (
    <ShellErrorBoundary>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider delayDuration={200}>
          <div className="shell" data-testid="app-shell" data-mode={state.viewMode}>
            <header className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 bg-ink px-3 py-2 text-white min-[901px]:h-[52px] min-[901px]:flex-nowrap min-[901px]:py-0">
              <h1 className="m-0 flex items-center gap-2 text-base font-semibold whitespace-nowrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3v18M3 12h18" />
                </svg>
                Muse
                <span className="hidden font-normal text-white/70 lg:inline">· Adaptive Visualization</span>
              </h1>
              <div className="hidden min-w-0 flex-1 min-[901px]:block">
                <StatusBadge
                  tone={emptyScene ? "idle" : "ready"}
                  testId="package-status"
                >
                  {emptyScene ? "No package loaded" : `Package: ${scene.metadata?.title ?? "Imported package"}`}
                </StatusBadge>
              </div>
              <nav aria-label="Application modes" className="order-3 flex min-w-0 basis-full gap-1 min-[901px]:order-none min-[901px]:basis-auto">
                {MODES.map(modeButton)}
              </nav>
              <div className="ml-auto flex items-center gap-1 min-[901px]:ml-0">
                {!emptyScene && tourStep <= 1 && (
                  <ChromeTooltip label={tourStep === 0 ? "Guided first view: frame the study, then open 3D" : "Open the 3D overview"}>
                    <button
                      type="button"
                      data-testid="btn-tour"
                      title="Guided first view: frame the study, then open 3D"
                      onClick={runTour}
                      className={ACTION_BTN}
                    >
                      <Play size={16} aria-hidden="true" />
                      <span className="hidden text-xs xl:inline">
                        {tourStep === 0 ? "Start tour" : threeBlocked ? "Study framed" : "Open 3D overview"}
                      </span>
                    </button>
                  </ChromeTooltip>
                )}
                <ChromePopover
                  trigger={spatialTrigger}
                  label="Layers and selection"
                  testId="spatial-popover"
                >
                  <SpatialPanel
                    scene={scene}
                    selectedLabel={selected ? selected.label : null}
                    selectedLayerId={selected?.layerId ?? null}
                    negotiationNote={negotiation.kind === "no-evidence" ? negotiation.reason : null}
                    onClear={emptyScene ? undefined : clearPackage}
                  />
                </ChromePopover>
                <ChromeDialog
                  trigger={importTrigger}
                  title="Import package"
                  description="Validated locally in your browser. Nothing is uploaded."
                  testId="import-dialog"
                  open={importOpen}
                  onOpenChange={setImportOpen}
                >
                  <ImportForm onImport={handleImport} errors={importErrors} fileName={importFileName} />
                </ChromeDialog>
                <ChromePopover trigger={limitsTrigger} label="Limitations" testId="limits-popover" open={limitsOpen} onOpenChange={setLimitsOpen}>
                  <div>
                    <h2 className="m-0 text-sm font-semibold text-ink">
                      Limitations{scene.limitations.length > 0 && ` (${scene.limitations.length})`}
                    </h2>
                    <div data-testid="limitations" className="mt-2 text-xs text-ink">
                      {scene.limitations.length === 0 ? (
                        <EmptyState>No additional constraints recorded.</EmptyState>
                      ) : (
                        <ul className="m-0 list-disc pl-5">
                          {scene.limitations.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button variant="ghost" type="button" data-testid="btn-limit-dismiss" onClick={() => setLimitsOpen(false)}>
                        Close limitations
                      </Button>
                    </div>
                  </div>
                </ChromePopover>
                <ChromeDialog
                  trigger={helpTrigger}
                  title="How to use this observatory"
                  testId="help-panel"
                  open={helpOpen}
                  onOpenChange={setHelpOpen}
                >
                  <div className="text-sm text-ink">
                    <h2 className="text-sm font-semibold">Orienting</h2>
                    <p className="text-xs text-muted">
                      Import a validated JSON package. Use Start tour for the recommended first view:
                      the map frames the study, then the 3D overview opens.
                    </p>
                    <h2 className="text-sm font-semibold">Investigating</h2>
                    <p className="text-xs text-muted">
                      Select any feature on the map, in 3D, or from narrative/report chips — selection
                      is shared everywhere. The inspector carries depth, uncertainty, and provenance.
                      Clip at water level isolates the subsurface reading. Vertical exaggeration is
                      schematic, never measured scale.
                    </p>
                    <p className="text-xs text-muted">
                      Validated local packages only — nothing is uploaded. Map credit lives on the
                      map attribution control; 3D positions are local schematic meters, never
                      surveyed coordinates.
                    </p>
                    <div className="mt-3 flex justify-end">
                      <Button type="button" data-testid="btn-help-close" onClick={() => setHelpOpen(false)}>
                        Close help
                      </Button>
                    </div>
                  </div>
                </ChromeDialog>
              </div>
            </header>

            <main className="stage" data-testid="stage">
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
              {!emptyScene && spatialMode && (
                <div className="studybar" data-testid="studybar">
                  <h2>{scene.metadata?.title}</h2>
                  <span className="counts" data-testid="studybar-counts">
                    {scene.features.length} features · {scene.layers.length} layers ·{" "}
                    {scene.narrative.length} findings · {scene.reports.length} report sections
                  </span>
                  {scene.features.some((f) => f.geometry.uncertaintyMeters !== null) && (
                    <span className="counts" data-testid="studybar-uncertainty">
                      carries stated uncertainty — see inspector
                    </span>
                  )}
                </div>
              )}
              {showMap && (
                <div className={state.viewMode === "split" ? "splitpane" : "fullpane"}>
                  {(state.viewMode === "map" || state.viewMode === "split" || behindMap) && (
                    <MapView scene={scene} onReady={onReady} dimmed={behindMap} reducedMotion={reducedMotion} />
                  )}
                  {(state.viewMode === "3d" || state.viewMode === "split") && (
                    <ThreeViewport
                      enabledReason={
                        threeBlocked
                          ? "No located 3D evidence yet. Import a validated package with anchored metric geometry to enable 3D."
                          : null
                      }
                      scene={scene}
                      activeFeatureId={state.activeFeatureId}
                      reducedMotion={reducedMotion}
                    />
                  )}
                </div>
              )}
              {state.viewMode === "narrative" && (
                <MountMotion id="narrative-drawer" direction="right">
                  <div className="sheet-card" data-testid="narrative-drawer" role="complementary" aria-label="Narrative drawer">
                    <NarrativePanel items={scene.narrative} labelOf={(id) => featureLabelOf(scene, id)} />
                  </div>
                </MountMotion>
              )}
              {state.viewMode === "report" && (
                <MountMotion id="report-drawer" direction="right">
                  <div className="sheet-card" data-testid="report-drawer" role="complementary" aria-label="Report drawer">
                    <ReportPanel sections={scene.reports} labelOf={(id) => featureLabelOf(scene, id)} />
                  </div>
                </MountMotion>
              )}
              {selected && spatialMode && (
                <Inspector scene={scene} onClose={() => dispatch({ type: "select", featureId: null })} />
              )}
            </main>
          </div>
        </Tooltip.Provider>
      </MotionConfig>
    </ShellErrorBoundary>
  );
}

function SpatialPanel({
  scene,
  selectedLabel,
  selectedLayerId,
  negotiationNote,
  onClear,
}: {
  scene: SceneModel;
  selectedLabel: string | null;
  selectedLayerId: string | null;
  negotiationNote: string | null;
  onClear?: () => void;
}) {
  const { state, dispatch } = useInteraction();
  return (
    <div>
      <h2 className="m-0 text-sm font-semibold text-ink">Layers</h2>
      <div className="mt-1">
        <LayerRow
          checked
          onChange={() => {}}
          disabled
          title="Basemap is always on"
          swatch={<span className="swatch" style={{ background: "#8A9BA8" }} aria-hidden="true" />}
          label="Basemap"
          testId="layer-toggle-basemap"
        />
        {scene.layers.length === 0 && (
          <EmptyState testId="layers-empty">No study layers yet.</EmptyState>
        )}
        {scene.layers.map((layer, i) => (
          <LayerRow
            key={layer.id}
            checked={state.activeLayerIds.includes(layer.id)}
            onChange={() => dispatch({ type: "toggleLayer", layerId: layer.id })}
            swatch={<span className="swatch" style={{ background: layerColor(i) }} aria-hidden="true" />}
            label={layer.title}
            detail={layer.capabilityId}
            count={layer.featureIds.length}
            testId={`layer-toggle-${layer.id}`}
            referenceTag={layer.referenceKind === "water-level" ? "reference" : undefined}
          />
        ))}
      </div>
      <h2 className="mt-3 text-sm font-semibold text-ink">Selection</h2>
      <div data-testid="selection-details" className="mt-1 text-xs text-ink">
        {selectedLabel !== null ? (
          <p className="m-0">
            <strong>{selectedLabel}</strong>
            <br />
            <span className="text-muted">
              {layerTitleOf(scene, selectedLayerId ?? "")}
            </span>
          </p>
        ) : (
          <EmptyState>Nothing selected.</EmptyState>
        )}
      </div>
      {negotiationNote !== null && (
        <p className="mt-2 text-xs text-muted">Capabilities: {negotiationNote}</p>
      )}
      {onClear !== undefined && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" type="button" data-testid="btn-clear-package" onClick={onClear}>
            Clear package
          </Button>
        </div>
      )}
    </div>
  );
}
