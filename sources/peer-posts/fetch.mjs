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

import { runClaude } from '../../scripts/lib/run-claude.mjs';
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

  const mcpServers = {
    'peer-posts': {
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

  const allowedTools = ['mcp__peer-posts'];

  console.log(`peer-posts: claude -p ${model} (max-turns=${maxAgentSteps}, fetch-budget=${fetchBudget})`);

  let claudeResult;
  try {
    claudeResult = await runClaude({
      prompt: userPrompt,
      systemPrompt,
      model,
      mcpServers,
      allowedTools,
      maxTurns: maxAgentSteps,
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
    (h) => h.promoted_at === new Date().toISOString().slice(0, 10)
  );

  const patternsMd = stripLeadingPatternsHeader(
    run.patterns_md?.trim() || claudeResult.finalText || '_(agent did not emit a patterns analysis this run)_'
  );

  const items = composeItems({ patternsMd, run });

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
  };

  return { items, meta };
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

# Goal
Build a pool of ~${poolTarget} high-engagement tweets from accounts that overlap with the user's niche, then distill the patterns that made them work.

# Tools (all under mcp__peer-posts__*)
- list_seeds — inspect rotation state
- pick_stale_seeds — rotate
- fetch_user_tweets — fetch a user's recent tweets (counts vs ${fetchBudget}-call budget)
- search_tweets — query advanced search (counts vs budget)
- score_relevance — record 1-5 score for a handle
- add_to_pool — keep a tweet you've fetched
- blacklist_handle — drop a drifting seed
- promote_handle — record a discovered handle
- submit_patterns — TERMINAL: emit distilled patterns; END the run

# Strategy
1. list_seeds + pick_stale_seeds(${params.seedsPerRun ?? 5}).
2. For each picked handle, fetch_user_tweets, evaluate the tweets:
   - Off-niche (crypto, lifestyle, etc.) → blacklist_handle.
   - On-niche → score_relevance, then add_to_pool only the standout tweets.
3. Run 2-3 search_tweets calls on niche topics from the project descriptions
   (e.g. "AI voice apps", "interactive fiction LLM", "indie founder AI").
   queryType: "Top" for high-engagement, "Latest" for fresh signal.
4. From search results, pick out NEW handles you'd recommend; promote_handle
   them. Add their best tweets to the pool.
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

function composeItems({ patternsMd, run }) {
  const items = [];

  items.push({
    title: 'Patterns observed this run',
    body: patternsMd,
    tags: ['patterns'],
  });

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
