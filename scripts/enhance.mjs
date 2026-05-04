#!/usr/bin/env node
// Autoimprove agent — reads a draft file, scores each draft against the
// patterns distilled in sources/peer-posts/latest.md and the voice in
// config/voice.md, and emits a critique + refined rewrite per draft.
//
// Powered by `claude -p` headless mode (Pro/Max subscription billing).
// The improve MCP server (mcp-servers/improve/server.mjs) exposes a single
// tool, submit_critique, which Claude is instructed to call exactly once.
// Results are persisted to a per-draft JSON file the parent reads after
// `claude -p` exits.
//
// Usage:
//   npm run enhance                      # enhances today's draft file
//   npm run enhance -- --file=drafts/2026-05-04.md
//   npm run enhance -- --draft=3
//   npm run enhance -- --force           # re-run on already-enhanced drafts

import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDraftFile } from './lib/parse-drafts.mjs';
import { stampDraft } from './lib/stamp-draft.mjs';
import { runClaude, probeClaudeAuth } from './lib/run-claude.mjs';
import { parseArchive, topPerformers } from './lib/archive.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const VOICE_PATH = path.join(ROOT, 'config/voice.md');
const PEER_POSTS_PATH = path.join(ROOT, 'sources/peer-posts/latest.md');
const ARCHIVE_PATH = path.join(ROOT, 'posted/archive.md');
const MCP_SERVER_PATH = path.resolve(here, '..', '..', 'mcp-servers/improve/server.mjs');

const CHAR_LIMIT = 280;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
// 3 turns: think → call submit_critique → end. We retry once at the
// caller layer (not inside the loop) if the first try doesn't emit.
const MAX_TURNS = 3;

const BANNED_PHRASES = [
  'game-changer',
  'dive deep',
  "here's the thing",
  'let me explain',
  'thread :thread:',
  'hot take:',
  'unpopular opinion:',
  "let's talk about",
  "i'm excited to announce",
];

function parseArgs(argv) {
  const args = { force: false };
  for (const a of argv.slice(2)) {
    if (a === '--force') args.force = true;
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
    else if (a.startsWith('--draft=')) args.draft = Number(a.slice('--draft='.length));
  }
  return args;
}

function todayFile() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(DRAFTS_DIR, `${today}.md`);
}

async function pickDraftFile(arg) {
  if (arg) return path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
  const t = todayFile();
  if (existsSync(t)) return t;
  const files = (await readdir(DRAFTS_DIR)).filter((f) => f.endsWith('.md')).sort();
  if (!files.length) throw new Error('no draft files found');
  return path.join(DRAFTS_DIR, files.at(-1));
}

