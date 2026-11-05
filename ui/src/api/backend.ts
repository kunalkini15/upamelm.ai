export interface SelectionParams {
  city?: string;
  study?: string;
  language?: string;
}

export interface CitySummary {
  id: string;
  label: string;
  studyCount: number;
  defaultStudy: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  bbox: [number, number, number, number] | null;
  defaultZoom: number | null;
}

export interface StudySummary {
  id: string;
  studyId: string | null;
  documentId: string | null;
  title: string;
  publisher: string | null;
  publicationDate: string | null;
  languages: string[];
  defaultLanguage: string;
  schemaVersion: string | null;
  primaryRenderingMode: string | null;
  status: unknown;
}

export interface LanguageSummary {
  code: string;
  label: string;
  nativeLabel: string;
}

export interface BootstrapResponse {
  selection: Required<SelectionParams>;
  cities: CitySummary[];
  studies: StudySummary[];
  availableLanguages: LanguageSummary[];
  assetBaseUrl: string;
  package: unknown;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

function apiRequestUrl(path: string): string {
  return configuredBaseUrl ? `${configuredBaseUrl}${path}` : path;
}

export function resolveApiUrl(path: string, origin = window.location.origin): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = configuredBaseUrl
    ? new URL(configuredBaseUrl, origin).origin
    : origin;
  return new URL(path, `${base}/`).href;
}

export async function fetchBootstrap(
  selection: SelectionParams = {},
  signal?: AbortSignal,
): Promise<BootstrapResponse> {
  const params = new URLSearchParams();
  if (selection.city) params.set('city', selection.city);
  if (selection.study) params.set('study', selection.study);
  if (selection.language) params.set('language', selection.language);
  const query = params.toString();
  const response = await fetch(apiRequestUrl(`/api/v1/bootstrap${query ? `?${query}` : ''}`), {
    signal,
    headers: { Accept: 'application/json' },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const backendError = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    throw new BackendError(
      typeof backendError?.message === 'string' ? backendError.message : `Backend request failed with status ${response.status}.`,
      typeof backendError?.code === 'string' ? backendError.code : 'request_failed',
      response.status,
    );
  }
  return validateBootstrap(body);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BackendError('The backend returned a malformed JSON response.', 'malformed_response', response.status);
  }
}

function validateBootstrap(value: unknown): BootstrapResponse {
  if (!isRecord(value) || !isRecord(value.selection)) malformed();
  const selection = value.selection;
  if (![selection.city, selection.study, selection.language].every((item) => typeof item === 'string' && item.length > 0)) malformed();
  if (!Array.isArray(value.cities) || !Array.isArray(value.studies) || !Array.isArray(value.availableLanguages)) malformed();
  if (value.package == null) malformed();

  const cities = value.cities.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.studyCount !== 'number') malformed();
    const coordinates = isRecord(item.geometry) && item.geometry.type === 'Point' && Array.isArray(item.geometry.coordinates)
      && item.geometry.coordinates.length === 2 && item.geometry.coordinates.every((entry: unknown) => typeof entry === 'number')
      ? item.geometry.coordinates as [number, number]
      : null;
    const bbox = Array.isArray(item.bbox) && item.bbox.length === 4 && item.bbox.every((entry: unknown) => typeof entry === 'number')
      ? item.bbox as [number, number, number, number]
      : null;
    return {
      id: item.id,
      label: item.label,
      studyCount: item.studyCount,
      defaultStudy: typeof item.defaultStudy === 'string' ? item.defaultStudy : null,
      geometry: coordinates ? { type: 'Point' as const, coordinates } : null,
      bbox,
      defaultZoom: typeof item.defaultZoom === 'number' ? item.defaultZoom : null,
    };
  });
  const studies = value.studies.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string' || !Array.isArray(item.languages) || typeof item.defaultLanguage !== 'string') malformed();
    return item as unknown as StudySummary;
  });
  const availableLanguages = value.availableLanguages.map((item) => {
    if (!isRecord(item) || typeof item.code !== 'string' || typeof item.label !== 'string' || typeof item.nativeLabel !== 'string') malformed();
    return item as unknown as LanguageSummary;
  });

  return {
    selection: selection as unknown as Required<SelectionParams>,
    cities,
    studies,
    availableLanguages,
    assetBaseUrl: typeof value.assetBaseUrl === 'string' && value.assetBaseUrl.length
      ? value.assetBaseUrl
      : `/api/v1/cities/${encodeURIComponent(selection.city)}/studies/${encodeURIComponent(selection.study)}/files/`,
    package: value.package,
  };
}

function malformed(): never {
  throw new BackendError('The backend response does not match the bootstrap contract.', 'malformed_response', 200);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
