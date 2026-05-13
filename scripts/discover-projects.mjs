#!/usr/bin/env node
// Auto-discovers projects from the Obsidian vault and regenerates
// config/projects/<slug>.md files. Opt-in via `x-engine: discoverable`
// frontmatter on the project's primary md file.
//
// Default vault: $OBSIDIAN_VAULT_PATH or ~/Documents/Obsidian Vault.
//
// Flags:
//   --dry-run         report only, don't write or call claude
//   --force           rewrite even if content hash matches
//   --vault=<path>    override vault root
//   --slug=<slug>     limit to a single project (debugging)
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findDiscoverableProjects,
  resolveVaultRoot,
  expandHome,
  existingSourceHash,
  hashContent,
} from './lib/discover-projects-lib.mjs';
import { runClaude, ClaudeAuthError, ClaudeRunError } from './lib/run-claude.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const PROJECTS_OUT = join(REPO_ROOT, 'config', 'projects');
const AUDIT_DIR = join(REPO_ROOT, 'sources', '_audit');
const AUDIT_FILE = join(AUDIT_DIR, 'discover-projects.md');

const args = parseArgs(process.argv.slice(2));
const vaultRoot = args.vault ? expandHome(args.vault) : resolveVaultRoot();
const dryRun = args['dry-run'] === true;
const force = args.force === true;
const onlySlug = args.slug ?? null;

const startedAt = Date.now();
const { projectsDir, projects, skipped = [], error } = await findDiscoverableProjects(vaultRoot);

if (error) {
  console.error(`discover-projects: cannot read ${projectsDir} (${error})`);
  await writeAudit({ vaultRoot, projectsDir, results: [], skipped, error, dryRun, force });
  process.exit(0); // warn-only: don't break sync if vault is missing (CI case)
}

console.log(`discover-projects: scanning ${projectsDir}`);
console.log(`  found ${projects.length} discoverable project(s), skipped ${skipped.length}`);

const targets = onlySlug ? projects.filter((p) => p.slug === onlySlug) : projects;
if (onlySlug && targets.length === 0) {
  console.error(`  no discoverable project with slug "${onlySlug}"`);
  process.exit(1);
}

