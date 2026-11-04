// Validated package boundary: the single adapter between raw input and the
// typed scene model. Schema/version is checked before activation; declared
// capabilities are mapped (never document/study/city/filename/publisher/domain
// branches); malformed geometry is quarantined per feature; unknown fields are
// preserved verbatim without effect on rendering (BASELINE.md K1-K3).

import { boundsOfFeatures, isValidGeometry } from "../scene-model/coordinates.ts";
import { isSupportedCrs, transformToWgs84 } from "../scene-model/transform.ts";
import type {
  CoordinateProvenance,
  SceneFeature,
  SceneGeometry,
  SceneLayer,
  SceneModel,
} from "../scene-model/types.ts";
import { createEmptyScene } from "../scene-model/types.ts";

// Fixed oracle for every validation test and error message.
export const PACKAGE_SCHEMA_VERSION = "muse-scene-package.v1";
export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;

// Reusable geometric capability vocabulary. Renderers key off these ids;
// package-declared strings outside this list become limitations, never views.
export const KNOWN_CAPABILITY_IDS = [
  "point-observation",
  "path",
  "region",
  "vertical-profile",
  "time-series",
  "network",
] as const;

export interface ValidationSuccess {
  ok: true;
  scene: SceneModel;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDisplayText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function adaptGeometry(raw: unknown, crs: string): SceneGeometry | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (kind === "point" || kind === "line" || kind === "polygon") {
    const candidate = {
      kind,
      coordinates: raw.coordinates,
      elevationMeters:
        raw.elevationMeters === null || typeof raw.elevationMeters === "number"
          ? raw.elevationMeters
          : null,
    };
    if (crs === "EPSG:4326" && isValidGeometry(candidate)) return candidate;
  }
  // Projected positions arrive as { kind, xy: [...] } in the declared CRS.
  if ((kind === "projected-point" || kind === "projected-line") && isSupportedCrs(crs)) {
    const xy = raw.xy;
    const lists: number[][][] =
      kind === "projected-point" ? [xy as number[][]] : (xy as number[][][]);
    if (!Array.isArray(lists)) return null;
    const lonlats = [];
    for (const list of lists) {
      if (!Array.isArray(list)) return null;
      const ring = [];
      for (const pair of list) {
        if (!Array.isArray(pair) || pair.length !== 2) return null;
        const t = transformToWgs84(crs, pair[0], pair[1]);
        if (!t) return null;
        ring.push(t.lonlat);
      }
      lonlats.push(ring);
    }
    if (kind === "projected-point" && lonlats[0]?.length === 1) {
      return { kind: "point", coordinates: lonlats[0][0], elevationMeters: null };
    }
    if (kind === "projected-line" && lonlats[0]?.length >= 2) {
      return { kind: "line", coordinates: lonlats[0], elevationMeters: null };
    }
  }
  return null;
}

