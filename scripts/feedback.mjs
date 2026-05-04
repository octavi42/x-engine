#!/usr/bin/env node
// Engagement feedback loop — closes the "what worked" gap in the engine.
//
// Once a day:
//   1. Parse posted/archive.md and find entries 24h-7d old with empty
//      engagement metrics.
//   2. Hit twitterapi.io's tweets-by-id endpoint with their tweet IDs.
//   3. Write Likes/Reposts/Replies/Bookmarks/Views back into the archive
//      in-place.
//   4. Recompute the "Top performing" block in sources/x-profile/latest.md
//      so the next morning's enhance run can use YOUR winners as few-shot
//      examples (not just peer patterns).
//
// Costs ≈ pennies/month — 3-5 tweet lookups/day at $0.15 / 1k tweets.
//
// Flags:
//   --dry          preview only, write nothing
//   --max-age=14   override max age in days (default 7)
//   --min-age=0    override min age in days (default 1)
//   --limit=20     cap the number of tweets fetched in a single run
//
// Auth:
//   TWITTERAPI_IO_KEY in env (or .env.local).

import { existsSync } from 'node:fs';
import path from 'node:path';

import { makeTwitterApi } from './lib/twitterapi-io.mjs';
import {
  parseArchive,
  pendingFeedback,
  stampArchive,
  topPerformers,
} from './lib/archive.mjs';
import { updateProfileTopPerformers } from './lib/top-performers.mjs';

const ROOT = process.cwd();
const ARCHIVE_PATH = path.join(ROOT, 'posted/archive.md');
const PROFILE_PATH = path.join(ROOT, 'sources/x-profile/latest.md');

function parseArgs(argv) {
  const args = { dry: false, maxAge: 7, minAge: 1, limit: 50 };
  for (const a of argv.slice(2)) {
    if (a === '--dry') args.dry = true;
    else if (a.startsWith('--max-age=')) args.maxAge = Number(a.slice('--max-age='.length));
    else if (a.startsWith('--min-age=')) args.minAge = Number(a.slice('--min-age='.length));
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const tag = args.dry ? '[DRY]' : '[LIVE]';
  console.log(`${tag} feedback: archive=${path.relative(ROOT, ARCHIVE_PATH)}`);

  if (!existsSync(ARCHIVE_PATH)) {
    console.log('no archive yet — nothing to do.');
    return;
  }

  const entries = await parseArchive(ARCHIVE_PATH);
  if (!entries.length) {
    console.log('archive is empty — nothing to do.');
    return;
  }

  const pending = pendingFeedback(entries, { minAgeDays: args.minAge, maxAgeDays: args.maxAge })
    .slice(0, args.limit);

  if (!pending.length) {
    console.log(`no entries in [${args.minAge}d, ${args.maxAge}d] window need stamping.`);
    await maybeRecomputeTopPerformers(entries, { changed: 0 });
    return;
  }

  console.log(`pending: ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'}`);
  for (const e of pending) {
    console.log(`  - ${e.date} ${e.tweetId} ${e.body.slice(0, 60)}…`);
  }

  if (args.dry) {
    console.log('(dry run, no fetches made)');
    return;
  }

  const apiKey = process.env.TWITTERAPI_IO_KEY;
  if (!apiKey) {
    console.error('TWITTERAPI_IO_KEY not set — add it to .env.local or env.');
    process.exit(1);
  }

  const api = makeTwitterApi(apiKey);
  let fetched;
  try {
    fetched = await api.tweetsByIds({ ids: pending.map((e) => e.tweetId) });
  } catch (err) {
    console.error(`twitterapi.io fetch failed: ${err.message}`);
    process.exit(1);
  }

  const byId = new Map();
  for (const t of fetched) {
    if (t.id) byId.set(String(t.id), t);
  }
  console.log(`fetched: ${fetched.length} / ${pending.length} (deleted/missing tweets are skipped)`);

  const stamps = new Map();
  const fetchedAt = new Date().toISOString();
  for (const e of pending) {
    const t = byId.get(e.tweetId);
    if (!t) continue;
    stamps.set(e.tweetId, {
      likes: t.likes ?? 0,
      reposts: t.retweets ?? 0,
      replies: t.replies ?? 0,
      bookmarks: t.bookmarks ?? 0,
      views: t.views ?? 0,
      fetchedAt,
    });
  }

  const changed = await stampArchive(ARCHIVE_PATH, stamps);
  console.log(`archive: ${changed} entr${changed === 1 ? 'y' : 'ies'} stamped`);

  await maybeRecomputeTopPerformers(await parseArchive(ARCHIVE_PATH), { changed });
}

async function maybeRecomputeTopPerformers(entries, { changed }) {
  const top = topPerformers(entries, 3);
  if (!top.length) {
    console.log('top-performers: no scored posts yet, skipping x-profile update');
    return;
  }
  const updated = await updateProfileTopPerformers(PROFILE_PATH, top);
  if (updated) {
    console.log(`top-performers: updated ${path.relative(ROOT, PROFILE_PATH)} (top ${top.length})`);
    for (const p of top) console.log(`  ${p.date} score=${p.score.toFixed(1)} likes=${p.metrics.likes} replies=${p.metrics.replies}`);
  } else if (changed > 0) {
    console.log('top-performers: x-profile already up to date');
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
