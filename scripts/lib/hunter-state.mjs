// Persistent dedup state for the comment-hunter loop.
//
// Tracks which tweet IDs have already been suggested so we don't ping the
// same one twice across runs. Entries expire after `ttlDays` (default 60).
// File lives at sources/comment-hunter/.state.json (gitignored — local
// state, regenerated on demand by the loop).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_TTL_DAYS = 60;

export async function loadHunterState(path) {
  if (!existsSync(path)) return { entries: {}, runs: [] };
  try {
    const raw = await readFile(path, 'utf8');
    const json = JSON.parse(raw);
    return {
      entries: json.entries ?? {},
      runs: Array.isArray(json.runs) ? json.runs : [],
    };
  } catch (err) {
    process.stderr.write(`hunter-state: corrupt ${path} (${err.message}) — starting fresh\n`);
    return { entries: {}, runs: [] };
  }
}

export async function saveHunterState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}

export function pruneExpired(state, { ttlDays = DEFAULT_TTL_DAYS, now = Date.now() } = {}) {
  const cutoff = now - ttlDays * 86_400_000;
  const out = { entries: {}, runs: [] };
  for (const [id, entry] of Object.entries(state.entries)) {
    const ts = new Date(entry.suggestedAt).getTime();
    if (Number.isFinite(ts) && ts >= cutoff) out.entries[id] = entry;
  }
  // Trim run log to last 30 days — used for daily-cap accounting.
  const runCutoff = now - 30 * 86_400_000;
  out.runs = state.runs.filter((r) => {
    const ts = new Date(r.ts).getTime();
    return Number.isFinite(ts) && ts >= runCutoff;
  });
  return out;
}

export function isAlreadySuggested(state, tweetId) {
  return Boolean(state.entries[String(tweetId)]);
}

export function recordSuggestion(state, { tweet, score, comment }) {
  state.entries[String(tweet.id)] = {
    suggestedAt: new Date().toISOString(),
    author: tweet.handle,
    url: tweet.url,
    score,
    comment,
  };
}

// Count notifications already sent today (UTC) so we can enforce the
// per-day cap across multiple cron runs.
export function notificationsToday(state, { now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  return state.runs
    .filter((r) => r.ts.startsWith(today))
    .reduce((sum, r) => sum + (r.notified ?? 0), 0);
}

export function appendRunLog(state, summary) {
  state.runs.push({ ts: new Date().toISOString(), ...summary });
}
