import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function fetch(source) {
  const {
    vaultPath,
    dailyNotesDir = 'Daily Notes',
    sinceDays = 7,
    sections = ['Build Log', 'Ideas'],
  } = source.params ?? {};

  if (!vaultPath) throw new Error('params.vaultPath is required');

  const dailyDir = join(vaultPath, dailyNotesDir);
  let dirStat;
  try {
    dirStat = await stat(dailyDir);
  } catch (err) {
    if (err.code === 'ENOENT') return { items: [], meta: { vault: vaultPath, note: 'vault not found' } };
    throw err;
  }
  if (!dirStat.isDirectory()) {
    return { items: [], meta: { vault: vaultPath, note: 'daily notes path is not a directory' } };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sinceDays);
  cutoff.setHours(0, 0, 0, 0);

  const files = (await readdir(dailyDir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse();

  const items = [];
  for (const file of files) {
    const dateStr = file.replace('.md', '');
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime()) || date < cutoff) continue;

    const text = await readFile(join(dailyDir, file), 'utf8');
    for (const heading of sections) {
      const body = extractSection(text, heading);
      if (!body || !body.trim()) continue;
      items.push({
        title: `${heading} — ${dateStr}`,
        body: body.trim(),
        tags: [heading.toLowerCase().replace(/\s+/g, '-'), dateStr],
      });
    }
  }

  return { items, meta: { vault: vaultPath, since_days: sinceDays } };
}

function extractSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)#+\\s*${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n#+\\s|$)`, 'i');
  return text.match(re)?.[1] ?? null;
}
