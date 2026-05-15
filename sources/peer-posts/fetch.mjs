// Autoresearch agent that builds the peer-posts source.
//
// On each `npm run sync`, the parent script:
//   1. Spawns `claude -p` in headless mode (Pro/Max subscription billing).
//   2. The CLI launches mcp-servers/peer-posts/server.mjs over stdio,
//      exposing 9 tools the agent uses (fetch tweets, search, score, etc).
//   3. The MCP server persists pool/scores/patterns/state to disk between
//      tool calls, so the parent can read them after the run exits.
//   4. The parent finalizes rotation state (recordPull + promoteDiscovered)
//      and composes the latest.md items.
//
// Auth: CLAUDE_CODE_OAUTH_TOKEN must be set; ANTHROPIC_API_KEY must be unset
// (footgun guard inside run-claude.mjs).

import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runClaude, probeClaudeAuth } from '../../scripts/lib/run-claude.mjs';
import { engagementScore } from '../../scripts/lib/twitterapi-io.mjs';
import {
  loadState,
  saveState,
  ensureHandles,
  recordPull,
  promoteDiscovered,
  avgScore,
} from '../../scripts/lib/peer-state.mjs';

const here = fileURLToPath(import.meta.url);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MCP_SERVER_PATH = resolve(here, '..', '..', '..', 'mcp-servers/peer-posts/server.mjs');

export async function fetch(source, env) {
  const apiKey = env.TWITTERAPI_IO_KEY;
  if (!apiKey) throw new Error('TWITTERAPI_IO_KEY not set in .env.local');

  const params = source.params ?? {};
  const seedHandles = params.seedHandles ?? [];
  const windowDays = params.windowDays ?? 14;
  const seedsPerRun = params.seedsPerRun ?? 5;
  const poolTarget = params.poolTarget ?? 30;
  const maxAgentSteps = params.maxAgentSteps ?? 30;
  const fetchBudget = params.fetchBudget ?? 15;
  const model = env.RESEARCH_MODEL ?? DEFAULT_MODEL;

  const today = new Date().toISOString().slice(0, 10);
  const stateFile = join(source.dir, '.state.json');
  const runFile = join(source.dir, '.run.json');

  // Reset transient run state. The MCP server starts from a clean slate
  // each invocation; the long-lived rotation/blacklist state in .state.json
  // is preserved.
  if (existsSync(runFile)) await unlink(runFile);
  await writeFile(
    runFile,
    JSON.stringify({ pool: [], tweet_cache: {}, fetch_calls: 0, scores: {}, fetched_handles: [] }, null, 2)
  );

  // Seed state file so the MCP server doesn't need to know seedHandles.
  const state = ensureHandles(await loadState(source.dir), seedHandles);
  state.last_run = new Date().toISOString();
  await saveState(source.dir, state);

  const repoRoot = resolve(source.dir, '..', '..');
  const niche = await loadNicheBrief(repoRoot);

  const systemPrompt = renderSystemPrompt({ niche, params, windowDays, poolTarget, fetchBudget });
  const userPrompt = renderUserPrompt({ state, seedHandles });

  // Server name uses underscores so tool names normalize to mcp__peer_posts__*
  const mcpServers = {
    peer_posts: {
      command: 'node',
      args: [MCP_SERVER_PATH],
      env: {
        TWITTERAPI_IO_KEY: apiKey,
        PEER_POSTS_STATE_FILE: stateFile,
        PEER_POSTS_RUN_FILE: runFile,
        PEER_POSTS_SEED_HANDLES: seedHandles.join(','),
        PEER_POSTS_WINDOW_DAYS: String(windowDays),
        PEER_POSTS_FETCH_BUDGET: String(fetchBudget),
        PEER_POSTS_SEEDS_PER_RUN: String(seedsPerRun),
        PEER_POSTS_POOL_TARGET: String(poolTarget),
      },
    },
  };

  const authProbe = await probeClaudeAuth();
  if (!authProbe.ok) {
    throw new Error(`auth check failed: ${authProbe.reason}`);
  }
  console.log(`peer-posts: claude -p ${model} (max-turns=${maxAgentSteps}, fetch-budget=${fetchBudget})`);

  let claudeResult;
  try {
    claudeResult = await runClaude({
      prompt: userPrompt,
      systemPrompt,
      model,
      mcpServers,
      maxTurns: maxAgentSteps,
      verbose: true, // mirror text deltas + tool-error + result events to stderr
      onEvent(evt) {
        if (evt.type === 'assistant' && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === 'tool_use') {
              const preview = JSON.stringify(block.input).slice(0, 80);
              console.log(`  [agent] ${block.name}(${preview})`);
            }
          }
        }
      },
    });
  } finally {
    // Even on crash, finalize state from whatever the MCP server persisted.
    await finalizeState({ sourceDir: source.dir, runFile });
  }

  const run = JSON.parse(await readFile(runFile, 'utf8'));
  const finalState = await loadState(source.dir);

  const promoted = Object.values(finalState.handles).filter(
    (h) => h.promoted_at === today
  );

  const patternsMd = stripLeadingPatternsHeader(
    run.patterns_md?.trim() || claudeResult.finalText || '_(agent did not emit a patterns analysis this run)_'
  );

  // Deep-study pass: profile one account's style DNA
  const deepStudyHandles = params.deepStudyHandles ?? [];
  const deepStudyPerRun = params.deepStudyPerRun ?? 1;
  let deepStudyMd = null;
  if (deepStudyHandles.length) {
    try {
      deepStudyMd = await runDeepStudy({
        deepStudyHandles,
        deepStudyPerRun,
        stateFile,
        runFile,
        apiKey,
        model,
        source,
        niche,
        fetchBudget,
      });
    } catch (err) {
      console.warn(`peer-posts: deep-study pass failed (${err.message}) — skipping`);
    }
  }

  const items = composeItems({ patternsMd, run, deepStudyMd });

  const meta = {
    model,
    auth: 'claude-code-oauth',
    pool_size: run.pool.length,
    fetch_calls: run.fetch_calls,
    fetch_budget: fetchBudget,
    fetched_handles: (run.fetched_handles ?? []).length,
    discovered: Object.keys(finalState.discovered ?? {}).length,
    promoted: promoted.length,
    tool_uses: claudeResult.toolUses?.length ?? 0,
    deep_study: deepStudyMd ? 'completed' : 'skipped',
  };

  return { items, meta };
}

