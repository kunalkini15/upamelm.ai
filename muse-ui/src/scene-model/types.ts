// Typed internal scene model. Renderers consume these types plus the
// interaction state; they never read raw package JSON (BASELINE.md A2).
//
// Extension fields (uncertaintyMeters, dipDegrees, referenceKind) are generic
// geometric facts with units and provenance. They describe no document, place,
// publisher, or report, and no renderer branches on package identity.

export type LonLat = [number, number];

export interface SharedVerticalEvidence {
  /** Symmetric half-range in meters (total band = 2x). Null = unknown. */
  uncertaintyMeters: number | null;
}

/** Declared dip of a planar feature in degrees from horizontal, 0-90. Null = unknown/vertical-agnostic. */
export type DipDegrees = number | null;

export type SceneGeometry =
  | {
      kind: "point";
      coordinates: LonLat;
      elevationMeters: number | null;
      uncertaintyMeters: number | null;
      dipDegrees: null;
    }
  | {
      kind: "line";
      coordinates: LonLat[];
      elevationMeters: number | null;
      uncertaintyMeters: number | null;
      dipDegrees: DipDegrees;
    }
  | {
      kind: "polygon";
      coordinates: LonLat[][];
      elevationMeters: number | null;
      uncertaintyMeters: number | null;
      dipDegrees: DipDegrees;
    };

export interface SceneFeature {
  id: string;
  layerId: string;
  label: string;
  geometry: SceneGeometry;
  /**
   * Generic local-frame easting bound (meters, equirectangular about the
   * study anchor): when set alongside uncertaintyMeters, the uncertainty
   * applies only at/after this easting. Null = applies to the whole feature.
   */
  uncertaintyEastingMinMeters: number | null;
}

export type ReferenceKind = "water-level" | null;

export interface SceneLayer {
  id: string;
  title: string;
  capabilityId: string;
  visible: boolean;
  featureIds: string[];
  /** Generic reference-plane role for validated planar layers. Null = ordinary evidence. */
  referenceKind: ReferenceKind;
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

/** Finite-number guard shared by adapter and unit tests. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** uncertaintyMeters must be a finite number >= 0 (0 = measured exactly). */
export function isValidUncertainty(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1_000_000;
}

/** dipDegrees must be a finite number in [0, 90]. */
export function isValidDip(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 90;
}
