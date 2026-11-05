# Backend Verification Contracts

## Safety boundary

The validator may write only beneath `output_dir`. It must not edit backend
code, tests, dependencies, promoted runs, source documents, translations, or UI.
It binds only to `127.0.0.1` on an ephemeral port and must terminate the server.

## Required coverage

- Compilation, dependency consistency, import, app construction, and OpenAPI
- Parallel pytest execution
- Root, docs, OpenAPI, health, catalog, bootstrap, and study endpoints
- Every discovered city, study, and translated package combination
- Package-relative resources, images, tables, and source documents
- MIME handling and `assetBaseUrl` containment
- Structured not-found and invalid-request errors
- Traversal, absolute paths, invalid identifiers, and symlink escape
- CORS, concurrent requests, cache refresh, readiness, and cleanup

## Finding shape

```json
{
  "id": "BACKEND-001",
  "severity": "error",
  "category": "missing_asset",
  "city": "bengaluru",
  "study": "SRC-LR-01",
  "language": "kn",
  "endpoint": "/api/v1/...",
  "expected": "HTTP 200 with image/png",
  "actual": "HTTP 404 asset_not_found",
  "evidence": "Package reference: source-cache/pages-img/map.png",
  "likely_owner": "promotion",
  "recommended_action": "Copy the referenced file during promotion."
}
```

Allowed categories: `compile_failure`, `dependency_failure`, `unit_test_failure`,
`api_contract_failure`, `live_server_failure`, `upstream_data_failure`,
`missing_asset`, `translation_mismatch`, `security_failure`,
`performance_warning`, `environment_failure`.

Allowed owners: `backend`, `promotion`, `document-processing`, `translation`,
`environment`, `unknown`. Expected security rejections are passing checks.
