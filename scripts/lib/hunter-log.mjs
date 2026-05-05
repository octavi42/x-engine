// Append-only markdown log of every (non-dry) hunt run. Captures both
// notified winners and rejected top-scored candidates per run, so we can
// review the funnel by hand and feed it into prompt/threshold tuning.
//
// Format: one `## YYYY-MM-DD HH:MM UTC` section per run, oldest at top
// (matches posted/archive.md convention). Grow until ~10MB then rotate
// manually to log-YYYY-MM.md if it gets unwieldy.

import { appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const LOG_HEADER = `# Comment-hunter run log

Append-only record of every hunt run (non-dry). Each section logs the
funnel — what was searched, scored, notified, and rejected. Rejection
reasons are captured so threshold tuning is data-driven.

---

`;

function trimText(s, max = 280) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fmtTimestamp(d = new Date()) {
  // YYYY-MM-DD HH:MM UTC, stable + searchable
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function fmtNotified({ tweet, score, suggestion, matchedQuery }) {
  const handle = tweet.handle ? `@${tweet.handle}` : 'unknown';
  const ratio = score.authorSampleSize > 0 ? `${Math.min(score.score, 999).toFixed(1)}×` : 'cold';
  return [
    `- **${handle}** · ${ratio} · ${score.reasons.join(' · ')}`,
    `  - URL: ${tweet.url ?? `https://x.com/i/web/status/${tweet.id}`}`,
    `  - Tweet: ${trimText(tweet.text, 400)}`,
    `  - Suggestion: ${trimText(suggestion?.comment, 280)}`,
    `  - Reasoning: ${trimText(suggestion?.reasoning, 400)}`,
    matchedQuery ? `  - Query: \`${trimText(matchedQuery, 200)}\`` : null,
  ].filter(Boolean).join('\n');
}

function fmtRejected({ tweet, score, matchedQuery }) {
  const handle = tweet.handle ? `@${tweet.handle}` : 'unknown';
  const ratio = score.authorSampleSize > 0 ? `${Math.min(score.score, 999).toFixed(1)}×` : 'cold';
  return [
    `- ${handle} · ${ratio} · ${score.reasons.join(' · ')}`,
    `  - ${trimText(tweet.text, 200)}`,
    matchedQuery ? `  - Query: \`${trimText(matchedQuery, 120)}\`` : null,
  ].filter(Boolean).join('\n');
}

export async function appendRunSection(
  path,
  { ts = new Date(), runSummary, notified = [], rejected = [], errors = [] }
) {
  if (!existsSync(path)) {
    await writeFile(path, LOG_HEADER);
  }
  const lines = [];
  lines.push(`## ${fmtTimestamp(ts)}`);
  lines.push('');
  lines.push(
    `Searched: **${runSummary.searched ?? 0}** unique · Scored: **${runSummary.scored ?? 0}** · Notified: **${runSummary.notified ?? 0}**${
      runSummary.note ? ` · Note: ${runSummary.note}` : ''
    }`
  );
  lines.push('');

  if (notified.length) {
    lines.push('### Notified');
    lines.push('');
    for (const w of notified) {
      lines.push(fmtNotified(w));
      lines.push('');
    }
  }

  if (rejected.length) {
    lines.push(`### Rejected (top ${rejected.length} scored)`);
    lines.push('');
    for (const r of rejected) {
      lines.push(fmtRejected(r));
      lines.push('');
    }
  }

  if (errors.length) {
    lines.push('### Errors');
    lines.push('');
    for (const e of errors) lines.push(`- ${e}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  await appendFile(path, lines.join('\n'));
}
