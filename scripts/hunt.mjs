#!/usr/bin/env node
// Comment-hunter — search-driven discovery of recently-posted viral tweets,
// scored against each author's own engagement baseline. Top 2-3 per run get
// a Claude-generated suggested reply pinged via Telegram. User opens X
// manually and posts (notify-only by design — automated AI replies are a
// top-3 shadowban trigger per 2026 X-safety research).
//
// Pipeline:
//   1. Read sources/comment-hunter/source.config.json (search queries,
//      thresholds, caps).
//   2. For each topic query, hit twitterapi.io advanced_search with engagement
//      and age operators. Dedup tweets across queries.
//   3. Pre-filter: not-reply, age ≤ maxAgeMinutes, ≥ minLikesAbsolute,
//      not in 60-day dedup state.
//   4. For each candidate, fetch author's last N tweets (capped by
//      fetchBudgetPerRun) and compute velocity vs author median.
//   5. Keep top maxNotifyPerRun candidates that pass floors.
//   6. For each, generate suggested reply via `claude -p` (Pro/Max billing).
//   7. Send one Telegram message per suggestion. Stamp state. Done.
//
// Flags:
//   npm run hunt              full run (search + score + claude + telegram)
//   npm run hunt -- --dry     search + score + print only (no claude, no tg)
//   npm run hunt:ci           same as full, used by .github/workflows/hunt.yml
//
// Required env: TWITTERAPI_IO_KEY, CLAUDE_CODE_OAUTH_TOKEN,
//               TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. (Last two skippable in
//               --dry mode.)

import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTwitterApi } from './lib/twitterapi-io.mjs';
import { scoreCandidate } from './lib/virality.mjs';
import {
  loadHunterState,
  saveHunterState,
  pruneExpired,
  isAlreadySuggested,
  recordSuggestion,
  notificationsToday,
  appendRunLog,
} from './lib/hunter-state.mjs';
import { generateSuggestion, COMMENT_CHAR_LIMIT } from './lib/comment-gen.mjs';
import { probeClaudeAuth } from './lib/run-claude.mjs';
import { parseArchive, topPerformers } from './lib/archive.mjs';
import { appendRunSection } from './lib/hunter-log.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'sources/comment-hunter/source.config.json');
const STATE_PATH = path.join(ROOT, 'sources/comment-hunter/.state.json');
const LOG_PATH = path.join(ROOT, 'sources/comment-hunter/log.md');
const VOICE_PATH = path.join(ROOT, 'config/voice.md');
const PROJECTS_DIR = path.join(ROOT, 'config/projects');
const ARCHIVE_PATH = path.join(ROOT, 'posted/archive.md');
const MCP_SERVER_PATH = path.resolve(here, '..', '..', 'mcp-servers/comment/server.mjs');

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function parseArgs(argv) {
  const args = { dry: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry') args.dry = true;
  }
  return args;
}

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const json = JSON.parse(raw);
  const p = json.params ?? {};
  return {
    searchQueries: p.searchQueries ?? [],
    maxAgeMinutes: p.maxAgeMinutes ?? 90,
    minLikesAbsolute: p.minLikesAbsolute ?? 10,
    minVelocityRatio: p.minVelocityRatio ?? 3.0,
    maxNotifyPerRun: p.maxNotifyPerRun ?? 3,
    maxNotifyPerDay: p.maxNotifyPerDay ?? 3,
    tweetsPerQuery: p.tweetsPerQuery ?? 30,
    maxCandidatesToScore: p.maxCandidatesToScore ?? 10,
    authorBaselineSize: p.authorBaselineSize ?? 20,
    fetchBudgetPerRun: p.fetchBudgetPerRun ?? 30,
    stateTtlDays: p.stateTtlDays ?? 60,
  };
}

async function loadVoice() {
  return readFile(VOICE_PATH, 'utf8').catch(() => '');
}

// Concatenate all config/projects/*.md so the suggestion agent can ground
// "shipped on roadtosf" claims in the actual project list. Best-effort —
// missing dir is fine, the prompt has a fallback.
async function loadProjects() {
  if (!existsSync(PROJECTS_DIR)) return '';
  try {
    const files = (await readdir(PROJECTS_DIR)).filter((f) => f.endsWith('.md'));
    const bodies = await Promise.all(
      files.sort().map(async (f) => `### ${f}\n${await readFile(path.join(PROJECTS_DIR, f), 'utf8')}`)
    );
    return bodies.join('\n\n');
  } catch {
    return '';
  }
}

