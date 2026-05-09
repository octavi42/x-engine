#!/usr/bin/env node
// Drafting agent — generates today's drafts/YYYY-MM-DD.md from the current
// state of voice + projects + sources + posted archive. The autonomous
// equivalent of asking Claude in chat to "generate today's drafts".
//
// Powered by `claude -p` headless mode (Pro/Max subscription billing).
// The draft MCP server (mcp-servers/draft/server.mjs) exposes a single
// tool, submit_drafts, which Claude is instructed to call once with a
// structured batch (single tweets + threads). The parent then renders
// the structured output to the canonical draft markdown format.
//
// Usage:
//   npm run draft                  # writes drafts/YYYY-MM-DD.md for today
//   npm run draft -- --date=2026-05-05
//   npm run draft -- --force       # overwrite an existing file
//   npm run draft -- --count=4     # hint to the agent about batch size

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runClaude, probeClaudeAuth } from './lib/run-claude.mjs';
import { trimTrendingLog, clipText } from './lib/trim-sources.mjs';

export const CHAR_LIMIT = 280;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TURNS = 4;
const TRENDING_DAYS = 14;
const MAX_SOURCE_BYTES = 20_000;
const MAX_ARCHIVE_BYTES = 10_000;
const here = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const VOICE_PATH = path.join(ROOT, 'config/voice.md');
const PROJECTS_DIR = path.join(ROOT, 'config/projects');
const SOURCES_DIR = path.join(ROOT, 'sources');
const ARCHIVE_PATH = path.join(ROOT, 'posted/archive.md');
const MCP_SERVER_PATH = path.resolve(here, '..', '..', 'mcp-servers/draft/server.mjs');

