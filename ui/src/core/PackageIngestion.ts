import { ScientificUIModel } from '../types/scientific';
import { AgenticStudyAdapter } from './AgenticStudyAdapter';
import { ScientificPackageLoader } from './ScientificPackageLoader';

/**
 * Unified entry point for parsing and normalizing incoming scientific packages.
 * Automatically detects whether the payload is from the legacy Research Engine
 * or the Agentic Study family (`document-study.v2`), converting it into a
 * single, canonical `ScientificUIModel`.
 */
export class PackageIngestion {
  /**
   * Parses an unknown raw JSON payload into a normalized ScientificUIModel.
   *
   * @param raw - Arbitrary raw study package JSON.
   * @param options - Ingestion options, such as `sourceBaseUrl` for relativizing external assets.
   * @returns Normalized ScientificUIModel consumed by all presentation components.
   */
  static parse(raw: unknown, options?: { sourceBaseUrl?: string }): ScientificUIModel {
    let model: ScientificUIModel;
    if (AgenticStudyAdapter.isAgenticPackage(raw)) {
      model = ScientificPackageLoader.parse(AgenticStudyAdapter.adapt(raw));
    } else {
      model = ScientificPackageLoader.parse(raw as Parameters<typeof ScientificPackageLoader.parse>[0]);
    }
    model.sourceBaseUrl = options?.sourceBaseUrl;
    return model;
  }
}