async function loadOwnTopPerformers(n = 3) {
  if (!existsSync(ARCHIVE_PATH)) return [];
  try {
    const entries = await parseArchive(ARCHIVE_PATH);
    return topPerformers(entries, n);
  } catch {
    return [];
  }
}

// Compose a full search query: user topic part + engagement floor + age
// floor + lang. Falling back to client-side filtering anyway, so even if a
// twitterapi.io operator is silently dropped we're still safe.
function buildSearchQuery(topic, { minLikesAbsolute, maxAgeMinutes }) {
  const sinceUnix = Math.floor((Date.now() - maxAgeMinutes * 60_000) / 1000);
  return `${topic} min_faves:${minLikesAbsolute} -is:reply lang:en since_time:${sinceUnix}`;
}

function clientSideFilter(tweets, { maxAgeMinutes, minLikesAbsolute, now = Date.now() }) {
  const cutoff = now - maxAgeMinutes * 60_000;
  return tweets.filter((t) => {
    if (!t.id || !t.text) return false;
    if (t.is_reply) return false;
    if (t.likes < minLikesAbsolute) return false;
    const created = t.created_at ? new Date(t.created_at).getTime() : 0;
    if (!created || created < cutoff) return false;
    return true;
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tweetUrl(tweet) {
  if (tweet.url) return tweet.url;
  if (tweet.handle && tweet.id) return `https://x.com/${tweet.handle}/status/${tweet.id}`;
  return `https://x.com/i/web/status/${tweet.id}`;
}

async function sendTelegram({ token, chatId, text }) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`telegram api error: ${JSON.stringify(json)}`);
  }
  return json;
}

// Cap the displayed velocity ratio. With cold authors (EPSILON denominator)
// or near-zero baselines, the raw ratio explodes into garbage like
// "1220484×" — cap to a max so the headline stays useful.
function displayRatio(score) {
  if (score.authorSampleSize === 0) return null;
  return Math.min(score.score, 999);
}