// ----- deep-study pass -----

async function runDeepStudy({ deepStudyHandles, deepStudyPerRun, stateFile, runFile, apiKey, model, source, niche, fetchBudget }) {
  const state = await loadState(source.dir);

  // Pick stalest deep-study handles (by last_deep_studied timestamp)
  const sorted = deepStudyHandles
    .map((h) => ({ handle: h, last: state.handles?.[h]?.last_deep_studied ?? null }))
    .sort((a, b) => {
      if (!a.last && !b.last) return 0;
      if (!a.last) return -1;
      if (!b.last) return 1;
      return a.last.localeCompare(b.last);
    });
  const picks = sorted.slice(0, deepStudyPerRun).map((s) => s.handle);

  if (!picks.length) return null;
  const handle = picks[0];
  console.log(`peer-posts: deep-study → @${handle}`);

  const deepStudySystem = renderDeepStudySystem({ handle, niche });
  const deepStudyUser = `Deep-study @${handle}. Fetch their tweets via deep_study_account, then call submit_patterns with the style analysis.`;

  const deepRunFile = join(source.dir, '.deep-run.json');
  if (existsSync(deepRunFile)) await unlink(deepRunFile);
  await writeFile(deepRunFile, JSON.stringify({ pool: [], tweet_cache: {}, fetch_calls: 0, scores: {}, fetched_handles: [] }, null, 2));

  const mcpServers = {
    peer_posts: {
      command: 'node',
      args: [MCP_SERVER_PATH],
      env: {
        TWITTERAPI_IO_KEY: apiKey,
        PEER_POSTS_STATE_FILE: stateFile,
        PEER_POSTS_RUN_FILE: deepRunFile,
        PEER_POSTS_SEED_HANDLES: '',
        PEER_POSTS_WINDOW_DAYS: '30',
        PEER_POSTS_FETCH_BUDGET: '3',
        PEER_POSTS_SEEDS_PER_RUN: '1',
        PEER_POSTS_POOL_TARGET: '0',
      },
    },
  };

  const result = await runClaude({
    prompt: deepStudyUser,
    systemPrompt: deepStudySystem,
    model,
    mcpServers,
    maxTurns: 8,
  });

  // Stamp last_deep_studied on state
  const updatedState = await loadState(source.dir);
  if (!updatedState.handles[handle]) updatedState.handles[handle] = { handle, status: 'active' };
  updatedState.handles[handle].last_deep_studied = new Date().toISOString().slice(0, 10);
  await saveState(source.dir, updatedState);

  // Read back patterns
  const deepRun = existsSync(deepRunFile)
    ? JSON.parse(await readFile(deepRunFile, 'utf8'))
    : {};
  if (existsSync(deepRunFile)) await unlink(deepRunFile);

  const md = deepRun.patterns_md?.trim() || result.finalText || null;
  if (!md) return null;

  return `## Deep study: @${handle}\n\n${stripLeadingPatternsHeader(md)}`;
}

