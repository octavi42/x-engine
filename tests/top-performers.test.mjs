import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderTopPerformersBlock, spliceTopPerformers } from '../scripts/lib/top-performers.mjs';

const PERFORMERS = [
  {
    date: '2026-05-03',
    body: 'cost bug body text',
    url: 'https://x.com/i/web/status/1',
    project: 'Road to SF',
    variant: 'original',
    score: 33,
    metrics: { likes: 22, reposts: 1, replies: 3, bookmarks: 5, views: 999 },
  },
];

test('renderTopPerformersBlock embeds metrics and is wrapped by markers', () => {
  const block = renderTopPerformersBlock(PERFORMERS, { now: new Date('2026-05-06T00:00:00Z') });
  assert.match(block, /^<!-- auto-feedback:start -->/);
  assert.match(block, /<!-- auto-feedback:end -->$/);
  assert.match(block, /Generated 2026-05-06/);
  assert.match(block, /Likes 22 · Replies 3 · Reposts 1 · Bookmarks 5 · Views 999/);
  assert.match(block, /cost bug body text/);
  assert.match(block, /Project: Road to SF · Variant: original/);
});

test('renderTopPerformersBlock falls back to a stub when there is no data yet', () => {
  const block = renderTopPerformersBlock([], { now: new Date('2026-05-06T00:00:00Z') });
  assert.match(block, /No engagement data yet/);
});

test('spliceTopPerformers replaces existing block when markers are present', () => {
  const profile = `# X Profile

## Top performing
<!-- auto-feedback:start -->
old content
<!-- auto-feedback:end -->

## Next section
preserved`;
  const block = '<!-- auto-feedback:start -->\nnew content\n<!-- auto-feedback:end -->';
  const next = spliceTopPerformers(profile, block);
  assert.match(next, /new content/);
  assert.doesNotMatch(next, /old content/);
  assert.match(next, /## Next section\npreserved/);
});

test('spliceTopPerformers inserts under heading on first run, replacing freeform body', () => {
  const profile = `# X Profile

## Top performing
No engagement data recorded yet — manually note current numbers.

## Next section
preserved`;
  const block = '<!-- auto-feedback:start -->\ngenerated\n<!-- auto-feedback:end -->';
  const next = spliceTopPerformers(profile, block);
  assert.match(next, /## Top performing\n<!-- auto-feedback:start -->\ngenerated\n<!-- auto-feedback:end -->\n\n## Next section/);
  assert.doesNotMatch(next, /manually note current numbers/);
});

test('spliceTopPerformers appends a fresh heading when none exists', () => {
  const profile = `# X Profile

## Account snapshot
foo`;
  const block = '<!-- auto-feedback:start -->\ngenerated\n<!-- auto-feedback:end -->';
  const next = spliceTopPerformers(profile, block);
  assert.match(next, /## Top performing\n<!-- auto-feedback:start -->\ngenerated\n<!-- auto-feedback:end -->/);
});