function formatTelegramMessage({ tweet, score, suggestion }) {
  const author = tweet.handle ? `@${tweet.handle}` : 'unknown';
  const ratio = displayRatio(score);
  const ratioBlock =
    ratio !== null ? `${ratio.toFixed(1)}× author velocity` : `cold author (no baseline)`;
  const headline = `🚀 <b>${escapeHtml(author)}</b> · ${ratioBlock}`;
  const meta = score.reasons.map(escapeHtml).join(' · ');
  const body = escapeHtml(tweet.text).slice(0, 700);

  const suggestionBlock = suggestion
    ? [
        '',
        '<b>Suggested reply</b>',
        `<code>${escapeHtml(suggestion.comment)}</code>`,
        `<i>${escapeHtml(suggestion.reasoning)}</i>`,
      ].join('\n')
    : '';

  return [
    headline,
    `<i>${meta}</i>`,
    '',
    body,
    suggestionBlock,
    '',
    `<a href="${escapeHtml(tweetUrl(tweet))}">Open in X</a>`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadConfig();

  const apiKey = process.env.TWITTERAPI_IO_KEY;
  if (!apiKey) throw new Error('TWITTERAPI_IO_KEY not set');

  const tg = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  };
  if (!args.dry && (!tg.token || !tg.chatId)) {
    throw new Error('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set (use --dry to skip)');
  }

  if (!args.dry) {
    const probe = await probeClaudeAuth();
    if (!probe.ok) throw new Error(`auth check failed: ${probe.reason}`);
  }

  let state = await loadHunterState(STATE_PATH);
  state = pruneExpired(state, { ttlDays: config.stateTtlDays });

  const sentToday = notificationsToday(state);
  const remainingDailyBudget = Math.max(config.maxNotifyPerDay - sentToday, 0);
  if (remainingDailyBudget === 0) {
    console.log(`hunt: daily cap hit (${sentToday}/${config.maxNotifyPerDay}) — exiting silently`);
    appendRunLog(state, { searched: 0, scored: 0, notified: 0, note: 'daily cap hit' });
    await saveHunterState(STATE_PATH, state);
    return;
  }
  const cap = Math.min(config.maxNotifyPerRun, remainingDailyBudget);

  const tw = makeTwitterApi(apiKey);

  // --- 1. Search across topics ---
  const searched = new Map(); // tweet.id → tweet
  const matchedQueryBy = new Map(); // tweet.id → topic that surfaced it first
  let searchCalls = 0;
  const searchErrors = [];
  for (const topic of config.searchQueries) {
    const query = buildSearchQuery(topic, config);
    try {
      const tweets = await tw.searchTweets({
        query,
        queryType: 'Latest',
        max: config.tweetsPerQuery,
      });
      searchCalls += 1;
      for (const t of tweets) {
        if (!t.id) continue;
        if (!searched.has(t.id)) {
          searched.set(t.id, t);
          matchedQueryBy.set(t.id, topic); // record first-match topic
        }
      }
    } catch (err) {
      const msg = `search failed for "${topic.slice(0, 40)}…": ${err.message}`;
      console.warn(`hunt: ${msg}`);
      searchErrors.push(msg);
    }
  }
  console.log(`hunt: ${searchCalls} search(es) → ${searched.size} unique tweet(s) before filter`);

  // --- 2. Pre-filter ---
  const filtered = clientSideFilter([...searched.values()], config).filter(
    (t) => !isAlreadySuggested(state, t.id)
  );
  console.log(`hunt: ${filtered.length} candidate(s) after pre-filter (age + likes + dedup)`);

  if (!filtered.length) {
    appendRunLog(state, { searched: searched.size, scored: 0, notified: 0 });
    await saveHunterState(STATE_PATH, state);
    return;
  }

  // Cap before scoring — sorting by raw absolute engagement (likes + 2*replies)
  // first, then taking top N. Saves API calls + run time when topic queries
  // return dozens of low-tier tweets that are unlikely to win the velocity
  // race anyway.
  const topByRaw = [...filtered]
    .sort((a, b) => (b.likes + 2 * b.replies) - (a.likes + 2 * a.replies))
    .slice(0, config.maxCandidatesToScore);
  console.log(`hunt: scoring top ${topByRaw.length} by raw engagement`);

  // --- 3. Score (parallelized baseline fetches; budget-capped) ---
  const baselineBudget = Math.max(config.fetchBudgetPerRun - searchCalls, 0);
  const toFetch = topByRaw.filter((t) => t.handle).slice(0, baselineBudget);
  if (toFetch.length < topByRaw.length) {
    console.log(`hunt: baseline-fetch budget caps scoring at ${toFetch.length}/${topByRaw.length}`);
  }
  // Hard wall-clock cap per baseline. The lib's per-call timeout is 8s but
  // the loop can paginate (multi-second × multi-page). Don't let a single
  // slow author stall a whole run.
  const PER_BASELINE_DEADLINE_MS = 15_000;
  function withDeadline(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`baseline deadline ${ms}ms (${label})`)), ms)
      ),
    ]);
  }
  const baselineStart = Date.now();
  const baselineResults = await Promise.allSettled(
    toFetch.map((t) =>
      withDeadline(
        tw.userLastTweets({
          userName: t.handle,
          includeReplies: false,
          max: config.authorBaselineSize,
          maxPages: 1,
        }),
        PER_BASELINE_DEADLINE_MS,
        `@${t.handle}`
      )
    )
  );
  console.log(`hunt: baseline fetches done in ${((Date.now() - baselineStart) / 1000).toFixed(1)}s`);
  const scored = [];
  const rejected = [];
  for (let i = 0; i < toFetch.length; i++) {
    const tweet = toFetch[i];
    const settled = baselineResults[i];
    if (settled.status !== 'fulfilled') {
      console.warn(`hunt: baseline fetch failed for @${tweet.handle}: ${settled.reason?.message ?? settled.reason}`);
      continue;
    }
    const score = scoreCandidate({
      tweet,
      authorRecent: settled.value,
      minLikesAbsolute: config.minLikesAbsolute,
      minVelocityRatio: config.minVelocityRatio,
    });
    if (score.passesFloors) scored.push({ tweet, score });
    else rejected.push({ tweet, score });
  }
  if (args.dry && rejected.length) {
    console.log(`\nhunt: rejected (debug):`);
    for (const { tweet, score } of rejected.slice(0, 10)) {
      const ratio = displayRatio(score);
      const ratioStr = ratio !== null ? `${ratio.toFixed(1)}×` : 'cold';
      console.log(`  @${tweet.handle}: ${ratioStr} · sample=${score.authorSampleSize} · ${score.reasons.join(' · ')}`);
    }
  }

  scored.sort((a, b) => b.score.score - a.score.score);
  const winners = scored.slice(0, cap);
  console.log(
    `hunt: ${scored.length} passed floors · ${winners.length} winner(s) (cap ${cap}, daily-remaining ${remainingDailyBudget})`
  );

  if (!winners.length) {
    appendRunLog(state, {
      searched: searched.size,
      scored: scored.length,
      notified: 0,
    });
    await saveHunterState(STATE_PATH, state);
    return;
  }

  // --- 4. Dry mode: print + exit ---
  if (args.dry) {
    for (const { tweet, score } of winners) {
      const ratio = displayRatio(score);
      const ratioStr = ratio !== null ? `${ratio.toFixed(1)}×` : 'cold';
      const matchedQuery = matchedQueryBy.get(tweet.id);
      console.log('');
      console.log(`@${tweet.handle} · ${ratioStr} · ${score.reasons.join(' · ')}`);
      console.log(`  ${tweet.text.replace(/\s+/g, ' ').slice(0, 160)}`);
      console.log(`  ${tweetUrl(tweet)}`);
      if (matchedQuery) console.log(`  query: ${matchedQuery}`);
    }
    appendRunLog(state, {
      searched: searched.size,
      scored: scored.length,
      notified: 0,
      note: 'dry run',
    });
    await saveHunterState(STATE_PATH, state);
    return;
  }

  // --- 5. Generate + notify ---
  const [voice, ownTop, projects] = await Promise.all([loadVoice(), loadOwnTopPerformers(), loadProjects()]);
  const model = process.env.HUNT_MODEL ?? DEFAULT_MODEL;
  const runDir = path.join(tmpdir(), `x-engine-hunt-${randomBytes(4).toString('hex')}`);
  await mkdir(runDir, { recursive: true });

  let notified = 0;
  const notifiedRecords = []; // for hunter-log
  const errors = [...searchErrors];
  for (const [idx, { tweet, score }] of winners.entries()) {
    const matchedQuery = matchedQueryBy.get(tweet.id) ?? null;
    let suggestion;
    try {
      suggestion = await generateSuggestion({
        tweet,
        scoreReasons: score.reasons,
        voice,
        ownTopPerformers: ownTop,
        projects,
        model,
        resultFile: path.join(runDir, `suggestion-${idx}.json`),
        mcpServerPath: MCP_SERVER_PATH,
      });
    } catch (err) {
      const msg = `suggestion-gen failed for ${tweet.id} (@${tweet.handle}): ${err.message}`;
      console.warn(`hunt: ${msg}`);
      errors.push(msg);
      continue;
    }

    const trimmed = String(suggestion.comment ?? '').replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      console.warn(`hunt: empty suggestion for ${tweet.id} — skipping`);
      errors.push(`empty suggestion for ${tweet.id}`);
      continue;
    }
    if (trimmed.length > COMMENT_CHAR_LIMIT) {
      console.warn(`hunt: suggestion ${trimmed.length}c > limit (${COMMENT_CHAR_LIMIT}) — sending anyway, edit manually`);
    }
    const finalSuggestion = { comment: trimmed, reasoning: suggestion.reasoning ?? '' };

    const text = formatTelegramMessage({ tweet, score, suggestion: finalSuggestion });
    try {
      await sendTelegram({ token: tg.token, chatId: tg.chatId, text });
    } catch (err) {
      const msg = `telegram send failed for ${tweet.id}: ${err.message}`;
      console.error(`hunt: ${msg}`);
      errors.push(msg);
      continue;
    }

    recordSuggestion(state, {
      tweet,
      score,
      comment: finalSuggestion.comment,
      reasoning: finalSuggestion.reasoning,
      matchedQuery,
    });
    notifiedRecords.push({ tweet, score, suggestion: finalSuggestion, matchedQuery });
    notified += 1;
    console.log(`hunt: notified ${tweet.id} (@${tweet.handle}, ${score.score.toFixed(1)}×)`);
  }

  const rejectedRecords = rejected.map((r) => ({
    tweet: r.tweet,
    score: r.score,
    matchedQuery: matchedQueryBy.get(r.tweet.id) ?? null,
  }));

  appendRunLog(state, {
    searched: searched.size,
    scored: scored.length,
    notified,
  });
  await saveHunterState(STATE_PATH, state);

  // Human-readable per-run log of the funnel. Captures both winners and
  // rejected top-scored candidates so threshold/query tuning is data-driven.
  await appendRunSection(LOG_PATH, {
    runSummary: { searched: searched.size, scored: scored.length, notified },
    notified: notifiedRecords,
    rejected: rejectedRecords,
    errors,
  });

  console.log(`\nhunt: done · ${notified} notification(s) sent (today total ${sentToday + notified}/${config.maxNotifyPerDay})`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
