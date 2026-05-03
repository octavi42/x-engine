// Autoresearch agent that builds the peer-posts source.
//
// On each `npm run sync`, the agent:
//   1. Picks the stalest seed handles to refresh.
//   2. Fetches their recent tweets, scores relevance to the user's niche.
//   3. Searches for tweets on niche topics, traversing replies for discovery.
//   4. Curates a pool of high-engagement tweets that match voice + niche.
//   5. Distils observed patterns + emits the top tweets via writeLatest items.
//
// Powered by the Anthropic Messages API tool-use loop (see lib/agent-loop.mjs).

import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, basename, extname } from 'node:path';

import { makeClient, runAgent } from '../../scripts/lib/agent-loop.mjs';
import { makeTwitterApi, engagementScore } from '../../scripts/lib/twitterapi-io.mjs';
import {
  loadState,
  saveState,
  ensureHandles,
  rotatePick,
  recordPull,
  blacklistHandle,
  recordDiscovery,
  promoteDiscovered,
  avgScore,
} from '../../scripts/lib/peer-state.mjs';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export async function fetch(source, env) {
  const apiKey = env.TWITTERAPI_IO_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('TWITTERAPI_IO_KEY not set in .env.local');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set in .env.local');

  const params = source.params ?? {};
  const seedHandles = params.seedHandles ?? [];
  const windowDays = params.windowDays ?? 14;
  const seedsPerRun = params.seedsPerRun ?? 5;
  const poolTarget = params.poolTarget ?? 30;
  const maxAgentSteps = params.maxAgentSteps ?? 30;
  const fetchBudget = params.fetchBudget ?? 15;
  const maxTokens = params.maxTokens ?? 6000;
  const model = env.RESEARCH_MODEL ?? DEFAULT_MODEL;

  const repoRoot = resolve(source.dir, '..', '..');
  const niche = await loadNicheBrief(repoRoot);

  const state = ensureHandles(await loadState(source.dir), seedHandles);
  state.last_run = new Date().toISOString();

  const tweetCache = new Map();
  const pool = new Map();
  const handleScores = new Map();
  const fetchedHandles = new Set();
  const fetchBudgetRef = { calls: 0, limit: fetchBudget };

  const twitter = makeTwitterApi(apiKey);

  const tools = buildTools({
    twitter,
    state,
    tweetCache,
    pool,
    handleScores,
    fetchedHandles,
    fetchBudgetRef,
    seedsPerRun,
    windowDays,
    poolTarget,
  });

  const system = renderSystemPrompt({ niche, params, windowDays, poolTarget, fetchBudget });
  const userPrompt = renderUserPrompt({ state, seedHandles });

  const client = makeClient({ apiKey: anthropicKey });

  let result;
  let promoted = [];
  try {
    result = await runAgent({
      client,
      model,
      system,
      tools,
      userPrompt,
      terminalTool: 'submit_patterns',
      maxSteps: maxAgentSteps,
      maxTokens,
      onStep(info) {
        const inputPreview = JSON.stringify(info.input).slice(0, 80);
        console.log(`  [agent] ${info.name}(${inputPreview}) ${info.ok ? 'ok' : `ERR ${info.error}`}`);
      },
    });
  } finally {
    // Persist state even if the agent crashed mid-run — blacklist /
    // discovery / partial fetches are still valuable next time.
    for (const handle of fetchedHandles) {
      recordPull(state, handle, handleScores.get(handle.toLowerCase()) ?? []);
    }
    // Also stamp any handle that was scored but not fetched (rare).
    for (const handle of handleScores.keys()) {
      if (!fetchedHandles.has(handle)) {
        recordPull(state, handle, handleScores.get(handle) ?? []);
      }
    }
    promoted = promoteDiscovered(state);
    await saveState(source.dir, state);
  }

  const patternsMd = stripLeadingPatternsHeader(
    result.terminalInput?.patterns_markdown?.trim()
      || result.text
      || '_(agent did not emit a patterns analysis this run)_'
  );

  const items = composeItems({ patternsMd, pool });

  const meta = {
    model,
    agent_steps: result.steps,
    stop_reason: result.stop_reason,
    pool_size: pool.size,
    fetch_calls: fetchBudgetRef.calls,
    fetch_budget: fetchBudgetRef.limit,
    discovered: Object.keys(state.discovered ?? {}).length,
    promoted: promoted.length,
    input_tokens: result.usage?.input_tokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? 0,
    cache_read_tokens: result.usage?.cache_read_input_tokens ?? 0,
  };

  return { items, meta };
}

