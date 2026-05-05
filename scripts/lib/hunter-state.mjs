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

// Rich per-suggestion record. Includes the full tweet snapshot at the time
// we surfaced it (so retrospective analysis works even if the tweet is
// deleted later) and the score breakdown (so we can correlate score to
// outcome once we add reply-engagement tracking in v3.0.2). The `outcome`
// field starts null and is meant to be filled in later — manually for now,
// programmatically once feedback-replies.mjs lands.
export function recordSuggestion(
  state,
  { tweet, score, comment, reasoning, matchedQuery }
) {
  state.entries[String(tweet.id)] = {
    suggestedAt: new Date().toISOString(),
    author: tweet.handle,
    url: tweet.url,
    tweetText: tweet.text,
    metrics: {
      likes: tweet.likes,
      replies: tweet.replies,
      retweets: tweet.retweets,
      bookmarks: tweet.bookmarks,
      views: tweet.views,
      ageMinutes: score.ageMinutes,
    },
    scoreDetails: {
      ratio: score.score,
      candidateVelocity: score.candidateVelocity,
      authorMedianVelocity: score.authorMedianVelocity,
      authorSampleSize: score.authorSampleSize,
      controversy: score.controversy,
    },
    score: score.score,
    comment,
    reasoning: reasoning ?? null,
    matchedQuery: matchedQuery ?? null,
    outcome: null, // posted | edited | skipped | null (filled later)
    outcomeNotes: null,
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