function renderDeepStudySystem({ handle, niche }) {
  return `You are a style-profiling agent. Your job: analyze @${handle}'s tweet formatting, structure, and voice to extract a replicable style fingerprint.

# Output protocol
Call mcp__peer_posts__submit_patterns EXACTLY ONCE with the style analysis. Do not call any other tool after that.

# Tools available
- deep_study_account — fetch 20+ tweets from @${handle} (full text, no truncation)
- submit_patterns — emit your analysis (TERMINAL)

# Strategy
1. Call deep_study_account for @${handle}
2. Analyze the returned tweets for style DNA
3. Call submit_patterns with your analysis

# Analysis format (for submit_patterns)
Structure your markdown output like this:

### Top 5 tweets (verbatim — use these as formatting templates)

Quote the 5 highest-engagement tweets in full, each in a blockquote with metrics.

### Style fingerprint

- Average character count
- Line break frequency (how many newlines per tweet on average)
- Hook patterns (how do they open? fragment? question? statement?)
- Closing patterns (how do they end? CTA? trailing thought? punchline?)
- Emoji usage (frequency, placement)
- Punctuation style (periods? fragments? colons? arrows?)
- Sentence rhythm (short choppy vs flowing? mixed?)

### "Write like @${handle}" instruction

One paragraph telling a drafting agent exactly how to replicate this style.
Be concrete: name the sentence lengths, the connector words, the structural
patterns. Not "be concise" — rather "open with a 4-8 word fragment, no verb.
Skip a line. 2-3 short sentences with periods. No closing period."

# Context (the user's niche — for relevance)

${niche.voice.slice(0, 500)}

# Hard rules
- Focus on FORMAT and STRUCTURE, not topics
- Quote tweets VERBATIM — do not paraphrase
- The fingerprint must be specific enough to replicate (no vague advice)
- Keep total output under 2000 chars`;
}

// ----- finalization (parent-side, runs even if agent crashed) -----