// writeLatest wraps each item body in `## ${title}`. The agent's output is
// the body of the patterns item, so any leading `## Patterns observed...`
// duplicates the wrapper title. Drop it if present.
function stripLeadingPatternsHeader(md) {
  return md.replace(/^\s*##\s+Patterns? observed[^\n]*\n+/i, '').trimStart();
}

// ----- niche brief (voice + projects) -----

async function loadNicheBrief(repoRoot) {
  const voicePath = resolve(repoRoot, 'config/voice.md');
  const voice = await readFile(voicePath, 'utf8').catch(() => '');

  const projectsDir = resolve(repoRoot, 'config/projects');
  const projectFiles = (await readdir(projectsDir).catch(() => []))
    .filter((f) => extname(f) === '.md')
    .sort();
  const projects = [];
  for (const file of projectFiles) {
    const text = await readFile(join(projectsDir, file), 'utf8');
    projects.push({ name: basename(file, '.md'), text });
  }
  return { voice, projects };
}

// ----- prompts -----

function renderSystemPrompt({ niche, params, windowDays, poolTarget, fetchBudget }) {
  const projectBlock = niche.projects
    .map((p) => `### ${p.name}\n\n${p.text.trim()}`)
    .join('\n\n');

  return `You are an autoresearch agent that curates peer tweets for an X/Twitter content engine.

# Goal
Build a pool of ~${poolTarget} high-engagement tweets from accounts that overlap with the user's niche, then distill the patterns that made them work.

# How you operate
You have tools to:
- Inspect rotation state (which seed handles are stalest)
- Fetch a user's recent tweets (last ${windowDays} days)
- Search tweets across all of X by query
- Score handles for niche-fit (1=off-topic, 5=perfect overlap)
- Add tweets to the curated pool (only ones that genuinely match the niche)
- Blacklist handles that have drifted off-topic
- Promote new handles you discover
- Finally, submit a distilled patterns markdown via submit_patterns(...)

# Strategy
1. Call list_seeds + pick_stale_seeds(${params.seedsPerRun ?? 5}) to rotate.
2. For each stale seed, fetch_user_tweets. Read the tweets carefully:
   - If most tweets are off-niche (e.g. crypto, lifestyle) → blacklist_handle.
   - If on-niche → score_relevance, then add the best tweets to the pool.
3. Run 2-3 search_tweets calls on niche topics from the user's project descriptions
   (e.g. "AI voice apps", "indie founder Romania", "interactive fiction LLM").
   Use queryType: "Top" for high-engagement, "Latest" for fresh signal.
4. From search results, pick out NEW handles that consistently produce great
   on-niche content. Call promote_handle on them. Add their best tweets to pool.
5. Stop fetching when pool >= ${poolTarget}, or your fetch budget runs out.
6. Reflect on the pool. What hooks worked? What length, structure, specificity?
   Call submit_patterns with a markdown analysis structured as below.

# Output format for submit_patterns
Do NOT include a top-level "## Patterns observed this run" header — the
output is rendered under that title automatically. Start with a 1-2 sentence
summary paragraph, then use ### sub-headers for the rest:

   <one-paragraph summary>

   ### Specific patterns
   - 3-5 specific patterns. Each one: "what + how often + why it likely worked"
   - Bad: "use specifics" — Good: "8/10 top tweets opened with a number"

   ### Hook archetypes
   - 3-5 opening templates with example tweets

   ### Length / structure notes
   - Median chars in top tweets, structural observations

   ### Anti-patterns
   - What's NOT working in this niche this run

# Niche context

${niche.voice.trim()}

# Projects the user is building

${projectBlock}

# Hard rules
- Skip tweets containing the user's banned phrases (listed in voice).
- Prefer tweets that are short (≤220 chars), specific, and have unusually
  high engagement-per-impression (the platform amplifies these).
- Do NOT add the user's own posts (handle: @octavicristea) to the pool.
- Be efficient with tool calls — twitter fetches cost real money. Hard budget
  is ${fetchBudget} fetches per run; the tool will refuse further calls past that.
- When in doubt, do not add to pool — quality over quantity.`;
}

function renderUserPrompt({ state, seedHandles }) {
  const summary = Object.values(state.handles)
    .filter((h) => h.status === 'active')
    .map((h) => {
      const avg = avgScore(h);
      return `- @${h.handle} · last pulled: ${h.last_pulled ?? 'never'} · avg score: ${avg ? avg.toFixed(2) : '—'}`;
    })
    .join('\n');

  const blacklisted = Object.values(state.handles)
    .filter((h) => h.status === 'blacklisted')
    .map((h) => `- @${h.handle} (${h.blacklist_reason ?? 'no reason'})`)
    .join('\n') || '(none)';

  const discovered = Object.values(state.discovered ?? {})
    .slice(0, 20)
    .map((d) => `- @${d.handle} · score ${d.score ?? '—'} · ${d.reason ?? ''}`)
    .join('\n') || '(none)';

  return `Run autoresearch.

Active seeds (${Object.values(state.handles).filter((h) => h.status === 'active').length}):
${summary || '(none — the only seeds in config are: ' + seedHandles.map((h) => '@' + h).join(', ') + ')'}

Blacklisted:
${blacklisted}

Recent discoveries (not yet promoted):
${discovered}

Begin.`;
}

// ----- tools -----

function buildTools({
  twitter,
  state,
  tweetCache,
  pool,
  handleScores,
  fetchedHandles,
  fetchBudgetRef,
  seedsPerRun,
  windowDays,
  poolTarget,
}) {
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const ownHandle = 'octavicristea';

  function checkBudget() {
    if (fetchBudgetRef.calls >= fetchBudgetRef.limit) {
      throw new Error(
        `fetch budget exhausted (${fetchBudgetRef.limit} calls used). Call submit_patterns now with what you have.`
      );
    }
    fetchBudgetRef.calls += 1;
  }

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

  return [
    {
      name: 'list_seeds',
      description: 'List active seed handles and their rotation state. Use this to decide which handles to refresh next.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run() {
        const active = Object.values(state.handles)
          .filter((h) => h.status === 'active')
          .map((h) => ({
            handle: h.handle,
            last_pulled: h.last_pulled,
            avg_score: avgScore(h),
            score_n: h.score_n,
          }));
        return { active, count: active.length };
      },
    },
    {
      name: 'pick_stale_seeds',
      description: `Returns the N stalest active handles (oldest last_pulled first). Limits to ${seedsPerRun} max.`,
      input_schema: {
        type: 'object',
        properties: { n: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['n'],
        additionalProperties: false,
      },
      run({ n }) {
        const picked = rotatePick(state, Math.min(n, seedsPerRun));
        return { handles: picked };
      },
    },
    {
      name: 'fetch_user_tweets',
      description: `Fetch a user's recent tweets from the last ${windowDays} days. Returns up to 30 tweets with text + engagement metrics. Costs ~1 API call per ~20 tweets.`,
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Twitter username, no @' },
          include_replies: { type: 'boolean' },
        },
        required: ['handle'],
        additionalProperties: false,
      },
      async run({ handle, include_replies = false }) {
        checkBudget();
        const tweets = await twitter.userLastTweets({
          userName: handle,
          includeReplies: include_replies,
          sinceDate: sinceIso,
          max: 30,
        });
        for (const t of tweets) tweetCache.set(t.id, t);
        fetchedHandles.add(handle.toLowerCase());
        return {
          handle,
          count: tweets.length,
          fetch_calls_used: fetchBudgetRef.calls,
          fetch_budget: fetchBudgetRef.limit,
          tweets: tweets.map(trimTweetForAgent),
        };
      },
    },
    {
      name: 'search_tweets',
      description: 'Search tweets across all of X using twitterapi.io advanced search syntax (e.g. "AI voice apps min_faves:50 lang:en"). Returns up to 20 tweets. queryType "Top" for high-engagement, "Latest" for fresh.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          query_type: { type: 'string', enum: ['Top', 'Latest'] },
          max: { type: 'integer', minimum: 1, maximum: 30 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async run({ query, query_type = 'Top', max = 20 }) {
        checkBudget();
        const tweets = await twitter.searchTweets({ query, queryType: query_type, max });
        for (const t of tweets) tweetCache.set(t.id, t);
        return {
          query,
          count: tweets.length,
          fetch_calls_used: fetchBudgetRef.calls,
          fetch_budget: fetchBudgetRef.limit,
          tweets: tweets.map(trimTweetForAgent),
        };
      },
    },
    {
      name: 'score_relevance',
      description: 'Record a niche-relevance score (1-5) for a handle, with a short reason. Multiple calls accumulate into a running average.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          score: { type: 'integer', minimum: 1, maximum: 5 },
          reason: { type: 'string' },
        },
        required: ['handle', 'score'],
        additionalProperties: false,
      },
      run({ handle, score, reason }) {
        const list = handleScores.get(handle.toLowerCase()) ?? [];
        list.push(score);
        handleScores.set(handle.toLowerCase(), list);
        return { handle, score, reason: reason ?? null };
      },
    },
    {
      name: 'add_to_pool',
      description: `Add a tweet to the curated pool. Only add tweets you genuinely think exemplify a pattern worth learning. Pool target ~${poolTarget}.`,
      input_schema: {
        type: 'object',
        properties: {
          tweet_id: { type: 'string' },
          reason: { type: 'string', description: 'Why this tweet is worth keeping (1 sentence)' },
        },
        required: ['tweet_id', 'reason'],
        additionalProperties: false,
      },
      run({ tweet_id, reason }) {
        const t = tweetCache.get(tweet_id);
        if (!t) return { added: false, error: 'unknown tweet_id (was it from a fetch in this run?)' };
        if (t.handle?.toLowerCase() === ownHandle) return { added: false, error: 'skipping own post' };
        pool.set(tweet_id, { tweet: t, reason });
        return { added: true, pool_size: pool.size };
      },
    },
    {
      name: 'blacklist_handle',
      description: 'Mark a seed handle as off-topic / drifted (e.g. became a crypto account). Removes from rotation.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['handle', 'reason'],
        additionalProperties: false,
      },
      run({ handle, reason }) {
        blacklistHandle(state, handle, reason);
        return { handle, status: 'blacklisted' };
      },
    },
    {
      name: 'promote_handle',
      description: 'Record a newly-discovered handle that produces relevant content. Sufficient score auto-promotes them to active seeds for next run.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          score: { type: 'integer', minimum: 1, maximum: 5 },
          reason: { type: 'string' },
        },
        required: ['handle', 'score'],
        additionalProperties: false,
      },
      run({ handle, score, reason }) {
        recordDiscovery(state, handle, score, reason ?? null);
        return { handle, recorded: true };
      },
    },
    {
      name: 'submit_patterns',
      description: 'Terminal tool — call exactly once when done curating. Submits the distilled patterns analysis as markdown. The loop ends after this call.',
      input_schema: {
        type: 'object',
        properties: {
          patterns_markdown: {
            type: 'string',
            description: 'A markdown analysis with sections: ## Patterns observed this run, ## Hook archetypes, ## Length / structure notes, ## Anti-patterns. Be specific — cite tweets when possible.',
          },
        },
        required: ['patterns_markdown'],
        additionalProperties: false,
      },
      run({ patterns_markdown }) {
        return { received: true, length: patterns_markdown.length };
      },
    },
  ];
}