export function validatePackage(raw: unknown): ValidationSuccess | ValidationFailure {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["Package must be a JSON object."] };
  }
  // Version gate first: a missing or unexpected schema_version rejects the
  // whole package before any activation.
  if (raw.schema_version !== PACKAGE_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `Unsupported package schema: expected "${PACKAGE_SCHEMA_VERSION}" but found ${JSON.stringify(raw.schema_version ?? null)}.`,
      ],
    };
  }

  const limitations: string[] = [];
  const unresolved: string[] = [];
  const provenance: CoordinateProvenance[] = [];
  const layers: SceneLayer[] = [];
  const features: SceneFeature[] = [];

  const declaredCrs =
    typeof raw.crs === "string" && raw.crs.length > 0 ? raw.crs : "EPSG:4326";
  if (!isSupportedCrs(declaredCrs)) {
    unresolved.push(
      `Declared CRS "${declaredCrs}" is not supported (${["EPSG:4326", "EPSG:3857"].join(", ")}); spatial content stays unlocated.`,
    );
  }

  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
  const layerIds = new Set<string>();
  for (const entry of rawLayers) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      limitations.push("Skipped a layer entry without a string id.");
      continue;
    }
    const capabilityId = typeof entry.capability === "string" ? entry.capability : "";
    if (!(KNOWN_CAPABILITY_IDS as readonly string[]).includes(capabilityId)) {
      limitations.push(
        `Layer "${entry.id}" declares unknown capability "${capabilityId || "(none)"}; it is listed but not rendered.`,
      );
      continue;
    }
    layerIds.add(entry.id);
    layers.push({
      id: entry.id,
      title: toDisplayText(entry.title, entry.id),
      capabilityId,
      visible: true,
      featureIds: [],
    });
  }

  const rawFeatures = Array.isArray(raw.features) ? raw.features : [];
  const seenFeatureIds = new Set<string>();
  for (const entry of rawFeatures) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.layer !== "string") {
      limitations.push("Skipped a feature entry without string id/layer.");
      continue;
    }
    if (seenFeatureIds.has(entry.id)) {
      limitations.push(`Skipped duplicate feature id "${entry.id}".`);
      continue;
    }
    if (!layerIds.has(entry.layer)) {
      limitations.push(
        `Skipped feature "${entry.id}": layer "${entry.layer}" is not a rendered layer.`,
      );
      continue;
    }
    const geometry = isSupportedCrs(declaredCrs)
      ? adaptGeometry(entry.geometry, declaredCrs)
      : null;
    if (!geometry) {
      limitations.push(
        `Skipped feature "${entry.id}": geometry is malformed, out of range, or in an unsupported CRS.`,
      );
      continue;
    }
    seenFeatureIds.add(entry.id);
    features.push({
      id: entry.id,
      layerId: entry.layer,
      label: toDisplayText(entry.label, entry.id),
      geometry,
    });
    layers.find((l) => l.id === entry.layer)?.featureIds.push(entry.id);
  }

  const narrative = Array.isArray(raw.narrative)
    ? raw.narrative.filter(isRecord).map((n, i) => ({
        id: typeof n.id === "string" ? n.id : `narrative-${i}`,
        title: toDisplayText(n.title, `Insight ${i + 1}`),
        body: toDisplayText(n.body, ""),
        featureIds: Array.isArray(n.features)
          ? n.features.filter((f): f is string => typeof f === "string")
          : [],
      }))
    : [];

  const reports = Array.isArray(raw.reports)
    ? raw.reports.filter(isRecord).map((r, i) => ({
        id: typeof r.id === "string" ? r.id : `report-${i}`,
        title: toDisplayText(r.title, `Section ${i + 1}`),
        body: toDisplayText(r.body, ""),
        featureIds: Array.isArray(r.features)
          ? r.features.filter((f): f is string => typeof f === "string")
          : [],
      }))
    : [];

  if (Array.isArray(raw.limitations)) {
    for (const l of raw.limitations) {
      if (typeof l === "string") limitations.push(l.slice(0, 500));
    }
  }
  if (Array.isArray(raw.unresolved)) {
    for (const u of raw.unresolved) {
      if (typeof u === "string") unresolved.push(u.slice(0, 500));
    }
  }

  // Preserve unknown top-level fields verbatim; they are never read back as
  // render instructions.
  const knownKeys = new Set([
    "schema_version",
    "crs",
    "metadata",
    "layers",
    "features",
    "narrative",
    "reports",
    "limitations",
    "unresolved",
  ]);
  const rawUnknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!knownKeys.has(key)) rawUnknown[key] = value;
  }

  const geometries = features.map((f) => f.geometry);
  const bounds = boundsOfFeatures(geometries);
  const empty = createEmptyScene(PACKAGE_SCHEMA_VERSION);
  // Generic 3D gate: a validated located anchor (bounds) plus at least one
  // validated finite height in meters. No document, layer, or place names are
  // consulted; missing heights simply leave 3D honestly disabled.
  const has3DEvidence =
    bounds !== null &&
    features.some(
      (f) =>
        typeof f.geometry.elevationMeters === "number" &&
        Number.isFinite(f.geometry.elevationMeters),
    );

  return {
    ok: true,
    scene: {
      ...empty,
      metadata: isRecord(raw.metadata)
        ? {
            title: toDisplayText(raw.metadata.title, "Imported package"),
            description: toDisplayText(raw.metadata.description, ""),
          }
        : { title: "Imported package", description: "" },
      layers,
      features,
      narrative,
      reports,
      limitations:
        limitations.length > 0
          ? limitations
          : ["Package accepted without limitations."],
      unresolved,
      provenance,
      rawUnknown,
      bounds,
      unlocated: bounds === null,
      has3DEvidence,
    },
  };
}
