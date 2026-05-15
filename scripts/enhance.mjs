#!/usr/bin/env node
// Autoimprove agent — reads a draft file, for each draft runs a two-pass
// pipeline against the patterns in sources/peer-posts/latest.md and the voice
// in config/voice.md:
//
//   1. WRITER  → produces 3 candidate rewrites (A, B, C) + shared critique.
//                Each variant names its archetype + the mechanic it uses.
//                Newlines are preserved (real tweets use line breaks).
//   2. JUDGE   → ranks {original, A, B, C} pairwise and picks a winner.
//                If no variant beats the original, returns "original" and
//                we ship the draft as-is (beat-original gate).
//
// Powered by `claude -p` headless mode (Pro/Max subscription billing). The
// improve MCP server (mcp-servers/improve/server.mjs) exposes submit_variants
// and submit_verdict; the writer pass and judge pass each spawn their own
// claude -p with their own result file.
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
import { loadArchetypes, selectArchetypesForDraft } from './lib/archetypes.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const VOICE_PATH = path.join(ROOT, 'config/voice.md');
const ARCHETYPES_PATH = path.join(ROOT, 'config/archetypes.md');
const PEER_POSTS_PATH = path.join(ROOT, 'sources/peer-posts/latest.md');
const ARCHIVE_PATH = path.join(ROOT, 'posted/archive.md');
const MCP_SERVER_PATH = path.resolve(here, '..', '..', 'mcp-servers/improve/server.mjs');

const CHAR_LIMIT = 280;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
// Writer needs: think → call submit_variants → end. Judge needs the same.
// 3 turns each, with one retry at the caller layer if the tool wasn't called.
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

const AI_FILLER_PHRASES = [
  "it's worth noting",
  'importantly',
  'in other words',
  'at the end of the day',
  'the reality is',
  'needless to say',
  'interestingly',
  'fundamentally',
  'ultimately',
  'essentially',
  'arguably',
  'in essence',
  'it goes without saying',
  'as a matter of fact',
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
  for (const p of AI_FILLER_PHRASES) {
    if (lower.includes(p)) violations.push(`AI filler: "${p}"`);
  }
  if (/\u2014/.test(body)) violations.push('contains em dash (\u2014)');
  if (/\u2013/.test(body)) violations.push('contains en dash (\u2013)');
  const paragraphs = body.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const trimmed = para.trimEnd();
    if (trimmed.endsWith('.') && !/\.\w/.test(trimmed.slice(-4))) {
      violations.push('trailing period at paragraph end');
      break;
    }
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

function buildContextBlock({ voice, peerPosts, recentPosts, ownTopPerformers }) {
  const recent = recentPosts.length
    ? recentPosts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}${p.length > 200 ? '…' : ''}`).join('\n')
    : '(no recent posts in archive)';

  // Full body (no 240-char truncation) so the model can see the line-break
  // structure that made these posts work. Normalize triple+ newlines to
  // doubles so a single fenced block stays compact.
  const ownTop = ownTopPerformers.length
    ? ownTopPerformers.map((p, i) => {
        const m = p.metrics;
        const stats = `likes=${m.likes ?? '—'} replies=${m.replies ?? '—'} reposts=${m.reposts ?? '—'}${m.bookmarks != null ? ` bookmarks=${m.bookmarks}` : ''}`;
        const body = p.body.replace(/\n{3,}/g, '\n\n');
        return `${i + 1}. (${p.date} · ${stats})\n\`\`\`\n${body}\n\`\`\``;
      }).join('\n\n')
    : '_(no engagement data yet — feedback loop will populate this once posts have aged 24h+)_';

  return `# Voice (user's tone, audience, banned phrases)

${voice.trim()}

# Peer engagement patterns (this week)

${peerPosts.trim() || '_(no peer-posts data yet — score against voice + general principles)_'}

# User's own top-performing posts (full body, line breaks preserved)

These are the user's posts with the highest engagement to date. Mirror what's
working for THEIR audience — hook, structure, line-break placement, specificity.
Peer patterns are a secondary signal.

${ownTop}

# Posts the user already published in the last 7 days

${recent}`;
}