// ----- output -----

function composeItems({ patternsMd, pool }) {
  const items = [];

  items.push({
    title: 'Patterns observed this run',
    body: patternsMd,
    tags: ['patterns'],
  });

  const ranked = Array.from(pool.values())
    .map(({ tweet, reason }) => ({
      tweet,
      reason,
      score: engagementScore(tweet),
    }))
    .sort((a, b) => b.score - a.score);

  for (const { tweet, reason, score } of ranked) {
    const created = tweet.created_at ? tweet.created_at.slice(0, 10) : 'undated';
    const metrics = `❤ ${tweet.likes} · 💬 ${tweet.replies} · 🔁 ${tweet.retweets} · 📑 ${tweet.bookmarks} · 👁 ${tweet.views}`;
    const body = [
      `**@${tweet.handle}** · ${created} · score ${score.toFixed(4)}`,
      metrics,
      '',
      `> ${tweet.text.replace(/\n/g, '\n> ')}`,
      '',
      `_why kept: ${reason}_`,
    ].join('\n');
    items.push({
      title: `@${tweet.handle}: ${tweet.text.slice(0, 60).replace(/\n/g, ' ')}`,
      body,
      url: tweet.url,
      tags: [tweet.handle, 'tweet'],
      date: tweet.created_at,
    });
  }

  return items;
}
