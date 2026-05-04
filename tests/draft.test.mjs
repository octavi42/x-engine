import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDraftFile } from '../scripts/draft.mjs';

test('buildDraftFile renders a single-tweet draft', () => {
  const md = buildDraftFile({
    date: '2026-05-05',
    intro: 'Run notes.',
    drafts: [
      {
        title: 'Test single',
        type: 'building in public',
        source: 'github-commits abc1234',
        project: 'roadtosf',
        body: 'one-line body.',
      },
    ],
  });
  assert.match(md, /^# Drafts — 2026-05-05/);
  assert.match(md, /^> Run notes\./m);
  assert.match(md, /^## 1\. Test single$/m);
  assert.match(md, /^> one-line body\.$/m);
  assert.match(md, /^\*\*Type:\*\* building in public$/m);
  assert.match(md, /^\*\*Project:\*\* roadtosf$/m);
});

test('buildDraftFile renders multi-line body with > prefix on each line', () => {
  const md = buildDraftFile({
    date: '2026-05-05',
    drafts: [
      {
        title: 'Multi',
        type: 'technical tip',
        source: 'raw-ideas',
        project: 'roadtosf',
        body: 'hook line.\n\nsymptom: browser.\ncause: scope missing.\nfix: settings.',
      },
    ],
  });
  // Every body line (incl. the blank one between sections) must start with `> `.
  assert.match(md, /^> hook line\.$/m);
  assert.match(md, /^> $/m); // blank line preserved as `> `
  assert.match(md, /^> symptom: browser\.$/m);
  assert.match(md, /^> cause: scope missing\.$/m);
  assert.match(md, /^> fix: settings\.$/m);
});

test('buildDraftFile renders threads with sub-section labels', () => {
  const md = buildDraftFile({
    date: '2026-05-05',
    drafts: [
      {
        title: 'Thread test',
        type: 'thread hook',
        source: 'github-commits + raw-ideas',
        project: 'roadtosf',
        thread_posts: [
          { label: 'Hook (post 1)', body: 'shipped X. four patterns.' },
          { label: 'Post 2 — pattern one', body: 'pattern body.' },
          { label: 'Post 3 — CTA', body: 'try it → roadtosf.com' },
        ],
      },
    ],
  });
  assert.match(md, /^### Hook \(post 1\)$/m);
  assert.match(md, /^### Post 2 — pattern one$/m);
  assert.match(md, /^### Post 3 — CTA$/m);
  assert.match(md, /^> shipped X\. four patterns\.$/m);
  assert.match(md, /^> pattern body\.$/m);
  assert.match(md, /^> try it → roadtosf\.com$/m);
});

test('buildDraftFile includes Gap addressed when present, omits when absent', () => {
  const withGap = buildDraftFile({
    date: '2026-05-05',
    drafts: [
      {
        title: 'A',
        type: 'technical tip',
        source: 'x',
        project: 'historai',
        body: 'b',
        gap_addressed: 'AI voice apps (last covered April 29)',
      },
    ],
  });
  assert.match(withGap, /^\*\*Gap addressed:\*\* AI voice apps \(last covered April 29\)$/m);

  const withoutGap = buildDraftFile({
    date: '2026-05-05',
    drafts: [
      { title: 'A', type: 'x', source: 'x', project: 'x', body: 'b' },
    ],
  });
  assert.doesNotMatch(withoutGap, /\*\*Gap addressed:/);
});

test('buildDraftFile numbers drafts and emits --- separators', () => {
  const md = buildDraftFile({
    date: '2026-05-05',
    drafts: [
      { title: 'one', type: 't', source: 's', project: 'p', body: 'a' },
      { title: 'two', type: 't', source: 's', project: 'p', body: 'b' },
      { title: 'three', type: 't', source: 's', project: 'p', body: 'c' },
    ],
  });
  assert.match(md, /^## 1\. one$/m);
  assert.match(md, /^## 2\. two$/m);
  assert.match(md, /^## 3\. three$/m);
  // 3 drafts → 3 separators
  assert.equal((md.match(/^---$/gm) ?? []).length, 3);
});

test('buildDraftFile output is parseable by parse-drafts.mjs (round-trip)', async () => {
  const md = buildDraftFile({
    date: '2026-05-05',
    drafts: [
      {
        title: 'Round trip',
        type: 'technical tip',
        source: 'src',
        project: 'roadtosf',
        body: 'line one.\n\nline two.',
      },
    ],
  });
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'x-engine-draft-test-'));
  const file = path.join(dir, 'sample.md');
  await writeFile(file, md);
  const { parseDraftFile } = await import('../scripts/lib/parse-drafts.mjs');
  const parsed = await parseDraftFile(file);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Round trip');
  assert.equal(parsed[0].project, 'roadtosf');
  assert.equal(parsed[0].body, 'line one.\n\nline two.');
  await rm(dir, { recursive: true, force: true });
});