function formatArchetypeForPrompt(arch) {
  const exemplars = arch.exemplars.length
    ? arch.exemplars.map(e => `  - ${e}`).join('\n')
    : '  - (no curated exemplars yet)';
  return `## ${arch.name}
**Mechanic:** ${arch.mechanic}
**Structure template:**
\`\`\`
${arch.structure}
\`\`\`
**Exemplars:**
${exemplars}`;
}

function buildWriterSystem(contextBlock, archetypes) {
  const archetypeBlock = archetypes.map(formatArchetypeForPrompt).join('\n\n');
  const archetypeNames = archetypes.map(a => `"${a.name}"`).join(', ');

  return `You are a tweet-rewrite agent for an X content engine.

For the draft you're given, write THREE candidate rewrites (labeled A, B, C),
each instantiating a DIFFERENT archetype from the bank below, plus a shared
critique of the original.

# Output protocol
Call mcp__improve__submit_variants EXACTLY ONCE with the structured payload.
Do not call any other tool. Do not output additional text after the tool call.

${contextBlock}

# Archetype bank (retrieved for this draft's type)

You MUST use these archetypes — one per variant. The "archetype" field in
each variant must exactly match one of: ${archetypeNames}. Do not invent
archetype names; do not stamp the surface form without honoring the mechanic.

${archetypeBlock}

# Hard rules (apply to every variant)
- ≤ ${CHAR_LIMIT} chars total, INCLUDING newlines (each \\n counts as 1 char).
- No banned phrase from the voice file.
- Specific technical detail (number, name, mechanism) — unless original is a
  pure engagement/question post, then a sharp question is ok.
- 0 or 1 hashtag max. No external links unless the original explicitly needs one.
- Voice match: lowercase starts ok, fragments ok, terse, no hype. Respect the
  voice file's punctuation rules (no em/en dashes, no trailing periods at
  paragraph end, arrows/colons/newlines as connectors).

# Formatting — line breaks are part of the post
Every high-engagement reference post in the context uses line breaks
deliberately. Real tweets are NOT walls of text. Use them:
- Hook on its own line (often a fragment, ≤ ~60 chars). Blank line below.
- Body in 1-3 short paragraphs separated by blank lines.
- Numbered lists, pipeline arrows, and cause/fix labels each go on their own
  line when present.
The "text" field in each variant MUST preserve real \\n characters where the
post needs a line break. Do NOT collapse to one line.

# Variant differentiation
Each of A/B/C must instantiate a DIFFERENT archetype from the bank. In the
"mechanic" field of each variant, restate in one sentence WHY that archetype's
lever fits THIS draft (the bank's mechanic is generic; yours must be
draft-specific). Mechanic-aware transfer, not template stamping.

# Scoring rubric (each 1-5, per variant)
- specificity: concrete number/name/mechanism vs vague claim
- hook: does line 1 grab a scroller?
- length: every word earning its place at the chosen length
- pattern_match: does it execute the archetype's structure faithfully?
- reply_potential: would a reader feel compelled to reply, quote, or debate this?

# Critique style
2-3 sentences max. Be direct. Name the failure mode the rewrites address.`;
}

function buildWriterUserPrompt(draft, ruleViolations) {
  const projectLine = draft.project ? `Project: ${draft.project}` : 'Project: general';
  const ruleBlock = ruleViolations.length
    ? `Deterministic rule violations to fix:\n${ruleViolations.map((v) => '- ' + v).join('\n')}`
    : 'Deterministic rule check: clean.';
  return `${projectLine}
Title: ${draft.title}
Body (${draft.body.length} chars):
\`\`\`
${draft.body}
\`\`\`

${ruleBlock}

Produce critique + 3 variants via submit_variants.`;
}

function buildJudgeSystem(contextBlock) {
  return `You are a tweet-ranking judge for an X content engine.

You will be given an original draft and 3 candidate rewrites (A, B, C).
Rank all four (original + A + B + C) best-first by likely engagement on a
developer/indie-hacker timeline, using the user's voice and the engagement
patterns in this context. Pick a winner.

# Output protocol
Call mcp__improve__submit_verdict EXACTLY ONCE with ranking, winner, and
reasoning. Do not call any other tool. End your turn.

${contextBlock}

# Judging principles
- Pairwise compare hook strength FIRST. A weak line-1 is a dead post regardless
  of body quality.
- Specificity beats vibes. A named tool / number / mechanism wins over a
  generic claim every time.
- Line-break execution matters: a multi-paragraph layout with a tight hook
  beats the same content as a wall of text.
- Variant differentiation is a bonus, not a tiebreaker. If two variants land
  the same lever and one does it better, the better one wins.
- BEAT-ORIGINAL GATE: if no variant meaningfully beats the original on these
  criteria, return winner="original". The user prefers shipping the original
  over a refine-for-refining's-sake rewrite.

# Reasoning style
1-2 sentences. Name the lever the winner pulls (or, for "original", why the
candidates failed to beat it).`;
}

