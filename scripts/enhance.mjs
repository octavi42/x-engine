#!/usr/bin/env node
// Autoimprove agent — reads a draft file, scores each draft against the
// patterns distilled in sources/peer-posts/latest.md and the voice in
// config/voice.md, and emits a critique + refined rewrite per draft.
//
// Usage:
//   npm run enhance                      # enhances today's draft file
//   npm run enhance -- --file=drafts/2026-05-04.md
//   npm run enhance -- --draft=3         # only enhance draft #3 in today's file
//   npm run enhance -- --force           # re-run on drafts already enhanced

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { makeClient } from './lib/agent-loop.mjs';
import { parseDraftFile } from './lib/parse-drafts.mjs';
import { stampDraft } from './lib/stamp-draft.mjs';

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const VOICE_PATH = path.join(ROOT, 'config/voice.md');
const PEER_POSTS_PATH = path.join(ROOT, 'sources/peer-posts/latest.md');
const ARCHIVE_PATH = path.join(ROOT, 'posted/archive.md');
const CHAR_LIMIT = 280;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

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

function buildSystemPrompt({ voice, peerPosts, recentPosts }) {
  const recent = recentPosts.length
    ? recentPosts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}${p.length > 200 ? '…' : ''}`).join('\n')
    : '(no recent posts in archive)';

  return `You are a tweet-improvement agent for an X content engine.

For each draft you're given, you score it on four axes against the user's voice
and the engagement patterns observed this week, then write one refined rewrite.

# Output protocol
You MUST respond by calling the submit_critique tool exactly once. Never reply
with plain text — the loop only reads the tool input.

# Voice (user's tone, audience, banned phrases)

${voice.trim()}

# Peer engagement patterns (this week)

${peerPosts.trim() || '_(no peer-posts data yet — score against voice + general principles)_'}

# Posts the user already published in the last 7 days

${recent}

# Hard rules
- Refined tweet must be ≤ ${CHAR_LIMIT} chars.
- Refined tweet must not use any banned phrase from the voice file.
- Refined tweet must contain a specific technical detail (number, name, mechanism)
  unless the original is a question/engagement post — then a sharp question is ok.
- Don't repeat a topic the user posted in the last 7 days. If the draft
  duplicates one, say so in the critique and refine to a different angle if
  possible.
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

const SUBMIT_CRITIQUE_TOOL = {
  name: 'submit_critique',
  description: 'Emit the structured critique + refined rewrite. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      score: {
        type: 'object',
        properties: {
          specificity: { type: 'integer', minimum: 1, maximum: 5 },
          hook: { type: 'integer', minimum: 1, maximum: 5 },
          length: { type: 'integer', minimum: 1, maximum: 5 },
          pattern_match: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['specificity', 'hook', 'length', 'pattern_match'],
        additionalProperties: false,
      },
      critique: { type: 'string', description: '2-3 sentence direct critique' },
      refined: {
        type: 'string',
        description: `The rewritten tweet, single line, ≤ ${CHAR_LIMIT} chars. No preamble.`,
      },
    },
    required: ['score', 'critique', 'refined'],
    additionalProperties: false,
  },
};

async function critiqueDraft(client, model, system, draft, ruleViolations) {
  const projectLine = draft.project ? `Project: ${draft.project}` : 'Project: general';
  const ruleBlock = ruleViolations.length
    ? `Deterministic rule violations to fix:\n${ruleViolations.map((v) => '- ' + v).join('\n')}`
    : 'Deterministic rule check: clean.';

  const userPrompt = `${projectLine}
Title: ${draft.title}
Body (${draft.body.length} chars):
${draft.body}

${ruleBlock}

Score, critique, and rewrite via submit_critique.`;

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: [SUBMIT_CRITIQUE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_critique' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_critique');
  if (!block) throw new Error('model did not call submit_critique');
  return { ...block.input, usage: response.usage };
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
    if (!d.body) return false; // threads / sub-section drafts skipped
    if (d.posted) return false; // already posted
    if (!args.force && d.refined) return false; // already enhanced
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

  const client = makeClient();
  const model = process.env.IMPROVE_MODEL ?? DEFAULT_MODEL;
  const system = buildSystemPrompt({ voice, peerPosts, recentPosts });

  console.log(`model: ${model} · ${candidates.length} draft(s) · peer-posts: ${peerPosts ? 'loaded' : 'missing'}\n`);

  let totalIn = 0;
  let totalOut = 0;
  for (const d of candidates) {
    const violations = runRules(d.body);
    if (violations.length) console.log(`  #${d.index}: rule check — ${violations.length} violation(s)`);
    let result;
    try {
      result = await critiqueDraft(client, model, system, d, violations);
    } catch (err) {
      console.error(`  #${d.index}: ERROR ${err.message}`);
      continue;
    }
    totalIn += result.usage?.input_tokens ?? 0;
    totalOut += result.usage?.output_tokens ?? 0;

    const refined = result.refined.replace(/\n+/g, ' ').trim();
    const refinedChars = refined.length;
    const refinedIssues = runRules(refined);
    if (refinedIssues.length) {
      console.warn(`  #${d.index}: refined has ${refinedIssues.length} rule issue(s): ${refinedIssues.join('; ')}`);
    }

    const updates = {
      Score: formatScore(result.score),
      Critique: result.critique.replace(/\n+/g, ' ').trim(),
      Refined: refined,
    };
    if (refinedIssues.length) updates.RefinedIssues = refinedIssues.join('; ');
    await stampDraft({ filePath: file, draftIndex: d.index, updates });
    console.log(`  #${d.index}: ${formatScore(result.score)}`);
    console.log(`     ${refined.slice(0, 70)}${refinedChars > 70 ? '…' : ''} (${refinedChars}c)`);
  }

  console.log(`\ndone. ${candidates.length} draft(s) enhanced. tokens: ${totalIn} in / ${totalOut} out.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
