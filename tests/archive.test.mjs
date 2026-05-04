import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArchiveText,
  pendingFeedback,
  stampArchiveText,
  topPerformers,
  ownEngagementScore,
} from '../scripts/lib/archive.mjs';

const SAMPLE = `# Posted Archive

## 2026-05-03
> first post body

URL: https://x.com/i/web/status/2050969731155349933
Project: Road to SF
Likes: — | Reposts: — | Replies: — | Notes:

## 2026-05-04
> second post body
> with two lines

URL: https://x.com/i/web/status/2051036972710261187
Project: Road to SF
Variant: refined
Likes: 12 | Reposts: 1 | Replies: 3 | Notes: hand-edited
Bookmarks: 5
Views: 1234
Fetched: 2026-05-05T13:00:00.000Z

## 2026-05-05
> third post (no URL — manual entry)

Likes: — | Reposts: — | Replies: — | Notes:
`;

test('parseArchiveText extracts entries with body, url, metrics, and tweet IDs', () => {
  const entries = parseArchiveText(SAMPLE);
  assert.equal(entries.length, 3);

  assert.equal(entries[0].date, '2026-05-03');
  assert.equal(entries[0].body, 'first post body');
  assert.equal(entries[0].tweetId, '2050969731155349933');
  assert.equal(entries[0].project, 'Road to SF');
  assert.equal(entries[0].metrics.likes, null);
  assert.equal(entries[0].metrics.bookmarks, null);

  assert.equal(entries[1].body, 'second post body\nwith two lines');
  assert.equal(entries[1].tweetId, '2051036972710261187');
  assert.equal(entries[1].variant, 'refined');
  assert.deepEqual(entries[1].metrics, {
    likes: 12,
    reposts: 1,
    replies: 3,
    bookmarks: 5,
    views: 1234,
  });
  assert.equal(entries[1].notes, 'hand-edited');
  assert.equal(entries[1].fetchedAt, '2026-05-05T13:00:00.000Z');

  // Manual entry with no URL — tweetId should be null and pending should skip it.
  assert.equal(entries[2].tweetId, null);
});

test('pendingFeedback only returns aged-but-unstamped entries with tweet IDs', () => {
  const entries = parseArchiveText(SAMPLE);
  const now = new Date('2026-05-06T13:00:00Z');
  const pending = pendingFeedback(entries, { now, minAgeDays: 1, maxAgeDays: 7 });
  // 05-03 is 3d old, no metrics, has URL → eligible
  // 05-04 is 2d old, fully stamped → skipped
  // 05-05 is 1d old, no URL → skipped (no tweetId)
  assert.equal(pending.length, 1);
  assert.equal(pending[0].tweetId, '2050969731155349933');
});

test('pendingFeedback skips entries outside the age window', () => {
  const entries = parseArchiveText(SAMPLE);
  // From 2026-05-15: 05-03 is 12d old → outside 7d window; 05-04 stamped; 05-05 no URL.
  const pending = pendingFeedback(entries, {
    now: new Date('2026-05-15T13:00:00Z'),
    minAgeDays: 1,
    maxAgeDays: 7,
  });
  assert.equal(pending.length, 0);
});

test('stampArchiveText updates Likes line and adds Bookmarks/Views/Fetched', () => {
  const stamps = new Map([
    ['2050969731155349933', {
      likes: 22, reposts: 1, replies: 3, bookmarks: 5, views: 999,
      fetchedAt: '2026-05-06T13:00:00Z',
    }],
  ]);
  const { text, changed } = stampArchiveText(SAMPLE, stamps);
  assert.equal(changed, 1);
  assert.match(text, /Likes: 22 \| Reposts: 1 \| Replies: 3 \| Notes:/);
  assert.match(text, /Bookmarks: 5/);
  assert.match(text, /Views: 999/);
  assert.match(text, /Fetched: 2026-05-06T13:00:00Z/);
});