function buildJudgeUserPrompt(draft, variants) {
  const variantBlock = variants.map((v) => {
    return `[${v.label}] archetype: ${v.archetype}
mechanic: ${v.mechanic}
text (${v.text.length} chars):
\`\`\`
${v.text}
\`\`\``;
  }).join('\n\n');
  return `Project: ${draft.project || 'general'}
Title: ${draft.title}

[original] (${draft.body.length} chars):
\`\`\`
${draft.body}
\`\`\`

${variantBlock}

Rank all four and pick a winner via submit_verdict.`;
}

function buildHumanizerSystem(voice, ownTopPerformers) {
  const samples = ownTopPerformers.length
    ? ownTopPerformers.map((p, i) => {
        const body = p.body.replace(/\n{3,}/g, '\n\n');
        return `${i + 1}.\n\`\`\`\n${body}\n\`\`\``;
      }).join('\n\n')
    : '_(no samples available — use voice rules only)_';

  return `You are a humanizer agent. Your ONLY job: take the input text and rewrite
it to sound like the real human whose voice samples are below. You are subtracting
artificiality, not adding creativity.

# Output protocol
Call mcp__improve__submit_humanized EXACTLY ONCE with the rewritten text.
Do not call any other tool. Do not output additional text after the tool call.

# Voice rules (hard constraints)

${voice.trim()}

# The user's REAL posts (voice calibration — match THIS exactly)

${samples}

# AI patterns to strip (if present in input)
- Em dashes or en dashes used as rhetorical connectors
- Trailing periods at paragraph/post end
- Hedging: "it's worth noting", "importantly", "essentially", "fundamentally",
  "arguably", "ultimately", "interestingly", "in other words", "needless to say"
- Balanced parallel sentence pairs ("X does Y. Z does W.")
- Over-qualified claims ("while not perfect, it significantly improves...")
- Setup-and-reveal structure ("the result? something something")
- Overly smooth transitions between ideas
- Generic filler that adds no information
- Any phrase from the banned list in the voice file

# Hard constraints
- Output must be ≤ 280 chars (including newlines, each \\n = 1 char)
- Preserve the core meaning and technical detail of the input
- Do NOT add new information, metaphors, or rhetorical questions
- Do NOT use em dashes (—) or en dashes (–)
- Do NOT end any paragraph or the post with a period
- Match the sentence length, punctuation style, and word choice level of the
  voice samples above
- If the input already sounds human and matches the samples, return it unchanged`;
}

