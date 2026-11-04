import { ScientificUIModel } from '../types/scientific';
import { AgenticStudyAdapter } from './AgenticStudyAdapter';
import { ScientificPackageLoader } from './ScientificPackageLoader';

export class PackageIngestion {
  static parse(raw: unknown): ScientificUIModel {
    if (AgenticStudyAdapter.isAgenticPackage(raw)) {
      return ScientificPackageLoader.parse(AgenticStudyAdapter.adapt(raw));
    }
    return ScientificPackageLoader.parse(raw as Parameters<typeof ScientificPackageLoader.parse>[0]);
  }
}