function runRules(body) {
  const violations = [];
  const lower = body.toLowerCase();
  if (!body) violations.push('empty body');
  if (body.length > CHAR_LIMIT) violations.push(`length ${body.length} > ${CHAR_LIMIT}`);
  for (const p of BANNED_PHRASES) {
    if (lower.includes(p)) violations.push(`banned phrase: "${p}"`);
  }
  const hashtags = (body.match(/(^|\s)#[\w]+/g) ?? []).length;
  if (hashtags >= 2) violations.push(`${hashtags} hashtags (use 0-1)`);
  if (/https?:\/\/\S+/.test(body)) violations.push('contains external link (algorithm depresses link posts)');
  return violations;
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

async function lastPostedTexts(daysBack = 7) {
  if (!existsSync(ARCHIVE_PATH)) return [];
  const text = await readFile(ARCHIVE_PATH, 'utf8');
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (h) {
      if (cur && cur.date >= cutoff) out.push(cur.body);
      cur = { date: h[1], body: '' };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('> ')) cur.body += line.slice(2) + '\n';
  }
  if (cur && cur.date >= cutoff) out.push(cur.body);
  return out.map((s) => s.trim()).filter(Boolean);
}

function buildSystemPrompt({ voice, peerPosts, recentPosts, ownTopPerformers }) {
  const recent = recentPosts.length
    ? recentPosts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}${p.length > 200 ? '…' : ''}`).join('\n')
    : '(no recent posts in archive)';

  const ownTop = ownTopPerformers.length
    ? ownTopPerformers.map((p, i) => {
        const m = p.metrics;
        const stats = `likes=${m.likes ?? '—'} replies=${m.replies ?? '—'} reposts=${m.reposts ?? '—'}${m.bookmarks != null ? ` bookmarks=${m.bookmarks}` : ''}`;
        return `${i + 1}. (${p.date} · ${stats}) ${p.body.replace(/\s+/g, ' ').slice(0, 240)}`;
      }).join('\n')
    : '_(no engagement data yet — feedback loop will populate this once posts have aged 24h+)_';

  return `You are a tweet-improvement agent for an X content engine.

For each draft you're given, score it on four axes against the user's voice
and the engagement patterns observed this week, then produce one refined
rewrite.

# Output protocol
Call the mcp__improve__submit_critique tool EXACTLY ONCE with the structured
result. Do not call any other tool. Do not output additional text after the
tool call — end your turn.

# Voice (user's tone, audience, banned phrases)

${voice.trim()}

# Peer engagement patterns (this week)

${peerPosts.trim() || '_(no peer-posts data yet — score against voice + general principles)_'}

# User's own top-performing posts

These are the user's posts with the highest engagement to date. Mirror what's
working for THEIR audience (hook, structure, specificity) — peer patterns are
secondary signal.

${ownTop}

# Posts the user already published in the last 7 days

${recent}

# Hard rules
- Refined tweet must be ≤ ${CHAR_LIMIT} chars.
- Refined must not use any banned phrase from the voice file.
- Refined must contain a specific technical detail (number, name, mechanism)
  unless the original is a question/engagement post — then a sharp question is ok.
- Don't repeat a topic the user posted in the last 7 days. If the draft
  duplicates one, say so in the critique and refine to a different angle.
- 0 or 1 hashtag max. No external links unless the original explicitly needs it.
- Match the user's voice (lowercase starts ok, fragments ok, terse, no hype).

# Scoring rubric (each 1-5)
- specificity: concrete number/name/mechanism vs vague claim
- hook: does the first line grab someone scrolling?
- length: every word earning its place at the chosen length
- pattern_match: does it use a hook archetype that's working in the niche?

# Critique style
2-3 sentences max. Be direct. Reference the patterns when possible.`;
}

function buildUserPrompt(draft, ruleViolations) {
  const projectLine = draft.project ? `Project: ${draft.project}` : 'Project: general';
  const ruleBlock = ruleViolations.length
    ? `Deterministic rule violations to fix:\n${ruleViolations.map((v) => '- ' + v).join('\n')}`
    : 'Deterministic rule check: clean.';
  return `${projectLine}
Title: ${draft.title}
Body (${draft.body.length} chars):
${draft.body}

${ruleBlock}

Score, critique, and rewrite via submit_critique.`;
}

async function critiqueOne({ draft, system, model, resultFile }) {
  // Wipe any previous result for this draft.
  if (existsSync(resultFile)) await unlink(resultFile);

  const baseUserPrompt = buildUserPrompt(draft, runRules(draft.body));

  const mcpServers = {
    improve: {
      command: 'node',
      args: [MCP_SERVER_PATH],
      env: { IMPROVE_RESULT_FILE: resultFile },
    },
  };

  // Try once normally; if Claude didn't call submit_critique, re-prompt with
  // a stricter instruction. The result file is the source of truth.
  const attempts = [
    baseUserPrompt,
    baseUserPrompt + '\n\nREQUIRED: respond by calling mcp__improve__submit_critique exactly once. No prose. No other tools.',
  ];

  for (const prompt of attempts) {
    await runClaude({
      prompt,
      systemPrompt: system,
      model,
      mcpServers,
      maxTurns: MAX_TURNS,
    });
    if (existsSync(resultFile)) {
      const entries = JSON.parse(await readFile(resultFile, 'utf8'));
      if (entries.length) return entries.at(-1);
    }
  }
  throw new Error('model did not call submit_critique after retry');
}

function formatScore(s) {
  return `specificity ${s.specificity}/5 · hook ${s.hook}/5 · length ${s.length}/5 · pattern ${s.pattern_match}/5`;
}

async function main() {
  const args = parseArgs(process.argv);
  const file = await pickDraftFile(args.file);
  console.log(`enhance: ${path.relative(ROOT, file)}`);

  const drafts = await parseDraftFile(file);
  if (!drafts.length) {
    console.log('no drafts parsed.');
    return;
  }

  const candidates = drafts.filter((d) => {
    if (args.draft && d.index !== args.draft) return false;
    if (!d.body) return false;
    if (d.posted) return false;
    if (!args.force && d.refined) return false;
    return true;
  });

  if (!candidates.length) {
    console.log('no drafts to enhance (threads + already-enhanced are skipped; pass --force to redo)');
    return;
  }

  const [voice, peerPosts] = await Promise.all([
    readFile(VOICE_PATH, 'utf8'),
    readFile(PEER_POSTS_PATH, 'utf8').catch(() => ''),
  ]);
  const recentPosts = await lastPostedTexts(7);
  const ownTopPerformers = await loadOwnTopPerformers();

  const authProbe = await probeClaudeAuth();
  if (!authProbe.ok) throw new Error(`auth check failed: ${authProbe.reason}`);

  const model = process.env.IMPROVE_MODEL ?? DEFAULT_MODEL;
  const system = buildSystemPrompt({ voice, peerPosts, recentPosts, ownTopPerformers });

  console.log(`model: ${model} · ${candidates.length} draft(s) · peer-posts: ${peerPosts ? 'loaded' : 'missing'} · own top: ${ownTopPerformers.length}\n`);

  // Per-run temp dir for result files.
  const runDir = path.join(tmpdir(), `x-engine-improve-${randomBytes(4).toString('hex')}`);
  await mkdir(runDir, { recursive: true });

  for (const d of candidates) {
    const violations = runRules(d.body);
    if (violations.length) console.log(`  #${d.index}: rule check — ${violations.length} violation(s)`);
    let entry;
    try {
      entry = await critiqueOne({
        draft: d,
        system,
        model,
        resultFile: path.join(runDir, `draft-${d.index}.json`),
      });
    } catch (err) {
      console.error(`  #${d.index}: ERROR ${err.message}`);
      continue;
    }

    const refined = String(entry.refined ?? '').replace(/\n+/g, ' ').trim();
    const refinedChars = refined.length;
    const refinedIssues = runRules(refined);
    if (refinedIssues.length) {
      console.warn(`  #${d.index}: refined has ${refinedIssues.length} rule issue(s): ${refinedIssues.join('; ')}`);
    }

    const updates = {
      Score: formatScore(entry.score),
      Critique: String(entry.critique ?? '').replace(/\n+/g, ' ').trim(),
      Refined: refined,
    };
    if (refinedIssues.length) updates.RefinedIssues = refinedIssues.join('; ');
    await stampDraft({ filePath: file, draftIndex: d.index, updates });
    console.log(`  #${d.index}: ${formatScore(entry.score)}`);
    console.log(`     ${refined.slice(0, 70)}${refinedChars > 70 ? '…' : ''} (${refinedChars}c)`);
  }

  console.log(`\ndone. ${candidates.length} draft(s) enhanced.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
