// Subprocess tests for scripts/sync-sources.mjs's CI-only env vars:
//   DISABLED_SOURCES — skip named sources
//   SYNC_TOLERATE_ERRORS — exit 0 even when individual sources error
//
// Each test scaffolds a tmp repo with the same lib code as the real one,
// stubs source.config.json + fetch.mjs files, and runs sync-sources.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/sync-sources.mjs');
const SOURCE_LOADER = path.join(REPO_ROOT, 'scripts/lib/source-loader.mjs');

async function makeFixture({ sources }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sync-sources-test-'));
  // Mirror the lib path expected by source-loader.mjs (../../sources from lib).
  await mkdir(path.join(dir, 'scripts/lib'), { recursive: true });
  await mkdir(path.join(dir, 'sources'), { recursive: true });
  await cp(SOURCE_LOADER, path.join(dir, 'scripts/lib/source-loader.mjs'));
  await cp(SCRIPT, path.join(dir, 'scripts/sync-sources.mjs'));

  for (const s of sources) {
    const sd = path.join(dir, 'sources', s.name);
    await mkdir(sd, { recursive: true });
    await writeFile(
      path.join(sd, 'source.config.json'),
      JSON.stringify({ name: s.name, type: s.name, enabled: true, params: {} })
    );
    if (s.fetch) await writeFile(path.join(sd, 'fetch.mjs'), s.fetch);
  }
  return dir;
}

function runScript(repoDir, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/sync-sources.mjs'], {
      cwd: repoDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const OK_FETCH = "export async function fetch() { return { items: [{ title: 't', body: 'b' }] }; }\n";
const FAIL_FETCH = "export async function fetch() { throw new Error('boom from test fixture'); }\n";

test('sync-sources exits 1 when a source errors and SYNC_TOLERATE_ERRORS unset', async () => {
  const dir = await makeFixture({
    sources: [
      { name: 'good', fetch: OK_FETCH },
      { name: 'bad', fetch: FAIL_FETCH },
    ],
  });
  try {
    const res = await runScript(dir, { SYNC_TOLERATE_ERRORS: '' });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /1 source\(s\) failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sync-sources exits 0 when SYNC_TOLERATE_ERRORS=1 even with errors', async () => {
  const dir = await makeFixture({
    sources: [
      { name: 'good', fetch: OK_FETCH },
      { name: 'bad', fetch: FAIL_FETCH },
    ],
  });
  try {
    const res = await runScript(dir, { SYNC_TOLERATE_ERRORS: '1' });
    assert.equal(res.code, 0);
    assert.match(res.stderr, /SYNC_TOLERATE_ERRORS set — continuing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('DISABLED_SOURCES skips named sources cleanly', async () => {
  const dir = await makeFixture({
    sources: [
      { name: 'keep-me', fetch: OK_FETCH },
      { name: 'skip-me', fetch: FAIL_FETCH }, // would error if not skipped
    ],
  });
  try {
    const res = await runScript(dir, { DISABLED_SOURCES: 'skip-me' });
    assert.equal(res.code, 0, `exit code 0 expected; stderr:\n${res.stderr}`);
    assert.match(res.stdout, /skip-me\s+disabled\s+via DISABLED_SOURCES/);
    assert.match(res.stdout, /keep-me\s+fetched/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('DISABLED_SOURCES warns on unknown source names (typos)', async () => {
  const dir = await makeFixture({
    sources: [{ name: 'real-one', fetch: OK_FETCH }],
  });
  try {
    const res = await runScript(dir, { DISABLED_SOURCES: 'reel-one' });
    assert.equal(res.code, 0);
    assert.match(res.stderr, /DISABLED_SOURCES: unknown source "reel-one"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('DISABLED_SOURCES with multiple comma-separated values', async () => {
  const dir = await makeFixture({
    sources: [
      { name: 'a', fetch: OK_FETCH },
      { name: 'b', fetch: FAIL_FETCH },
      { name: 'c', fetch: FAIL_FETCH },
    ],
  });
  try {
    const res = await runScript(dir, { DISABLED_SOURCES: 'b, c' }); // intentional whitespace
    assert.equal(res.code, 0);
    assert.match(res.stdout, /b\s+disabled/);
    assert.match(res.stdout, /c\s+disabled/);
    assert.match(res.stdout, /a\s+fetched/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