function parseArgs(argv) {
  const args = { force: false };
  for (const a of argv.slice(2)) {
    if (a === '--force') args.force = true;
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
    else if (a.startsWith('--count=')) args.count = Number(a.slice('--count='.length));
  }
  return args;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function loadContext() {
  const voice = await readFile(VOICE_PATH, 'utf8');

  const projects = [];
  const projectFiles = (await readdir(PROJECTS_DIR).catch(() => []))
    .filter((f) => f.endsWith('.md'))
    .sort();
  for (const f of projectFiles) {
    projects.push({
      name: path.basename(f, '.md'),
      content: await readFile(path.join(PROJECTS_DIR, f), 'utf8'),
    });
  }

  const sources = [];
  const sourceDirs = (await readdir(SOURCES_DIR).catch(() => [])).sort();
  for (const d of sourceDirs) {
    const latest = path.join(SOURCES_DIR, d, 'latest.md');
    if (!existsSync(latest)) continue;
    let content = await readFile(latest, 'utf8');
    if (d === 'trending') content = trimTrendingLog(content, TRENDING_DAYS);
    sources.push({ name: d, content: clipText(content, MAX_SOURCE_BYTES) });
  }

  const archiveRaw = existsSync(ARCHIVE_PATH) ? await readFile(ARCHIVE_PATH, 'utf8') : '';
  const archive = clipText(archiveRaw, MAX_ARCHIVE_BYTES);

  return { voice, projects, sources, archive };
}

function buildSystemPrompt(ctx) {
  const projectNames = ctx.projects.map((p) => p.name).concat('general');
  const projectBlock = ctx.projects
    .map((p) => `### ${p.name}\n\n${p.content.trim()}`)
    .join('\n\n');
  const sourcesBlock = ctx.sources
    .map((s) => `### sources/${s.name}/latest.md\n\n${s.content.trim()}`)
    .join('\n\n---\n\n');

  return `You are a drafting agent for an X/Twitter content engine for @octavicristea.

Your job: produce today's batch of 4-6 drafts that the human will review, refine, and post.

# Output protocol
You MUST call mcp__draft__submit_drafts EXACTLY ONCE with the full structured
batch. After the tool returns "accepted: true", end your turn — do not write
extra text. If it returns errors, fix and resubmit the FULL corrected batch.

# Voice (tone, audience, banned phrases)

${ctx.voice.trim()}

# Projects (tag each draft with one of: ${projectNames.join(', ')})

${projectBlock}

# Sources (today's signal — use these as the raw material)

${sourcesBlock || '_(no sources available — draft from voice + projects only)_'}

# Recently posted (DO NOT repeat any topic from the last 7 days)

${ctx.archive.trim() || '_(empty archive)_'}

# Hard rules
- 4-6 drafts. Mix of types. Aim for: 1-2 building-in-public, 1 technical tip,
  1 trending reaction, 0-1 engagement question, 0-1 thread.
- Single tweet body ≤ ${CHAR_LIMIT} chars. Thread posts: each ≤ ${CHAR_LIMIT} chars,
  3-7 posts total, the first must stand alone as a hook.
- Every draft MUST contain a specific technical detail (named tool, model,
  error code, number, mechanism). Vague claims fail.
- No banned phrases from voice.md.
- At least one draft addresses a content gap (per sources/x-profile + sources/peer-posts).
- Tag each with project (must match a project file or "general") and source provenance.

# Voice match
- Lowercase starts ok, fragments ok, terse, no hype.
- NO em dashes (—) or en dashes (–) in any body or refined line. They read as
  AI rhetorical setup-and-reveal. Replace with period, comma, colon, or newline.
  Hyphens only in compound modifiers ("launch-day", "self-hosted").
- NO trailing period on the last sentence or fragment of any body or refined
  line. Internal periods are fine; the final one reads formal and AI-typed.
  Question marks, exclamation points, arrows, code/numbers are unaffected.
- Use newlines INSIDE bodies for X readability — write each line of the post
  on its own line in the body string. Common patterns:
  · Hook line. blank. body. blank. closer.
  · symptom: / cause: / fix: with line breaks
  · 3-5 short bullet items, newline between each
- Match the patterns observed in sources/peer-posts/latest.md (completion
  hooks, named stacks, specific time claims, low-ego "Playing with X → made Y").

# Schema reminder
Each draft is { title, type, source, project, gap_addressed?, body? OR thread_posts? }.
Use thread_posts for threads (array of { label, body }) — never both body and thread_posts.

Begin drafting. Submit via submit_drafts when done.`;
}

function buildUserPrompt({ date, count }) {
  const countHint = count ? `Aim for ~${count} drafts.` : 'Aim for 4-6 drafts.';
  return `Today is ${date}. ${countHint} Generate today's drafts now via submit_drafts.`;
}

// Pure renderer — exported for testing.
export function buildDraftFile({ date, intro, drafts }) {
  const lines = [`# Drafts — ${date}`, ''];
  if (intro && intro.trim()) {
    lines.push('> ' + intro.trim().replace(/\n/g, '\n> '), '');
  }
  drafts.forEach((d, i) => {
    lines.push('---', '');
    lines.push(`## ${i + 1}. ${d.title}`, '');
    if (Array.isArray(d.thread_posts) && d.thread_posts.length) {
      d.thread_posts.forEach((p) => {
        lines.push(`### ${p.label}`, '');
        lines.push('> ' + p.body.replace(/\n/g, '\n> '), '');
      });
    } else if (d.body) {
      lines.push('> ' + d.body.replace(/\n/g, '\n> '), '');
    }
    lines.push(`**Type:** ${d.type}`);
    lines.push(`**Source:** ${d.source}`);
    lines.push(`**Project:** ${d.project}`);
    if (d.gap_addressed) lines.push(`**Gap addressed:** ${d.gap_addressed}`);
    lines.push('');
  });
  return lines.join('\n');
}

async function callDraftAgent({ ctx, date, count, model }) {
  const runDir = path.join(tmpdir(), `x-engine-draft-${randomBytes(4).toString('hex')}`);
  await mkdir(runDir, { recursive: true });
  const resultFile = path.join(runDir, 'result.json');
  if (existsSync(resultFile)) await unlink(resultFile);

  const mcpServers = {
    draft: {
      command: 'node',
      args: [MCP_SERVER_PATH],
      env: { DRAFT_RESULT_FILE: resultFile },
    },
  };

  await runClaude({
    prompt: buildUserPrompt({ date, count }),
    systemPrompt: buildSystemPrompt(ctx),
    model,
    mcpServers,
    maxTurns: MAX_TURNS,
    verbose: true,
  });

  if (!existsSync(resultFile)) {
    throw new Error('model did not call submit_drafts (no result file written)');
  }
  return JSON.parse(await readFile(resultFile, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv);
  const date = args.date || todayIso();
  const file = path.join(DRAFTS_DIR, `${date}.md`);

  if (existsSync(file) && !args.force) {
    console.error(`drafts/${date}.md already exists. Pass --force to overwrite.`);
    process.exit(1);
  }

  const authProbe = await probeClaudeAuth();
  if (!authProbe.ok) throw new Error(`auth check failed: ${authProbe.reason}`);

  const ctx = await loadContext();
  console.log(
    `draft: ${path.relative(ROOT, file)} · projects: ${ctx.projects.length} · sources: ${ctx.sources.length} · archive: ${ctx.archive ? 'present' : 'empty'}`
  );

  const model = process.env.DRAFT_MODEL ?? DEFAULT_MODEL;
  const result = await callDraftAgent({ ctx, date, count: args.count, model });

  // Warn (non-blocking) if any draft body slipped through with em/en dashes
  // or a trailing period. Voice rule bans both as AI tells.
  for (const d of result.drafts) {
    const bodies = d.body ? [d.body] : (d.thread_posts || []).map((p) => p.body);
    for (const b of bodies) {
      const hits = (b.match(/[—–]/g) || []).length;
      if (hits > 0) console.warn(`draft: WARNING #${d.title || ''} contains ${hits} em/en dash(es), voice.md bans these`);
      if (/[.][\s]*$/.test(b)) console.warn(`draft: WARNING #${d.title || ''} ends with a period, voice.md bans trailing periods`);
    }
  }

  await mkdir(DRAFTS_DIR, { recursive: true });
  const content = buildDraftFile({ date, intro: result.intro, drafts: result.drafts });
  await writeFile(file, content);

  console.log(`\ndone. ${result.drafts.length} draft(s) written to ${path.relative(ROOT, file)}`);
}

// Only run main if invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
