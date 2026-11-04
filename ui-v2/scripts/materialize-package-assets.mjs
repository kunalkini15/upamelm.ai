/**
 * @file materialize-package-assets.mjs
 * CLI utility to package an agentic study bundle for standalone static hosting or deployment.
 *
 * Inspects all native assets (PDFs, figures, CSVs) referenced in a study_package.json,
 * copies them into an isolated `assets/` subfolder, rewrites their relative URIs,
 * and outputs a self-contained study_package.json without modifying scientific contents.
 *
 * Usage:
 *   node scripts/materialize-package-assets.mjs <path/to/study_package.json> <output/directory>
 */

import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';

const input = resolve(process.argv[2] || 'public/study_package.json');
const outputRoot = resolve(process.argv[3] || 'public/active-study');
const raw = JSON.parse(await readFile(input, 'utf8'));
const inputRoot = dirname(input);
const copiedBySource = new Map();
const safeName = (value) => String(value || 'asset').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-140);

async function materialize(item, id) {
  let source = item?.resolved_path;
  if (!source && item?.path && !/^https?:\/\//.test(item.path)) {
    const candidates = [resolve(inputRoot, item.path), resolve(process.cwd(), item.path), resolve(process.cwd(), '..', item.path), resolve(inputRoot, 'resources', basename(item.path))];
    for (const candidate of candidates) {
      try { await access(candidate); source = candidate; break; } catch { /* try the next grounded path */ }
    }
  }
  if (!source || /^https?:\/\//.test(source)) return item;
  if (copiedBySource.has(source)) return { ...item, path: copiedBySource.get(source) };
  const extension = extname(source) || extname(item.path || '') || '.bin';
  const file = `${safeName(id || basename(source, extension))}${extension}`;
  const relative = `assets/${file}`;
  await mkdir(resolve(outputRoot, dirname(relative)), { recursive: true });
  await copyFile(source, resolve(outputRoot, relative));
  copiedBySource.set(source, relative);
  return { ...item, path: relative };
}

raw.native_assets = await Promise.all((raw.native_assets || []).map((item, index) => materialize(item, item.asset_id || `asset-${index + 1}`)));
const assets = new Map(raw.native_assets.map((item) => [item.asset_id, item.path]));
if (raw.rendering_package?.structured_resources) {
  raw.rendering_package.structured_resources = await Promise.all(raw.rendering_package.structured_resources.map(async (item, index) => {
    if (item.resolved_path || item.path) return materialize(item, item.id || `resource-${index + 1}`);
    return assets.has(item.source_asset_id) ? { ...item, path: assets.get(item.source_asset_id) } : item;
  }));
}
await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, 'study_package.json'), JSON.stringify(raw, null, 2));
console.log(JSON.stringify({ package: resolve(outputRoot, 'study_package.json'), assets: copiedBySource.size }, null, 2));
