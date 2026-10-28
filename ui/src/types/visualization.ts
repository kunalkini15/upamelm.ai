/**
 * Future visualisation assets (Phase 2+).
 *
 * Placeholders only: Phase 1 renders empty states where these assets will go.
 * Cross-sections and 3D scenes are generated from validated findings —
 * never hand-authored — so each asset records the observations it depicts.
 */

export type VisualisationKind = 'cross-section' | 'model-3d' | 'diagram' | 'chart';

export type VisualisationStatus = 'forthcoming' | 'generating' | 'ready';

export interface VisualisationAsset {
  id: string;
  locationId: string;
  kind: VisualisationKind;
  title: string;
  description: string;
  status: VisualisationStatus;
  /** Asset URL once generated (model file, image, …). */
  assetUrl?: string;
  /** Observations this visual depicts. Empty means "not yet backed by evidence". */
  observationIds: string[];
  generatedAt?: string;
  generatorVersion?: string;
}
