// Parser + stamper for `posted/archive.md`.
//
// The archive is the system of record for everything we've shipped to X. The
// engagement-feedback loop reads it to find unstamped entries (posts that
// went out 1-7 days ago and don't yet have likes/replies/etc), fetches the
// current metrics, and writes them back in-place.
//
// File format (see scripts/post.mjs#archive for the writer):
//
//   ## YYYY-MM-DD
//   > body line 1
//   > body line 2 (optional, multi-line bodies preserve `> ` prefix)
//
//   URL: https://x.com/i/web/status/<id>
//   Project: <name or "general">
//   Variant: original|refined         (omitted on legacy hand-written entries)
//   Likes: — | Reposts: — | Replies: — | Notes: <free text>
//   Bookmarks: <n>                    (added by feedback once stamped)
//   Views: <n>                        (added by feedback once stamped)
//   Fetched: <ISO 8601>               (added by feedback once stamped)
//
// We intentionally do NOT mutate the existing `Likes:` line layout — we
// fill in the placeholder values and append three new lines beneath it on
// the first stamp. Subsequent stamps update those existing lines in place.

import { readFile, writeFile } from 'node:fs/promises';

// Treat a metric as "stamped" only when the value parses as a finite number.
// `—`, empty string, and missing fields all count as unstamped.
function parseMetric(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return null;
  const n = Number(s.replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function tweetIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

// Engagement score used for top-performer ranking. Mirrors the weights used
// in scripts/lib/twitterapi-io.mjs::engagementScore but operates on absolute
// counts (no view denominator) — we compare our own posts against each
// other, not across audiences.
export function ownEngagementScore(metrics) {
  const likes = metrics.likes ?? 0;
  const replies = metrics.replies ?? 0;
  const bookmarks = metrics.bookmarks ?? 0;
  const reposts = metrics.reposts ?? 0;
  return likes + 2 * replies + 3 * bookmarks + 1.5 * reposts;
}

export async function parseArchive(filePath) {
  const text = await readFile(filePath, 'utf8');
  return parseArchiveText(text);
}

export function parseArchiveText(text) {
  const lines = text.split('\n');
  const entries = [];

  let i = 0;
  while (i < lines.length) {
    const header = lines[i].match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (!header) { i++; continue; }

    const date = header[1];
    const start = i;
    i++;

    while (i < lines.length && lines[i].trim() === '') i++;

    const bodyLines = [];
    while (i < lines.length && lines[i].startsWith('> ')) {
      bodyLines.push(lines[i].slice(2));
      i++;
    }

    const meta = {};
    let notes = '';
    while (i < lines.length) {
      const cur = lines[i];
      if (/^##\s+\d{4}-\d{2}-\d{2}\s*$/.test(cur)) break;
      if (cur.trim() === '---') break;

      const pipeMatch = cur.match(/^Likes:\s*(.+?)\s*$/i);
      if (pipeMatch) {
        const segments = pipeMatch[1].split('|').map((s) => s.trim());
        // First segment is the bare Likes value (no key prefix); subsequent
        // segments are `Key: value` pairs.
        if (segments.length) meta.likes = segments[0];
        for (const part of segments.slice(1)) {
          const idx = part.indexOf(':');
          if (idx === -1) continue;
          const key = part.slice(0, idx).trim().toLowerCase();
          const value = part.slice(idx + 1).trim();
          if (key === 'notes') {
            notes = value;
          } else if (key) {
            meta[key] = value;
          }
        }
        i++;
        continue;
      }

      const kv = cur.match(/^([A-Za-z][\w\s]*?):\s*(.*)\s*$/);
      if (kv) {
        meta[kv[1].trim().toLowerCase()] = kv[2].trim();
      }
      i++;
    }

    const url = meta.url || '';
    const tweetId = tweetIdFromUrl(url);

    entries.push({
      date,
      headerLine: start,
      body: bodyLines.join('\n').trim(),
      url,
      tweetId,
      project: meta.project || 'general',
      variant: meta.variant || '',
      notes,
      metrics: {
        likes: parseMetric(meta.likes),
        reposts: parseMetric(meta.reposts),
        replies: parseMetric(meta.replies),
        bookmarks: parseMetric(meta.bookmarks),
        views: parseMetric(meta.views),
      },
      fetchedAt: meta.fetched || '',
    });
  }

  return entries;
}

// Returns archive entries that:
//  - have a parseable tweet ID (i.e. URL)
//  - are between minAgeDays and maxAgeDays old (inclusive of the boundary
//    dates by date-only comparison; the archive doesn't store hour-level
//    timestamps so this is intentionally coarse)
//  - have at least one missing metric (likes/reposts/replies)
export function pendingFeedback(entries, { now = new Date(), minAgeDays = 1, maxAgeDays = 7 } = {}) {
  const today = now.toISOString().slice(0, 10);
  const minISO = isoDateOffset(now, -maxAgeDays);
  const maxISO = isoDateOffset(now, -minAgeDays);
  return entries.filter((e) => {
    if (!e.tweetId) return false;
    if (e.date < minISO || e.date > maxISO) return false;
    if (e.date > today) return false;
    const m = e.metrics;
    return m.likes === null || m.reposts === null || m.replies === null;
  });
}

function isoDateOffset(now, days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Stamps engagement metrics back into the archive file. Updates the existing
// `Likes:` line in place (preserving the trailing `Notes:` field) and adds
// `Bookmarks:`, `Views:`, `Fetched:` lines underneath if missing, or updates
// them in place on subsequent runs.
//
// `stamps` is a Map<tweetId, { likes, reposts, replies, bookmarks, views, fetchedAt }>.
// Returns the number of entries actually mutated.
export async function stampArchive(filePath, stamps) {
  const text = await readFile(filePath, 'utf8');
  const result = stampArchiveText(text, stamps);
  if (result.changed > 0) {
    await writeFile(filePath, result.text);
  }
  return result.changed;
}

export function stampArchiveText(text, stamps) {
  const lines = text.split('\n');
  let changed = 0;

  // Find the entry blocks by header line + tweet ID, then patch each.
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\d{4}-\d{2}-\d{2}\s*$/.test(lines[i])) blocks.push(i);
  }
  blocks.push(lines.length); // sentinel

  for (let b = 0; b < blocks.length - 1; b++) {
    const start = blocks[b];
    const end = blocks[b + 1];

    let urlLine = -1;
    for (let j = start + 1; j < end; j++) {
      const m = lines[j].match(/^URL:\s*(.+?)\s*$/i);
      if (m) { urlLine = j; break; }
    }
    if (urlLine === -1) continue;
    const tweetId = tweetIdFromUrl(lines[urlLine].slice(4).trim());
    if (!tweetId) continue;
    const stamp = stamps.get(tweetId);
    if (!stamp) continue;

    let likesLine = -1;
    let bookmarksLine = -1;
    let viewsLine = -1;
    let fetchedLine = -1;
    for (let j = start + 1; j < end; j++) {
      const l = lines[j];
      if (likesLine === -1 && /^Likes:/i.test(l)) likesLine = j;
      else if (bookmarksLine === -1 && /^Bookmarks:/i.test(l)) bookmarksLine = j;
      else if (viewsLine === -1 && /^Views:/i.test(l)) viewsLine = j;
      else if (fetchedLine === -1 && /^Fetched:/i.test(l)) fetchedLine = j;
    }

    let preservedNotes = '';
    if (likesLine !== -1) {
      const pipe = lines[likesLine].split('|');
      for (const part of pipe) {
        const m = part.match(/^\s*Notes:\s*(.*)$/i);
        if (m) preservedNotes = m[1].trim();
      }
    }
    const newLikesLine = formatLikesLine({
      likes: stamp.likes,
      reposts: stamp.reposts,
      replies: stamp.replies,
      notes: preservedNotes,
    });

    if (likesLine === -1) {
      // No existing Likes line — insert after URL (or after Variant if present).
      let insertAt = urlLine + 1;
      while (insertAt < end && lines[insertAt].trim() !== '' && !/^Likes:/i.test(lines[insertAt])) {
        insertAt++;
      }
      lines.splice(insertAt, 0, newLikesLine);
      shiftIndexes(insertAt, 1);
      likesLine = insertAt;
    } else if (lines[likesLine] !== newLikesLine) {
      lines[likesLine] = newLikesLine;
    }

    upsertField('Bookmarks', stamp.bookmarks, () => bookmarksLine, (n) => { bookmarksLine = n; });
    upsertField('Views', stamp.views, () => viewsLine, (n) => { viewsLine = n; });
    upsertField('Fetched', stamp.fetchedAt, () => fetchedLine, (n) => { fetchedLine = n; });

    changed++;

    function shiftIndexes(after, delta) {
      if (bookmarksLine > after) bookmarksLine += delta;
      if (viewsLine > after) viewsLine += delta;
      if (fetchedLine > after) fetchedLine += delta;
      // Shift ALL subsequent block boundaries (including the sentinel) so
      // later entries don't have their Likes/Project lines cut out of range.
      for (let k = b + 1; k < blocks.length; k++) {
        if (blocks[k] > after) blocks[k] += delta;
      }
    }

    function upsertField(name, value, getLine, setLine) {
      if (value === undefined || value === null) return;
      const formatted = `${name}: ${value}`;
      const existing = getLine();
      if (existing === -1) {
        const insertAt = likesLine + 1
          + (bookmarksLine !== -1 && bookmarksLine > likesLine ? 1 : 0)
          + (viewsLine !== -1 && viewsLine > likesLine ? 1 : 0)
          + (fetchedLine !== -1 && fetchedLine > likesLine ? 1 : 0);
        lines.splice(insertAt, 0, formatted);
        setLine(insertAt);
        shiftIndexes(insertAt, 1);
      } else if (lines[existing] !== formatted) {
        lines[existing] = formatted;
      }
    }
  }

  return { text: lines.join('\n'), changed };
}

function formatLikesLine({ likes, reposts, replies, notes }) {
  const fmt = (v) => (v === null || v === undefined ? '—' : String(v));
  return `Likes: ${fmt(likes)} | Reposts: ${fmt(reposts)} | Replies: ${fmt(replies)} | Notes: ${notes ?? ''}`.replace(/\s+$/, '');
}

// Returns top N stamped entries by engagement score (descending).
// Unstamped entries (no metrics yet) are skipped so the result is meaningful
// even on a partial archive.
export function topPerformers(entries, n = 3) {
  const scored = entries
    .filter((e) => e.metrics.likes !== null || e.metrics.replies !== null || e.metrics.bookmarks !== null)
    .map((e) => ({ entry: e, score: ownEngagementScore(e.metrics) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map(({ entry, score }) => ({ ...entry, score }));
}