async function finalizeState({ sourceDir, runFile }) {
  if (!existsSync(runFile)) return;
  const run = JSON.parse(await readFile(runFile, 'utf8'));
  const state = await loadState(sourceDir);
  for (const handle of run.fetched_handles ?? []) {
    recordPull(state, handle, run.scores?.[handle] ?? []);
  }
  for (const handle of Object.keys(run.scores ?? {})) {
    if (!(run.fetched_handles ?? []).includes(handle)) {
      recordPull(state, handle, run.scores[handle] ?? []);
    }
  }
  promoteDiscovered(state);
  await saveState(sourceDir, state);
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

# CRITICAL OPERATIONAL RULES (read first)
1. ONLY use tools under mcp__peer_posts__*. Tools like Bash, Read, Write,
   WebFetch, WebSearch, ToolSearch are NOT available — do not attempt them.
2. If ANY tool returns an error, do NOT retry. Move to a different operation,
   or call submit_patterns immediately to end the run.
3. Do NOT add sleeps, waits, retries, or rate-limit "fixes" — fetches are
   already serialized at 1.2s server-side.
4. When fetch_budget reaches its limit, the tool will refuse further calls.
   Call submit_patterns immediately with whatever pool you have.
5. Maximum tool calls per run: ~25. Keep moves tight.

# Goal
Build a pool of ~${poolTarget} high-engagement tweets from accounts that overlap with the user's niche, then distill the patterns that made them work.

# Tools (all under mcp__peer_posts__*)
- list_seeds — inspect rotation state
- pick_stale_seeds — rotate (informational; the seed list is also visible to you in the user prompt)
- search_tweets — query advanced search (counts vs ${fetchBudget}-call budget)
- score_relevance — record 1-5 score for a handle
- add_to_pool — keep a tweet you've fetched
- blacklist_handle — drop a drifting seed
- promote_handle — record a discovered handle
- submit_patterns — TERMINAL: emit distilled patterns; END the run

NOTE: fetch_user_tweets is currently DISABLED — the upstream endpoint is
unreliable. Use search_tweets exclusively. To pull a known seed's recent
posts, use search_tweets with the operator \`from:handle min_faves:50\`.

# Strategy
1. list_seeds (read-only; informational).
2. Run 3-5 search_tweets calls covering both:
   a) per-seed pulls via \`from:handle\` syntax (e.g. \`from:levelsio min_faves:100\`)
      for the stalest seeds you'd most like to refresh
   b) niche topic queries from the project descriptions (e.g.
      "AI voice apps", "interactive fiction LLM", "indie founder AI")
   queryType: "Top" for high-engagement signal.
3. Score on-niche handles with score_relevance; blacklist drift; add the
   standout tweets to the pool with add_to_pool.
4. Promote new handles you discover with promote_handle.
5. Stop fetching when pool >= ${poolTarget}, or budget runs out.
6. submit_patterns with the distilled markdown.

# Output format for submit_patterns
Do NOT include a top-level "## Patterns observed" header — that's the
rendered title. Start with a 1-2 sentence summary, then ### sub-sections:

   <one-paragraph summary>

   ### Specific patterns
   - 3-5 specific patterns. "what + how often + why it likely worked"
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
  high engagement-per-impression.
- Do NOT add the user's own posts (handle: @octavicristea) to the pool.
- Be efficient — twitter fetches cost real money. Hard cap is ${fetchBudget}
  calls; once the tool refuses, call submit_patterns immediately with what
  you have.
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

// ----- output -----

function stripLeadingPatternsHeader(md) {
  return md.replace(/^\s*##\s+Patterns? observed[^\n]*\n+/i, '').trimStart();
}

function composeItems({ patternsMd, run, deepStudyMd }) {
  const items = [];

  items.push({
    title: 'Patterns observed this run',
    body: patternsMd,
    tags: ['patterns'],
  });

  if (deepStudyMd) {
    items.push({
      title: 'Deep study (style reference)',
      body: deepStudyMd,
      tags: ['deep-study', 'style-reference'],
    });
  }

  const ranked = run.pool
    .map(({ tweet_id, reason }) => {
      const tweet = run.tweet_cache[tweet_id];
      if (!tweet) return null;
      return { tweet, reason, score: engagementScore(tweet) };
    })
    .filter(Boolean)
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
