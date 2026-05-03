import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function fetch(source) {
  const itemsDir = join(here, source.params?.itemsDir ?? 'items');
  const files = (await readdir(itemsDir))
    .filter((f) => extname(f) === '.md')
    .sort();

  const items = [];
  for (const file of files) {
    const project = basename(file, '.md');
    const text = (await readFile(join(itemsDir, file), 'utf8')).trim();
    if (!hasContent(text)) continue;
    items.push({
      title: project,
      body: text,
      tags: [project],
    });
  }

  return { items, meta: { items_dir: itemsDir } };
}

function hasContent(text) {
  const stripped = text
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#') && line.trim() !== '---')
    .join('\n')
    .trim();
  return stripped.length > 0;
}
