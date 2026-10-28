/**
 * Evidence model: every scientific finding traces to its sources.
 *
 * Core integrity rule: a finding is only as strong as its evidence.
 * - `measured`: directly supported by a source observation.
 * - `interpreted`: derived through scientific interpretation or modelling.
 * - `unknown`: insufficient evidence exists.
 * Interpretations must never be presented as confirmed measurements.
 */

export type ConfidenceLevel = 'measured' | 'interpreted' | 'unknown';

export interface Confidence {
  level: ConfidenceLevel;
  /** Human-readable rationale, e.g. "CGWB pumping-test data, Table 4.2". */
  rationale?: string;
}

/** Government agency or institution that published a report. */
export type PublishingAgency =
  | 'CGWB'
  | 'GSI'
  | 'CWC'
  | 'IMD'
  | 'NRSC'
  | 'STATE_GROUNDWATER'
  | 'ACADEMIC'
  | 'OTHER';

/** A scientific source document (report, paper, map, dataset). */
export interface SourceDocument {
  id: string;
  title: string;
  agency: PublishingAgency;
  /** Free-text agency detail when `agency` is STATE_GROUNDWATER / ACADEMIC / OTHER. */
  agencyDetail?: string;
  publicationYear?: number;
  /** Canonical URL to the public report, when available. */
  url?: string;
  /** Total page count, when known. */
  pageCount?: number;
  language?: string;
  /** Processing state of this document in the AI pipeline. */
  processingStatus: DocumentProcessingStatus;
}

export type DocumentProcessingStatus =
  | 'registered'
  | 'queued'
  | 'extracting'
  | 'validating'
  | 'published'
  | 'failed';

/**
 * Page-level reference into a source document.
 * This is the atomic unit of traceability: observations cite pages/figures/tables.
 */
export interface PageCitation {
  documentId: string;
  /** 1-based page number. */
  page: number;
  /** Optional end page for ranges. */
  endPage?: number;
  /** Referenced figure/table/section label, e.g. "Fig. 3.1", "Table 4.2". */
  anchor?: string;
  /** Short verbatim excerpt or paraphrase underpinning the observation. */
  excerpt?: string;
}

/**
 * A single extracted scientific observation.
 * Raw material: one claim from one place in one document.
 */
export interface Observation {
  id: string;
  /** Structured payload; shape depends on the domain (see hydrogeology.ts). */
  kind: string;
  /** Plain-language statement of what was observed. */
  statement: string;
  citations: PageCitation[];
  confidence: Confidence;
  /** Location this observation applies to. */
  locationId: string;
  domainId: string;
  extractedAt?: string;
  /** Extraction provenance: model + pipeline version, for auditability. */
  provenance?: ExtractionProvenance;
}

export interface ExtractionProvenance {
  pipelineVersion: string;
  modelId: string;
  validatedBy?: 'human' | 'model' | 'unvalidated';
}
