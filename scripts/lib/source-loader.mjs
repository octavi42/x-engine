import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCES_DIR = resolve(here, '../../sources');

export async function listSources() {
  const entries = await readdir(SOURCES_DIR, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = join(SOURCES_DIR, entry.name, 'source.config.json');
    let raw;
    try {
      raw = await readFile(configPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    const config = JSON.parse(raw);
    sources.push({ ...config, dir: join(SOURCES_DIR, entry.name) });
  }
  sources.sort((a, b) => a.name.localeCompare(b.name));
  return sources;
}

function formatFrontmatterValue(v) {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function formatLatest(source, { items, meta = {} }) {
  const fetchedAt = new Date().toISOString();
  const lines = [
    '---',
    `source: ${source.name}`,
    `type: ${source.type}`,
    source.description ? `description: ${source.description}` : null,
    `fetched_at: ${fetchedAt}`,
    `item_count: ${items.length}`,
    ...Object.entries(meta).map(([k, v]) => `${k}: ${formatFrontmatterValue(v)}`),
    '---',
    '',
  ].filter((l) => l !== null);

  const body = items.map((item) => {
    const parts = [`## ${item.title}`];
    const tagLine = [
      item.tags?.length ? `tags: ${item.tags.join(', ')}` : null,
      item.url ? `link: ${item.url}` : null,
    ].filter(Boolean).join(' · ');
    if (tagLine) parts.push(`_${tagLine}_`);
    parts.push('', item.body.trim(), '');
    return parts.join('\n');
  }).join('\n');

  return lines.join('\n') + body;
}

export async function writeLatest(source, payload) {
  const path = join(source.dir, 'latest.md');
  await writeFile(path, formatLatest(source, payload));
  return path;
}
