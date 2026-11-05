import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError, fetchBootstrap, resolveApiUrl } from './backend';

const validPayload = {
  selection: { city: 'bengaluru', study: 'SRC-LR-01', language: 'kn' },
  cities: [{ id: 'bengaluru', label: 'Bengaluru', studyCount: 5 }],
  studies: [{
    id: 'SRC-LR-01', studyId: 'study-1', documentId: 'doc-1', title: 'Study',
    publisher: null, publicationDate: null, languages: ['en', 'kn'], defaultLanguage: 'en',
    schemaVersion: 'document-study.v2', primaryRenderingMode: 'map', status: null,
  }],
  availableLanguages: [{ code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' }],
  assetBaseUrl: '/api/v1/cities/bengaluru/studies/SRC-LR-01/files/',
  package: { schema_version: 'document-study.v2' },
};

describe('backend client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('constructs a semantic bootstrap request and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = await fetchBootstrap({ city: 'bengaluru', study: 'SRC-LR-01', language: 'kn' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bootstrap?city=bengaluru&study=SRC-LR-01&language=kn',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(payload.selection.language).toBe('kn');
    expect(payload.studies[0].id).toBe('SRC-LR-01');
  });

  it('preserves structured backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'translation_not_found', message: "Language 'ta' is unavailable." },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } })));

    await expect(fetchBootstrap({ language: 'ta' })).rejects.toMatchObject<Partial<BackendError>>({
      code: 'translation_not_found',
      status: 404,
      message: "Language 'ta' is unavailable.",
    });
  });

  it('resolves package assets against the API origin', () => {
    expect(resolveApiUrl(validPayload.assetBaseUrl, 'http://localhost:5175')).toBe(
      'http://localhost:5175/api/v1/cities/bengaluru/studies/SRC-LR-01/files/',
    );
  });

  it('derives the semantic asset route during a rolling backend restart', async () => {
    const { assetBaseUrl: _omitted, ...olderPayload } = validPayload;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(olderPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const payload = await fetchBootstrap();
    expect(payload.assetBaseUrl).toBe('/api/v1/cities/bengaluru/studies/SRC-LR-01/files/');
  });

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ selection: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    await expect(fetchBootstrap()).rejects.toMatchObject({ code: 'malformed_response' });
  });
});