async function runMcpCall({ prompt, system, model, resultFile, role }) {
  if (existsSync(resultFile)) await unlink(resultFile);

  const mcpServers = {
    improve: {
      command: 'node',
      args: [MCP_SERVER_PATH],
      env: { IMPROVE_RESULT_FILE: resultFile },
    },
  };

  const attempts = [
    prompt,
    prompt + `\n\nREQUIRED: respond by calling the appropriate mcp__improve__* tool exactly once. No prose. No other tools.`,
  ];

  for (const attempt of attempts) {
    await runClaude({
      prompt: attempt,
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
  throw new Error(`${role} did not emit a result after retry`);
}

function formatScore(s) {
  return `specificity ${s.specificity}/5 · hook ${s.hook}/5 · length ${s.length}/5 · pattern ${s.pattern_match}/5 · reply ${s.reply_potential}/5`;
}

function compactPreview(text, max = 64) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function formatVariantsSummary(variants, winnerLabel) {
  return variants.map((v) => {
    const marker = v.label === winnerLabel ? '★' : ' ';
    const score = `spec ${v.score.specificity} · hook ${v.score.hook} · len ${v.score.length} · pat ${v.score.pattern_match}`;
    return `${marker} ${v.label} (${v.archetype}) — ${score} — ${compactPreview(v.text)}`;
  }).join('\n');
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
  const archetypes = await loadArchetypes(ARCHETYPES_PATH);
  if (!archetypes.length) {
    throw new Error(`no archetypes loaded from ${ARCHETYPES_PATH} — bank is empty`);
  }

  const authProbe = await probeClaudeAuth();
  if (!authProbe.ok) throw new Error(`auth check failed: ${authProbe.reason}`);

  const model = process.env.IMPROVE_MODEL ?? DEFAULT_MODEL;
  const contextBlock = buildContextBlock({ voice, peerPosts, recentPosts, ownTopPerformers });
  const judgeSystem = buildJudgeSystem(contextBlock);

  console.log(`model: ${model} · ${candidates.length} draft(s) · peer-posts: ${peerPosts ? 'loaded' : 'missing'} · own top: ${ownTopPerformers.length} · archetypes: ${archetypes.length}\n`);

  const runDir = path.join(tmpdir(), `x-engine-improve-${randomBytes(4).toString('hex')}`);
  await mkdir(runDir, { recursive: true });

  for (const d of candidates) {
    const violations = runRules(d.body);
    if (violations.length) console.log(`  #${d.index}: rule check — ${violations.length} violation(s)`);

    // Retrieve archetype bank entries that fit this draft's type. The
    // writer prompt is per-draft so different draft types pull different
    // archetypes (e.g. trending-reaction → outlier-data; technical-tip →
    // cause/fix + I-just-replaced-X-with-Y + numbered-gotchas).
    const selectedArchetypes = selectArchetypesForDraft(archetypes, d.type, 3);
    const writerSystem = buildWriterSystem(contextBlock, selectedArchetypes);
    console.log(`  #${d.index}: archetypes → ${selectedArchetypes.map(a => a.name).join(', ')}`);

    // Pass 1: writer produces 3 variants + shared critique.
    let writerEntry;
    try {
      writerEntry = await runMcpCall({
        prompt: buildWriterUserPrompt(d, violations),
        system: writerSystem,
        model,
        resultFile: path.join(runDir, `draft-${d.index}-variants.json`),
        role: 'writer',
      });
    } catch (err) {
      console.error(`  #${d.index}: WRITER ERROR ${err.message}`);
      continue;
    }
    const { critique, variants } = writerEntry;

    // Hard-gate: reject variants that fail deterministic rules.
    const variantIssues = variants.map((v) => ({ label: v.label, issues: runRules(v.text) }));
    const dirty = variantIssues.filter((vi) => vi.issues.length);
    const dirtyLabels = new Set(dirty.map((vi) => vi.label));
    if (dirty.length) {
      for (const { label, issues } of dirty) {
        console.warn(`  #${d.index}: variant ${label} REJECTED — ${issues.join('; ')}`);
      }
    }
    const cleanVariants = variants.filter((v) => !dirtyLabels.has(v.label));
    if (!cleanVariants.length) {
      console.log(`  #${d.index}: all variants rejected by rules — beat-original gate (forced)`);
      const updates = {
        Critique: critique.replace(/\n+/g, ' ').trim(),
        Variants: formatVariantsSummary(variants, 'original'),
        Winner: 'original',
        Verdict: 'all variants failed deterministic rule checks',
        Ranking: 'original > ' + variants.map((v) => v.label).join(' > '),
      };
      await stampDraft({ filePath: file, draftIndex: d.index, updates });
      continue;
    }

    // Soft check: warn when a variant's archetype isn't one of the retrieved
    // bank names. The prompt instructs the writer to pick from the list, but
    // the MCP schema accepts any string — drift here means the writer is
    // inventing rather than instantiating.
    const allowedArchetypes = new Set(selectedArchetypes.map((a) => a.name));
    for (const v of cleanVariants) {
      if (!allowedArchetypes.has(v.archetype)) {
        console.warn(`  #${d.index}: variant ${v.label} used archetype "${v.archetype}" not in retrieved bank {${[...allowedArchetypes].join(', ')}}`);
      }
    }

    // Pass 2: judge ranks {original, A, B, C} and picks winner.
    // All variants are shown to preserve the fixed MCP schema, but if the
    // judge picks a dirty variant we override to original below.
    let judgeEntry;
    try {
      judgeEntry = await runMcpCall({
        prompt: buildJudgeUserPrompt(d, variants),
        system: judgeSystem,
        model,
        resultFile: path.join(runDir, `draft-${d.index}-verdict.json`),
        role: 'judge',
      });
    } catch (err) {
      console.error(`  #${d.index}: JUDGE ERROR ${err.message}`);
      continue;
    }
    let { winner, ranking, reasoning } = judgeEntry;

    // Hard-gate enforcement: if the judge picked a dirty variant, override.
    if (winner !== 'original' && dirtyLabels.has(winner)) {
      console.warn(`  #${d.index}: judge picked rejected variant ${winner} — overriding to original`);
      winner = 'original';
      reasoning = `judge picked ${judgeEntry.winner} but it failed rule checks; falling back to original`;
    }

    const winnerVariant = winner === 'original' ? null : variants.find((v) => v.label === winner);
    if (winner !== 'original' && !winnerVariant) {
      console.error(`  #${d.index}: judge picked unknown label "${winner}", skipping stamp`);
      continue;
    }

    // Score comes from the writer's per-variant score, not the judge — the
    // first live run showed the judge inflates winner_score to 5/5/5/5 even
    // when writer scores show real 3-5 variance. When winner=original we
    // have no per-variant score, so skip the Score stamp entirely.

    // Pass 3: humanizer — only runs when a variant won (not "original").
    // Rewrites the winner to match the user's real voice, stripping AI tells.
    let humanizedText = null;
    let humanizedChanges = null;
    if (winnerVariant) {
      try {
        const humanizerSystem = buildHumanizerSystem(voice, ownTopPerformers);
        const humanizerPrompt = `Rewrite this text to match my voice exactly. Strip AI patterns. Keep meaning and technical detail.\n\nInput (${winnerVariant.text.length} chars):\n\`\`\`\n${winnerVariant.text}\n\`\`\`\n\nCall submit_humanized with the result.`;
        const humanizerEntry = await runMcpCall({
          prompt: humanizerPrompt,
          system: humanizerSystem,
          model,
          resultFile: path.join(runDir, `draft-${d.index}-humanized.json`),
          role: 'humanizer',
        });
        const hIssues = runRules(humanizerEntry.text);
        if (hIssues.length) {
          console.warn(`  #${d.index}: humanizer output failed rules (${hIssues.join('; ')}) — using pre-humanized variant`);
        } else {
          humanizedText = humanizerEntry.text;
          humanizedChanges = humanizerEntry.changes_made;
        }
      } catch (err) {
        console.warn(`  #${d.index}: HUMANIZER ERROR ${err.message} — using pre-humanized variant`);
      }
    }

    const updates = {
      Critique: critique.replace(/\n+/g, ' ').trim(),
      Variants: formatVariantsSummary(variants, winner),
      Winner: winner,
      Verdict: reasoning.replace(/\n+/g, ' ').trim(),
      Ranking: ranking.join(' > '),
    };
    if (winnerVariant) {
      updates.Score = formatScore(winnerVariant.score);
      updates.Refined = humanizedText ?? winnerVariant.text;
      if (humanizedText) updates.Humanized = 'yes';
      const refinedIssues = runRules(updates.Refined);
      if (refinedIssues.length) updates.RefinedIssues = refinedIssues.join('; ');
    }

    await stampDraft({ filePath: file, draftIndex: d.index, updates });
    const scoreSummary = winnerVariant ? ` · ${formatScore(winnerVariant.score)}` : '';
    console.log(`  #${d.index}: winner=${winner}${scoreSummary}`);
    console.log(`     ${reasoning.slice(0, 100)}${reasoning.length > 100 ? '…' : ''}`);
    if (winnerVariant) {
      const refinedSource = humanizedText ? 'humanized' : 'variant';
      const finalText = humanizedText ?? winnerVariant.text;
      console.log(`     refined [${refinedSource}] (${finalText.length}c, ${winnerVariant.archetype}): ${compactPreview(finalText, 80)}`);
      if (humanizedChanges) console.log(`     humanizer: ${humanizedChanges}`);
    } else {
      console.log(`     [beat-original gate] keeping original — no variant beat it`);
    }
  }

  console.log(`\ndone. ${candidates.length} draft(s) enhanced.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