test('stampArchiveText is idempotent (re-stamping with same values is a no-op write)', () => {
  const stamps = new Map([
    ['2051036972710261187', {
      likes: 12, reposts: 1, replies: 3, bookmarks: 5, views: 1234,
      fetchedAt: '2026-05-05T13:00:00.000Z',
    }],
  ]);
  const first = stampArchiveText(SAMPLE, stamps);
  const second = stampArchiveText(first.text, stamps);
  assert.equal(second.text, first.text);
  // Notes preserved from the original entry.
  assert.match(first.text, /Likes: 12 \| Reposts: 1 \| Replies: 3 \| Notes: hand-edited/);
});

test('stampArchiveText preserves Notes content when updating metrics', () => {
  const stamps = new Map([
    ['2051036972710261187', {
      likes: 50, reposts: 5, replies: 10, bookmarks: 20, views: 9999,
      fetchedAt: '2026-05-06T13:00:00Z',
    }],
  ]);
  const { text } = stampArchiveText(SAMPLE, stamps);
  assert.match(text, /Likes: 50 \| Reposts: 5 \| Replies: 10 \| Notes: hand-edited/);
  assert.match(text, /Bookmarks: 20/);
});

test('stampArchiveText handles multiple consecutive entries without bleed', () => {
  // Regression: shifting blocks[b+1] only meant the second entry's `end`
  // boundary fell short of its Likes line, so the stamper inserted a fresh
  // Likes line right after URL: and stranded the original `Likes: —`.
  const archive = `## 2026-05-03
> first

URL: https://x.com/i/web/status/1
Project: A
Likes: — | Reposts: — | Replies: — | Notes:

## 2026-05-03
> second

URL: https://x.com/i/web/status/2
Project: B
Likes: — | Reposts: — | Replies: — | Notes:
`;
  const stamps = new Map([
    ['1', { likes: 2, reposts: 0, replies: 0, bookmarks: 0, views: 50, fetchedAt: 't1' }],
    ['2', { likes: 1, reposts: 0, replies: 0, bookmarks: 0, views: 30, fetchedAt: 't2' }],
  ]);
  const { text, changed } = stampArchiveText(archive, stamps);
  assert.equal(changed, 2);
  // Each entry should have exactly ONE Likes line (the original `—` placeholder
  // must be replaced in place, not stranded).
  assert.equal((text.match(/Likes: 2 \|/g) ?? []).length, 1);
  assert.equal((text.match(/Likes: 1 \|/g) ?? []).length, 1);
  assert.doesNotMatch(text, /Likes: —/);
  // Second entry's stamps land below its own Likes line, not above Project.
  assert.match(text, /Project: B\nLikes: 1 \|[^\n]*\nBookmarks: 0\nViews: 30\nFetched: t2/);
});

test('stampArchiveText skips tweet IDs not present in the file', () => {
  const stamps = new Map([
    ['9999999999999999999', { likes: 1, reposts: 0, replies: 0, bookmarks: 0, views: 0, fetchedAt: 'x' }],
  ]);
  const { changed, text } = stampArchiveText(SAMPLE, stamps);
  assert.equal(changed, 0);
  assert.equal(text, SAMPLE);
});

test('topPerformers ranks by weighted engagement score and skips unstamped', () => {
  const archive = `## 2026-05-01
> a

URL: https://x.com/i/web/status/1
Likes: 10 | Reposts: 0 | Replies: 0 | Notes:
Bookmarks: 0

## 2026-05-02
> b

URL: https://x.com/i/web/status/2
Likes: 5 | Reposts: 0 | Replies: 5 | Notes:
Bookmarks: 5

## 2026-05-03
> c (unstamped)

URL: https://x.com/i/web/status/3
Likes: — | Reposts: — | Replies: — | Notes:
`;
  const entries = parseArchiveText(archive);
  const top = topPerformers(entries, 5);
  assert.equal(top.length, 2);
  // b: 5 + 2*5 + 3*5 = 30
  // a: 10 + 0 + 0 = 10
  assert.equal(top[0].body, 'b');
  assert.equal(top[1].body, 'a');
  assert.equal(top[0].score, 30);
});

test('ownEngagementScore matches the documented formula', () => {
  assert.equal(ownEngagementScore({ likes: 10, replies: 2, bookmarks: 1, reposts: 4 }), 10 + 4 + 3 + 6);
});
