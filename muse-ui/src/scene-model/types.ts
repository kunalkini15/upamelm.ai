// Typed internal scene model. Renderers consume these types plus the
// interaction state; they never read raw package JSON (BASELINE.md A2).

export type LonLat = [number, number];

export type SceneGeometry =
  | { kind: "point"; coordinates: LonLat; elevationMeters: number | null }
  | { kind: "line"; coordinates: LonLat[]; elevationMeters: number | null }
  | { kind: "polygon"; coordinates: LonLat[][]; elevationMeters: number | null };

export interface SceneFeature {
  id: string;
  layerId: string;
  label: string;
  geometry: SceneGeometry;
}

export interface SceneLayer {
  id: string;
  title: string;
  capabilityId: string;
  visible: boolean;
  featureIds: string[];
}

export interface NarrativeTarget {
  id: string;
  title: string;
  body: string;
  featureIds: string[];
}

export interface ReportSection {
  id: string;
  title: string;
  body: string;
  featureIds: string[];
}

export interface CoordinateProvenance {
  sourceCrs: string;
  targetFrame: "WGS84-lonlat" | "local-metric";
  transformedAt: string;
}

// The map boundary is always WGS84 longitude/latitude; the 3D boundary is an
// anchored local metric frame. They are separate facts (BASELINE.md C1/C4).
export interface ValidatedBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  crossesAntimeridian: boolean;
}

export interface SceneModel {
  schemaVersion: string;
  metadata: { title: string; description: string } | null;
  layers: SceneLayer[];
  features: SceneFeature[];
  narrative: NarrativeTarget[];
  reports: ReportSection[];
  limitations: string[];
  unresolved: string[];
  provenance: CoordinateProvenance[];
  // Unknown input fields preserved verbatim at the raw boundary; never
  // trusted as render instructions (BASELINE.md K2).
  rawUnknown: Record<string, unknown>;
  // True when no validated spatial bounds exist: the map must hold the world
  // view and never fabricate a focus (BASELINE.md C5).
  unlocated: boolean;
  bounds: ValidatedBounds | null;
  // True only when the package holds a validated located anchor (bounds)
  // plus at least one validated finite height in meters. The adapter derives
  // this generically from evidence; renderers never infer it from names.
  has3DEvidence: boolean;
}

export function createEmptyScene(schemaVersion: string): SceneModel {
  return {
    schemaVersion,
    metadata: null,
    layers: [],
    features: [],
    narrative: [],
    reports: [],
    limitations: ["No study evidence yet. Import a validated package to begin."],
    unresolved: [],
    provenance: [],
    rawUnknown: {},
    unlocated: true,
    bounds: null,
    has3DEvidence: false,
  };
}
