#!/usr/bin/env node
// MCP stdio server for the peer-posts research agent.
//
// Spawned by `claude -p --mcp-config ...` in headless mode. Exposes tools
// the agent uses to fetch tweets, score handles, curate a pool, and submit
// the distilled patterns. State persists across tool calls in two files:
//
//   - PEER_POSTS_STATE_FILE — long-lived rotation/blacklist/discovery state
//   - PEER_POSTS_RUN_FILE   — transient: this run's pool, patterns, fetch budget
//
// The parent script (sources/peer-posts/fetch.mjs) reads the run file after
// `claude -p` exits to compose the final latest.md.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { makeTwitterApi, engagementScore } from '../../scripts/lib/twitterapi-io.mjs';
import {
  ensureHandles,
  rotatePick,
  recordPull,
  blacklistHandle,
  recordDiscovery,
  promoteDiscovered,
  avgScore,
} from '../../scripts/lib/peer-state.mjs';

// ----- env / paths -----

const STATE_FILE = required('PEER_POSTS_STATE_FILE');
const RUN_FILE = required('PEER_POSTS_RUN_FILE');
const TWITTER_KEY = required('TWITTERAPI_IO_KEY');
const SEED_HANDLES = (process.env.PEER_POSTS_SEED_HANDLES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const WINDOW_DAYS = Number(process.env.PEER_POSTS_WINDOW_DAYS ?? 14);
const FETCH_BUDGET = Number(process.env.PEER_POSTS_FETCH_BUDGET ?? 15);
const SEEDS_PER_RUN = Number(process.env.PEER_POSTS_SEEDS_PER_RUN ?? 5);
const POOL_TARGET = Number(process.env.PEER_POSTS_POOL_TARGET ?? 30);
const OWN_HANDLE = (process.env.PEER_POSTS_OWN_HANDLE ?? 'octavicristea').toLowerCase();

function required(name) {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`peer-posts MCP server: missing env ${name}\n`);
    process.exit(1);
  }
  return v;
}

// ----- file-backed state -----