const results = [];
for (const project of targets) {
  const outPath = join(PROJECTS_OUT, `${project.slug}.md`);
  const sourceHash = hashContent(project.raw);
  let existingHash = null;
  if (existsSync(outPath)) {
    const existing = await readFile(outPath, 'utf8');
    existingHash = existingSourceHash(existing);
  }

  if (!force && existingHash === sourceHash) {
    results.push({ slug: project.slug, status: 'unchanged', detail: `hash ${sourceHash}` });
    continue;
  }

  if (dryRun) {
    results.push({
      slug: project.slug,
      status: 'would-write',
      detail: existingHash ? `hash ${existingHash} → ${sourceHash}` : `new file, hash ${sourceHash}`,
    });
    continue;
  }

  try {
    const distilled = await distill(project);
    const final = appendHashFooter(distilled, sourceHash, project);
    await mkdir(PROJECTS_OUT, { recursive: true });
    await writeFile(outPath, final);
    results.push({
      slug: project.slug,
      status: existingHash ? 'updated' : 'created',
      detail: `hash ${sourceHash}`,
    });
  } catch (err) {
    if (err instanceof ClaudeAuthError) {
      console.error(`  auth error: ${err.message}`);
      results.push({ slug: project.slug, status: 'auth-error', detail: err.message });
      // Stop the loop — every remaining project will hit the same wall.
      break;
    }
    if (err instanceof ClaudeRunError) {
      results.push({ slug: project.slug, status: 'claude-error', detail: err.message });
      continue;
    }
    results.push({ slug: project.slug, status: 'error', detail: err.message });
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\ndiscover-projects: ${results.length} project(s) processed in ${elapsed}s\n`);

if (results.length) {
  const nameWidth = Math.max(8, ...results.map((r) => r.slug.length));
  const statusWidth = Math.max(7, ...results.map((r) => r.status.length));
  const header = `${'slug'.padEnd(nameWidth)}  ${'status'.padEnd(statusWidth)}  detail`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    console.log(`${r.slug.padEnd(nameWidth)}  ${r.status.padEnd(statusWidth)}  ${r.detail}`);
  }
}

await writeAudit({ vaultRoot, projectsDir, results, skipped, dryRun, force });

const errors = results.filter((r) => r.status.endsWith('-error') || r.status === 'error');
if (errors.length) {
  console.error(`\n${errors.length} project(s) failed`);
  if (!process.env.DISCOVER_TOLERATE_ERRORS) {
    process.exit(1);
  }
  console.error('DISCOVER_TOLERATE_ERRORS set — continuing despite errors');
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) {
      out[arg.slice(2)] = true;
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return out;
}

async function distill(project) {
  const truncated = truncate(project.raw, 8000);
  const prompt = [
    `Project folder: ${project.folderName}`,
    `Slug: ${project.slug}`,
    `Frontmatter: ${JSON.stringify(project.frontmatter)}`,
    '',
    'PROJECT SOURCE FILE:',
    '```markdown',
    truncated,
    '```',
    '',
    'Output a config/projects/<slug>.md file matching this exact schema:',
    '',
    '```',
    '# <Project Name>',
    '',
    '- **Repo:** <github url or "none">',
    '- **Live:** <production url, omit line if none>',
    '- **Description:** <one-line pitch>',
    '- **Stack:** <comma list of tools/frameworks>',
    '- **Status:** <active|sketch|launched|validate|parked>',
    '- **Content angles:**',
    '  - <angle 1>',
    '  - <angle 2>',
    '  - ... (5–10 angles, specific, post-shaped)',
    '```',
    '',
    'Rules:',
    '- Each "content angle" must be specific enough to map to ONE concrete X post. Not "AI is interesting" — "the hidden cost of storing image dataUrls in sessionStorage."',
    '- Reuse content angles already present in the source file if available; otherwise infer 5–10 from the project details.',
    '- Status must be one word, lowercase, no qualifiers.',
    '- Output the markdown body only. No code fences, no commentary, no preamble.',
  ].join('\n');

  const { finalText } = await runClaude({
    prompt,
    systemPrompt:
      'You distill Obsidian project notes into x-engine project config files. ' +
      'Output strict markdown matching the requested schema. No preamble, no closing remarks.',
    mcpServers: {},
    maxTurns: 1,
  });

  return finalText.trim();
}

function appendHashFooter(distilled, sourceHash, project) {
  const stamp = new Date().toISOString();
  const footer = [
    '',
    '',
    `<!-- _source_hash: ${sourceHash} -->`,
    `<!-- _source_path: ${relativeToHome(project.primaryFile)} -->`,
    `<!-- _discovered_at: ${stamp} -->`,
    '',
  ].join('\n');
  return distilled.endsWith('\n') ? distilled + footer : distilled + '\n' + footer;
}

function relativeToHome(p) {
  const home = process.env.HOME;
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.75);
  const tail = max - head - 20;
  return `${s.slice(0, head)}\n…[truncated]…\n${s.slice(-tail)}`;
}

async function writeAudit({ vaultRoot, projectsDir, results, skipped, error, dryRun, force }) {
  await mkdir(AUDIT_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const lines = [
    '---',
    `tool: discover-projects`,
    `run_at: ${ts}`,
    `vault: ${relativeToHome(vaultRoot)}`,
    `projects_dir: ${relativeToHome(projectsDir)}`,
    `dry_run: ${dryRun}`,
    `force: ${force}`,
    error ? `error: ${error}` : null,
    '---',
    '',
    '# discover-projects audit',
    '',
    `## Processed (${results.length})`,
    '',
  ].filter((l) => l !== null);

  if (results.length === 0) {
    lines.push('_(none)_', '');
  } else {
    for (const r of results) lines.push(`- ${r.slug} — **${r.status}** — ${r.detail}`);
    lines.push('');
  }

  lines.push(`## Skipped (${skipped.length})`, '');
  if (skipped.length === 0) {
    lines.push('_(none)_', '');
  } else {
    for (const s of skipped) lines.push(`- ${s.folder} — ${s.reason}`);
    lines.push('');
  }

  await writeFile(AUDIT_FILE, lines.join('\n'));
}
