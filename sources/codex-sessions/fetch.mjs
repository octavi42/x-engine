import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { runClaude, ClaudeAuthError, ClaudeRunError } from '../../scripts/lib/run-claude.mjs';

const REPO_RE = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?(?=[\s)\/]|$)/;
const ROLLOUT_RE = /^rollout-(\d{4}-\d{2}-\d{2})-([a-f0-9-]+)\.json$/;

export async function fetch(source) {
  const {
    sessionsDir = '~/.codex/sessions',
    sinceDays = 7,
    maxSessions = 30,
    projectFilter = true,
    model,
    minUserChars = 40,
  } = source.params ?? {};

  const repoRoot = resolve(source.dir, '..', '..');
  const absSessionsDir = expandHome(sessionsDir);
  const cacheDir = join(source.dir, '.cache');

  if (!existsSync(absSessionsDir)) {
    return { items: [], meta: { sessions_dir: absSessionsDir, note: 'sessions dir not found' } };
  }

  const projectNames = projectFilter ? await discoverProjectSlugs(join(repoRoot, 'config/projects')) : null;

  const cutoff = startOfDay(daysAgo(sinceDays));
  const candidates = (await readdir(absSessionsDir))
    .map((file) => {
      const m = file.match(ROLLOUT_RE);
      if (!m) return null;
      const date = new Date(m[1]);
      if (Number.isNaN(date.getTime()) || date < cutoff) return null;
      return { file, date: m[1], id: m[2] };
    })
    .filter(Boolean)
    .sort((a, b) => b.file.localeCompare(a.file));

  await mkdir(cacheDir, { recursive: true });

  const items = [];
  let scanned = 0;
  let skippedShort = 0;
  let skippedOffProject = 0;
  let cacheHits = 0;
  let summarized = 0;
  let summaryErrors = 0;
  let authSkipped = false;

  for (const cand of candidates) {
    if (items.length >= maxSessions) break;
    scanned += 1;

    let extracted;
    try {
      extracted = await extractSession(join(absSessionsDir, cand.file));
    } catch {
      continue;
    }

    if (!extracted.userText || extracted.userText.length < minUserChars) {
      skippedShort += 1;
      continue;
    }

    const projectTag = projectNames ? matchProject(extracted.workdir, projectNames) : extracted.workdir ? basename(extracted.workdir) : 'general';
    if (projectFilter && !projectTag) {
      skippedOffProject += 1;
      continue;
    }

    const cachePath = join(cacheDir, `${cand.id}.md`);
    let summary;
    if (existsSync(cachePath)) {
      summary = (await readFile(cachePath, 'utf8')).trim();
      cacheHits += 1;
    } else if (authSkipped) {
      continue;
    } else {
      try {
        summary = await summarize(extracted, { model, projectTag });
        await writeFile(cachePath, summary + '\n');
        summarized += 1;
      } catch (err) {
        if (err instanceof ClaudeAuthError) {
          authSkipped = true;
          continue;
        }
        if (err instanceof ClaudeRunError) {
          summaryErrors += 1;
          continue;
        }
        throw err;
      }
    }

    if (!summary) continue;

    items.push({
      title: `${projectTag} — ${cand.date} (${cand.id.slice(0, 8)})`,
      body: summary,
      tags: [projectTag, cand.date].filter(Boolean),
    });
  }

  const meta = {
    sessions_dir: absSessionsDir,
    since_days: sinceDays,
    candidates_in_window: candidates.length,
    scanned,
    summarized,
    cache_hits: cacheHits,
    skipped_short: skippedShort,
  };
  if (projectFilter) meta.skipped_off_project = skippedOffProject;
  if (summaryErrors) meta.summary_errors = summaryErrors;
  if (authSkipped) meta.note = 'CLAUDE_CODE_OAUTH_TOKEN not set — uncached sessions skipped';

  return { items, meta };
}

function expandHome(p) {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(p);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function discoverProjectSlugs(projectsDir) {
  if (!existsSync(projectsDir)) return new Set();
  const files = (await readdir(projectsDir)).filter((f) => extname(f) === '.md');
  const slugs = new Set();
  for (const file of files) {
    slugs.add(basename(file, '.md').toLowerCase());
    const text = await readFile(join(projectsDir, file), 'utf8');
    const match = text.match(REPO_RE);
    if (match) slugs.add(match[1].toLowerCase());
  }
  return slugs;
}

function matchProject(workdir, slugs) {
  if (!workdir) return null;
  const segments = workdir.toLowerCase().split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (slugs.has(segments[i])) return segments[i];
  }
  return null;
}

async function extractSession(path) {
  const raw = await readFile(path, 'utf8');
  const json = JSON.parse(raw);
  const items = Array.isArray(json.items) ? json.items : [];

  const userMessages = [];
  let lastAssistantText = '';
  let workdir = null;

  for (const item of items) {
    if (item.role === 'user' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'input_text' && typeof c.text === 'string') userMessages.push(c.text);
      }
    }
    if (item.role === 'assistant' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') {
          lastAssistantText = c.text;
        }
      }
    }
    if (!workdir && item.type === 'function_call' && typeof item.arguments === 'string') {
      try {
        const args = JSON.parse(item.arguments);
        if (typeof args.workdir === 'string') workdir = args.workdir;
      } catch {}
    }
  }

  return {
    userText: userMessages.join('\n\n').trim(),
    finalAssistant: lastAssistantText.trim(),
    workdir,
  };
}

async function summarize(extracted, { model, projectTag }) {
  const userBlock = truncate(extracted.userText, 6_000);
  const assistantBlock = truncate(extracted.finalAssistant, 2_000);
  const wd = extracted.workdir ?? '(unknown)';

  const prompt = [
    `Project tag: ${projectTag ?? 'unknown'}`,
    `Workdir: ${wd}`,
    '',
    'USER PROMPTS (chronological):',
    userBlock,
    '',
    'FINAL ASSISTANT MESSAGE:',
    assistantBlock || '(none)',
    '',
    'Summarize this Codex coding session in 2-3 short bullets. Focus on:',
    '- what the user was trying to build/fix',
    '- the concrete output/decision (file changed, bug found, approach picked)',
    'Skip filler. No preamble. No closing line. Just the bullets.',
  ].join('\n');

  const { finalText } = await runClaude({
    prompt,
    systemPrompt:
      'You produce ultra-terse build-log entries from coding session transcripts. ' +
      'Output 2-3 markdown bullets only — no headings, no preamble, no apologies.',
    model,
    mcpServers: {},
    maxTurns: 1,
  });

  return finalText.trim();
}

function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.75);
  const tail = max - head - 20;
  return `${s.slice(0, head)}\n…[truncated]…\n${s.slice(-tail)}`;
}
