#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listSources, writeLatest } from './lib/source-loader.mjs';

const startedAt = Date.now();
const sources = await listSources();

// Comma-separated list of source names to skip on this run, set via env.
// Used in CI where some sources can't run (e.g. obsidian-personal needs a
// local vault that doesn't exist on GitHub Actions runners).
const disabled = new Set(
  (process.env.DISABLED_SOURCES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const results = await Promise.all(sources.map(async (source) => {
  if (source.enabled === false || disabled.has(source.name)) {
    return { name: source.name, status: 'disabled', detail: disabled.has(source.name) ? 'via DISABLED_SOURCES' : '' };
  }

  const fetchPath = join(source.dir, 'fetch.mjs');
  if (!existsSync(fetchPath)) {
    return { name: source.name, status: 'static', detail: 'latest.md hand-edited' };
  }

  try {
    const mod = await import(pathToFileURL(fetchPath).href);
    if (typeof mod.fetch !== 'function') {
      throw new Error('fetch.mjs must export an async `fetch` function');
    }
    const payload = await mod.fetch(source, process.env);
    if (!payload?.items || !Array.isArray(payload.items)) {
      throw new Error('fetch() must return { items: [...] }');
    }
    const path = await writeLatest(source, payload);
    return { name: source.name, status: 'fetched', detail: `${payload.items.length} items` };
  } catch (err) {
    return { name: source.name, status: 'error', detail: err.message };
  }
}));

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nsync-sources: ${sources.length} source(s) in ${elapsed}s\n`);

const nameWidth = Math.max(8, ...results.map((r) => r.name.length));
const statusWidth = Math.max(7, ...results.map((r) => r.status.length));
const header = `${'name'.padEnd(nameWidth)}  ${'status'.padEnd(statusWidth)}  detail`;
console.log(header);
console.log('-'.repeat(header.length));
for (const r of results) {
  console.log(`${r.name.padEnd(nameWidth)}  ${r.status.padEnd(statusWidth)}  ${r.detail}`);
}

const errors = results.filter((r) => r.status === 'error');
if (errors.length) {
  console.error(`\n${errors.length} source(s) failed`);
  // In CI it's often acceptable for non-critical sources to fail (e.g. an
  // unreliable RSS feed) — set SYNC_TOLERATE_ERRORS=1 to keep the workflow
  // green and let downstream steps run with the partial data we have.
  if (!process.env.SYNC_TOLERATE_ERRORS) {
    process.exit(1);
  }
  console.error('SYNC_TOLERATE_ERRORS set — continuing despite errors');
}