async function loadState() {
  // peer-state.mjs's loadState takes a directory; work from a file path.
  if (!existsSync(STATE_FILE)) return { handles: {}, discovered: {}, last_run: null };
  return JSON.parse(await readFile(STATE_FILE, 'utf8'));
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function loadRun() {
  if (!existsSync(RUN_FILE)) {
    return { pool: [], tweet_cache: {}, patterns_md: null, fetch_calls: 0, scores: {} };
  }
  return JSON.parse(await readFile(RUN_FILE, 'utf8'));
}

async function saveRun(run) {
  await writeFile(RUN_FILE, JSON.stringify(run, null, 2));
}

// ----- twitter -----

const twitter = makeTwitterApi(TWITTER_KEY);
const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

function trimTweetForAgent(t) {
  return {
    id: t.id,
    handle: t.handle,
    created_at: t.created_at,
    text: t.text.length > 360 ? t.text.slice(0, 360) + '…' : t.text,
    likes: t.likes,
    replies: t.replies,
    retweets: t.retweets,
    bookmarks: t.bookmarks,
    views: t.views,
    score: Number(engagementScore(t).toFixed(5)),
    url: t.url,
  };
}

// ----- helpers used by tools -----

const FETCH_DELAY_MS = Number(process.env.PEER_POSTS_FETCH_DELAY_MS ?? 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serialize state mutations across concurrent tool calls. Claude can call
// multiple tools in a single assistant turn; without this, two tools doing
// `load → mutate → save` race and the last writer wipes the other's work.
let runChain = Promise.resolve();
let stateChain = Promise.resolve();
let fetchChain = Promise.resolve();

function withRun(mutator) {
  const next = runChain.then(async () => {
    const run = await loadRun();
    await mutator(run);
    await saveRun(run);
    return run;
  });
  runChain = next.catch(() => {}); // failures don't poison the chain
  return next;
}

function withState(mutator) {
  const next = stateChain.then(async () => {
    const state = await loadState();
    ensureHandles(state, SEED_HANDLES);
    await mutator(state);
    await saveState(state);
    return state;
  });
  stateChain = next.catch(() => {});
  return next;
}

// Serialize external twitter fetches with a small delay between them. Even
// at $10 paid balance, twitterapi.io's QPS is low; firing 5 in parallel
// triggered 429s in the previous run. The chain enforces "at most one
// fetch in flight, with FETCH_DELAY_MS between consecutive fetches."
async function withFetchLock(fn) {
  const next = fetchChain.then(async () => {
    const result = await fn();
    await sleep(FETCH_DELAY_MS);
    return result;
  });
  fetchChain = next.catch(() => {});
  return next;
}

function logCall(name, input) {
  const preview = JSON.stringify(input).slice(0, 80);
  process.stderr.write(`[mcp] ${name}(${preview})\n`);
}

function checkBudget(run) {
  if (run.fetch_calls >= FETCH_BUDGET) {
    const err = new Error(
      `fetch budget exhausted (${FETCH_BUDGET} calls used). Call submit_patterns now with what you have. Do NOT retry.`
    );
    err.budgetExhausted = true;
    throw err;
  }
}

const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

// ----- tool implementations -----

// NOTE: server name uses underscores (peer_posts) so the resulting tool
// names are stable: mcp__peer_posts__<tool>. Hyphens get normalized
// inconsistently by Claude Code, which makes allow-listing fragile.
const server = new McpServer({ name: 'peer_posts', version: '1.0.0' });

server.registerTool(
  'list_seeds',
  {
    description:
      'List active seed handles and their rotation state. Use this to decide which handles to refresh next.',
    inputSchema: {},
  },
  async () => {
    const state = await loadState();
    ensureHandles(state, SEED_HANDLES);
    const active = Object.values(state.handles)
      .filter((h) => h.status === 'active')
      .map((h) => ({
        handle: h.handle,
        last_pulled: h.last_pulled,
        avg_score: avgScore(h),
        score_n: h.score_n,
      }));
    return ok({ active, count: active.length });
  }
);

server.registerTool(
  'pick_stale_seeds',
  {
    description: `Returns the N stalest active handles (oldest last_pulled first). Capped at ${SEEDS_PER_RUN}.`,
    inputSchema: { n: z.number().int().min(1).max(10) },
  },
  async ({ n }) => {
    let picked = [];
    await withState((state) => {
      picked = rotatePick(state, Math.min(n, SEEDS_PER_RUN));
    });
    return ok({ handles: picked });
  }
);

server.registerTool(
  'fetch_user_tweets',
  {
    description: `Fetch a user's recent tweets from the last ${WINDOW_DAYS} days. Returns up to 30 with metrics. Counts against the fetch budget.`,
    inputSchema: {
      handle: z.string().describe('Twitter username, no @'),
      include_replies: z.boolean().optional(),
    },
  },
  async ({ handle, include_replies = false }) => {
    logCall('fetch_user_tweets', { handle });
    // Reserve before the network call; if the budget is full, fail fast
    // and tell the agent to stop.
    await withRun((r) => checkBudget(r));

    const tweets = await withFetchLock(() =>
      twitter.userLastTweets({
        userName: handle,
        includeReplies: include_replies,
        sinceDate: sinceIso,
        max: 30,
      })
    );

    let fetchCalls = 0;
    await withRun((r) => {
      r.fetch_calls = (r.fetch_calls ?? 0) + 1;
      fetchCalls = r.fetch_calls;
      for (const t of tweets) r.tweet_cache[t.id] = t;
      r.fetched_handles = r.fetched_handles ?? [];
      if (!r.fetched_handles.includes(handle.toLowerCase())) {
        r.fetched_handles.push(handle.toLowerCase());
      }
    });

    return ok({
      handle,
      count: tweets.length,
      fetch_calls_used: fetchCalls,
      fetch_budget: FETCH_BUDGET,
      tweets: tweets.map(trimTweetForAgent),
    });
  }
);

server.registerTool(
  'search_tweets',
  {
    description:
      'Search tweets across all of X using twitterapi.io advanced search syntax (e.g. "AI voice apps min_faves:50 lang:en"). Returns up to 20. queryType "Top" for high-engagement, "Latest" for fresh.',
    inputSchema: {
      query: z.string(),
      query_type: z.enum(['Top', 'Latest']).optional(),
      max: z.number().int().min(1).max(30).optional(),
    },
  },
  async ({ query, query_type = 'Top', max = 20 }) => {
    logCall('search_tweets', { query: query.slice(0, 60), query_type, max });
    await withRun((r) => checkBudget(r));

    const tweets = await withFetchLock(() =>
      twitter.searchTweets({ query, queryType: query_type, max })
    );

    let fetchCalls = 0;
    await withRun((r) => {
      r.fetch_calls = (r.fetch_calls ?? 0) + 1;
      fetchCalls = r.fetch_calls;
      for (const t of tweets) r.tweet_cache[t.id] = t;
    });
    return ok({
      query,
      count: tweets.length,
      fetch_calls_used: fetchCalls,
      fetch_budget: FETCH_BUDGET,
      tweets: tweets.map(trimTweetForAgent),
    });
  }
);

server.registerTool(
  'score_relevance',
  {
    description:
      'Record a niche-relevance score (1-5) for a handle, with a short reason. Multiple calls accumulate into a running average.',
    inputSchema: {
      handle: z.string(),
      score: z.number().int().min(1).max(5),
      reason: z.string().optional(),
    },
  },
  async ({ handle, score, reason }) => {
    await withRun((r) => {
      const key = handle.toLowerCase();
      r.scores[key] = r.scores[key] ?? [];
      r.scores[key].push(score);
    });
    return ok({ handle, score, reason: reason ?? null });
  }
);

server.registerTool(
  'add_to_pool',
  {
    description: `Add a tweet to the curated pool. Only add tweets that genuinely exemplify a pattern worth learning. Pool target ~${POOL_TARGET}.`,
    inputSchema: {
      tweet_id: z.string(),
      reason: z.string().describe('Why this tweet is worth keeping (1 sentence)'),
    },
  },
  async ({ tweet_id, reason }) => {
    let added = false;
    let error = null;
    let poolSize = 0;
    await withRun((r) => {
      const t = r.tweet_cache[tweet_id];
      if (!t) {
        error = 'unknown tweet_id (was it from a fetch in this run?)';
        return;
      }
      if (t.handle?.toLowerCase() === OWN_HANDLE) {
        error = 'skipping own post';
        return;
      }
      if (r.pool.some((p) => p.tweet_id === tweet_id)) {
        error = 'already in pool';
        return;
      }
      r.pool.push({ tweet_id, reason });
      added = true;
      poolSize = r.pool.length;
    });
    return ok({ added, pool_size: poolSize, ...(error ? { error } : {}) });
  }
);

server.registerTool(
  'blacklist_handle',
  {
    description:
      'Mark a seed handle as off-topic / drifted (e.g. became a crypto account). Removes from rotation.',
    inputSchema: { handle: z.string(), reason: z.string() },
  },
  async ({ handle, reason }) => {
    await withState((state) => blacklistHandle(state, handle, reason));
    return ok({ handle, status: 'blacklisted' });
  }
);

server.registerTool(
  'promote_handle',
  {
    description:
      'Record a newly-discovered handle that produces relevant content. Sufficient score auto-promotes them next run.',
    inputSchema: {
      handle: z.string(),
      score: z.number().int().min(1).max(5),
      reason: z.string().optional(),
    },
  },
  async ({ handle, score, reason }) => {
    await withState((state) => recordDiscovery(state, handle, score, reason ?? null));
    return ok({ handle, recorded: true });
  }
);

server.registerTool(
  'submit_patterns',
  {
    description:
      'Terminal tool — call exactly once when done curating. Submits the distilled patterns analysis as markdown. The run ends after this.',
    inputSchema: {
      patterns_markdown: z
        .string()
        .describe(
          'Markdown body. Do NOT include a top-level "## Patterns observed" header — that\'s the rendered title. Use ### for sub-sections (Specific patterns, Hook archetypes, Length/structure, Anti-patterns).'
        ),
    },
  },
  async ({ patterns_markdown }) => {
    await withRun((r) => {
      r.patterns_md = patterns_markdown;
      r.submitted_at = new Date().toISOString();
    });
    return ok({ received: true, length: patterns_markdown.length });
  }
);

// Roll up: applied at end of MCP process lifetime, but also reachable via
// tool call so the agent can trigger it explicitly. Most cleanly handled by
// the parent script reading state directly after `claude -p` exits, but we
// expose a tool so the parent can also nudge it via prompt if needed.
server.registerTool(
  'finalize_state',
  {
    description:
      'Apply per-handle scores to rotation state and promote discovered handles. Idempotent. The parent script also runs this after the agent exits, so calling here is optional.',
    inputSchema: {},
  },
  async () => {
    let promoted = [];
    await withState(async (state) => {
      const run = await loadRun();
      const fetched = run.fetched_handles ?? [];
      for (const handle of fetched) {
        recordPull(state, handle, run.scores?.[handle] ?? []);
      }
      for (const handle of Object.keys(run.scores ?? {})) {
        if (!fetched.includes(handle)) {
          recordPull(state, handle, run.scores[handle] ?? []);
        }
      }
      promoted = promoteDiscovered(state);
    });
    return ok({ promoted });
  }
);

// ----- start -----

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('peer_posts MCP server connected\n');
