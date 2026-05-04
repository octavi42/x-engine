// Auto-updates the "Top performing" block inside sources/x-profile/latest.md.
//
// We don't rewrite the whole file — that section is otherwise hand-edited
// during the morning profile-sync phase. Instead we own a single block
// delimited by HTML comment markers; everything outside the markers is
// preserved verbatim.
//
//   ## Top performing
//   <!-- auto-feedback:start -->
//   ...generated content...
//   <!-- auto-feedback:end -->
//
// On first run the block doesn't exist and we insert it directly under the
// `## Top performing` heading (replacing whatever's currently there until
// the next `## ` heading). On subsequent runs we just rewrite between the
// markers.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

const START = '<!-- auto-feedback:start -->';
const END = '<!-- auto-feedback:end -->';
const HEADING_RE = /^##\s+Top performing\s*$/m;

export function renderTopPerformersBlock(performers, { now = new Date() } = {}) {
  const stamp = now.toISOString().slice(0, 10);
  if (!performers.length) {
    return `${START}\n_No engagement data yet — run \`npm run feedback\` after posts have aged 24h._\nGenerated ${stamp}.\n${END}`;
  }
  const items = performers.map((p, idx) => {
    const m = p.metrics;
    const parts = [
      `Likes ${m.likes ?? '—'}`,
      `Replies ${m.replies ?? '—'}`,
      `Reposts ${m.reposts ?? '—'}`,
    ];
    if (m.bookmarks != null) parts.push(`Bookmarks ${m.bookmarks}`);
    if (m.views != null) parts.push(`Views ${m.views}`);
    const meta = parts.join(' · ');
    const bodySnippet = (p.body || '').replace(/\s+/g, ' ').trim();
    const trim = bodySnippet.length > 240 ? bodySnippet.slice(0, 237) + '…' : bodySnippet;
    return `${idx + 1}. **${p.date}** · score ${p.score.toFixed(1)} · ${meta}\n   > ${trim}\n   - ${p.url}\n   - Project: ${p.project}${p.variant ? ` · Variant: ${p.variant}` : ''}`;
  }).join('\n\n');
  return `${START}\nGenerated ${stamp} — top ${performers.length} by engagement score (likes + 2·replies + 3·bookmarks + 1.5·reposts).\n\n${items}\n${END}`;
}

export function spliceTopPerformers(profileText, block) {
  const startIdx = profileText.indexOf(START);
  const endIdx = profileText.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = profileText.slice(0, startIdx);
    const after = profileText.slice(endIdx + END.length);
    return before + block + after;
  }

  const headingMatch = HEADING_RE.exec(profileText);
  if (!headingMatch) {
    // No heading either — append to the end of the file with a heading.
    const sep = profileText.endsWith('\n') ? '' : '\n';
    return `${profileText}${sep}\n## Top performing\n${block}\n`;
  }
  const headingEnd = headingMatch.index + headingMatch[0].length;
  // Replace from after the heading until the next `## ` heading (or EOF).
  const tail = profileText.slice(headingEnd);
  const nextHeading = tail.search(/\n##\s/);
  const cutEnd = nextHeading === -1 ? profileText.length : headingEnd + nextHeading;
  const before = profileText.slice(0, headingEnd);
  const after = profileText.slice(cutEnd);
  return `${before}\n${block}\n${after}`;
}

export async function updateProfileTopPerformers(profilePath, performers, opts = {}) {
  if (!existsSync(profilePath)) return false;
  const text = await readFile(profilePath, 'utf8');
  const block = renderTopPerformersBlock(performers, opts);
  const next = spliceTopPerformers(text, block);
  if (next === text) return false;
  await writeFile(profilePath, next);
  return true;
}
