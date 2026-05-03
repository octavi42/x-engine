// Persistent rotation/scoring state for the peer-posts research agent.
// Lives at sources/peer-posts/.state.json (gitignored).

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TODAY = () => new Date().toISOString().slice(0, 10);

export async function loadState(sourceDir) {
  const path = join(sourceDir, '.state.json');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { handles: {}, discovered: {}, last_run: null };
    }
    throw err;
  }
}

export async function saveState(sourceDir, state) {
  const path = join(sourceDir, '.state.json');
  await writeFile(path, JSON.stringify(state, null, 2));
}

export function ensureHandles(state, seedHandles) {
  for (const h of seedHandles) {
    const key = h.toLowerCase();
    if (!state.handles[key]) {
      state.handles[key] = {
        handle: h,
        status: 'active',
        last_pulled: null,
        score_sum: 0,
        score_n: 0,
      };
    } else if (state.handles[key].status === 'pruned') {
      // Re-seeding a pruned handle resurrects it.
      state.handles[key].status = 'active';
    }
  }
  return state;
}

// Picks N stalest active handles. Stale = oldest last_pulled (null sorts first).
export function rotatePick(state, n) {
  const active = Object.values(state.handles).filter((h) => h.status === 'active');
  active.sort((a, b) => (a.last_pulled ?? '').localeCompare(b.last_pulled ?? ''));
  return active.slice(0, n).map((h) => h.handle);
}

export function recordPull(state, handle, scores = []) {
  const key = handle.toLowerCase();
  const entry = state.handles[key] ?? {
    handle,
    status: 'active',
    last_pulled: null,
    score_sum: 0,
    score_n: 0,
  };
  entry.last_pulled = TODAY();
  for (const s of scores) {
    entry.score_sum += s;
    entry.score_n += 1;
  }
  state.handles[key] = entry;
}

export function blacklistHandle(state, handle, reason) {
  const key = handle.toLowerCase();
  state.handles[key] = {
    ...(state.handles[key] ?? { handle, score_sum: 0, score_n: 0 }),
    handle,
    status: 'blacklisted',
    blacklist_reason: reason,
    blacklisted_at: TODAY(),
  };
}

export function recordDiscovery(state, handle, score, reason) {
  const key = handle.toLowerCase();
  const existing = state.discovered[key];
  if (existing) {
    existing.score = Math.max(existing.score ?? 0, score);
    existing.last_seen = TODAY();
    existing.reason = reason ?? existing.reason;
  } else {
    state.discovered[key] = {
      handle,
      first_seen: TODAY(),
      last_seen: TODAY(),
      score,
      reason,
    };
  }
}

// Discovered handles with score >= threshold get auto-promoted to active seeds.
// Active or blacklisted handles are skipped.
export function promoteDiscovered(state, { minScore = 3.5 } = {}) {
  const promoted = [];
  for (const [key, d] of Object.entries(state.discovered)) {
    if (state.handles[key]?.status === 'blacklisted') continue;
    if (state.handles[key]?.status === 'active') continue;
    if ((d.score ?? 0) >= minScore) {
      state.handles[key] = {
        handle: d.handle,
        status: 'active',
        last_pulled: null,
        score_sum: 0,
        score_n: 0,
        promoted_at: TODAY(),
        promoted_reason: d.reason,
      };
      promoted.push(d.handle);
    }
  }
  return promoted;
}

export function avgScore(handleEntry) {
  if (!handleEntry?.score_n) return null;
  return handleEntry.score_sum / handleEntry.score_n;
}
