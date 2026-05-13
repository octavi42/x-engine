import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const TRUTHY = new Set(['true', 'yes', 'discoverable', 'on', '1']);
const SOURCE_HASH_RE = /<!--\s*_source_hash:\s*([a-f0-9]+)\s*-->/;

export function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export function resolveVaultRoot(env = process.env) {
  const explicit = env.OBSIDIAN_VAULT_PATH;
  if (explicit) return expandHome(explicit);
  return join(homedir(), 'Documents', 'Obsidian Vault');
}

export function projectsDir(vaultRoot) {
  return join(vaultRoot, '1-Projects');
}

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Parses a minimal YAML-ish frontmatter (key: value lines). No nested objects.
// Booleans are coerced; everything else stays string. Returns { frontmatter, body }.
export function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content };
  const fmBlock = match[1];
  const body = match[2];
  const fm = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[key.toLowerCase()] = value;
  }
  return { frontmatter: fm, body };
}

export function isDiscoverable(frontmatter) {
  const v = frontmatter['x-engine'];
  if (!v) return false;
  return TRUTHY.has(String(v).toLowerCase());
}

export function existingSourceHash(content) {
  const m = content?.match(SOURCE_HASH_RE);
  return m ? m[1] : null;
}

export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// Heuristic for the primary file in a project folder:
//   1. README.md (case-insensitive)
//   2. <Folder-Name>.md or <folder-name>.md (title-cased match — e.g., clio/Clio.md)
//   3. The largest .md file in the folder
// Returns absolute path or null if no .md files.
export async function findPrimaryFile(folderPath) {
  let entries;
  try {
    entries = await readdir(folderPath);
  } catch {
    return null;
  }
  const mdFiles = entries.filter((f) => extname(f).toLowerCase() === '.md');
  if (mdFiles.length === 0) return null;

  const readme = mdFiles.find((f) => f.toLowerCase() === 'readme.md');
  if (readme) return join(folderPath, readme);

  const folderName = basename(folderPath);
  const folderMatch = mdFiles.find(
    (f) => basename(f, '.md').toLowerCase() === folderName.toLowerCase()
  );
  if (folderMatch) return join(folderPath, folderMatch);

  // Fallback: largest .md
  let biggest = null;
  let biggestSize = -1;
  for (const f of mdFiles) {
    const p = join(folderPath, f);
    try {
      const s = await stat(p);
      if (s.size > biggestSize) {
        biggest = p;
        biggestSize = s.size;
      }
    } catch {}
  }
  return biggest;
}

// Returns array of { slug, folder, primaryFile, frontmatter, body } for every
// subdirectory of the projects dir whose primary file is marked discoverable.
// Loose .md files at the projects-dir root are ignored (one-shot ideas, not projects).
export async function findDiscoverableProjects(vaultRoot) {
  const pdir = projectsDir(vaultRoot);
  if (!existsSync(pdir)) {
    return { vaultRoot, projectsDir: pdir, projects: [], error: 'projects-dir-missing' };
  }
  let entries;
  try {
    entries = await readdir(pdir, { withFileTypes: true });
  } catch (err) {
    return { vaultRoot, projectsDir: pdir, projects: [], error: err.message };
  }

  const projects = [];
  const skipped = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const folder = join(pdir, entry.name);
    const primary = await findPrimaryFile(folder);
    if (!primary) {
      skipped.push({ folder: entry.name, reason: 'no-md-file' });
      continue;
    }
    let raw;
    try {
      raw = await readFile(primary, 'utf8');
    } catch (err) {
      skipped.push({ folder: entry.name, reason: `read-error: ${err.message}` });
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!isDiscoverable(frontmatter)) {
      skipped.push({ folder: entry.name, reason: 'no-discoverable-flag' });
      continue;
    }
    projects.push({
      slug: slugify(entry.name),
      folder,
      folderName: entry.name,
      primaryFile: primary,
      frontmatter,
      body,
      raw,
    });
  }

  return { vaultRoot, projectsDir: pdir, projects, skipped };
}
