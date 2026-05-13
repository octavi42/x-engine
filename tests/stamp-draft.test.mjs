import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stampDraft } from '../scripts/lib/stamp-draft.mjs';
import { parseDraftFile } from '../scripts/lib/parse-drafts.mjs';

async function withDraft(initial, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'stamp-test-'));
  const file = path.join(dir, 'draft.md');
  await writeFile(file, initial);
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SKELETON = `# Drafts

## 1. Test (proj)

> body line one
> body line two

**Type:** technical-tip
**Project:** proj

---
`;

test('stampDraft writes a single-line metadata field as one line', async () => {
  await withDraft(SKELETON, async (file) => {
    await stampDraft({ filePath: file, draftIndex: 1, updates: { Winner: 'A' } });
    const text = await readFile(file, 'utf8');
    assert.match(text, /^\*\*Winner:\*\* A$/m);
  });
});

test('stampDraft writes a multi-line value as a `> `-prefixed block under empty header', async () => {
  await withDraft(SKELETON, async (file) => {
    await stampDraft({
      filePath: file,
      draftIndex: 1,
      updates: { Refined: 'hook fragment\n\nbody one\nbody two\n\noutcome' },
    });
    const text = await readFile(file, 'utf8');
    assert.match(text, /^\*\*Refined:\*\*$/m);
    assert.match(text, /^> hook fragment$/m);
    assert.match(text, /^> $/m); // blank line preserved as `> `
    assert.match(text, /^> body one$/m);
    assert.match(text, /^> outcome$/m);
  });
});

test('parseDraftFile round-trips a stamped multi-line refined', async () => {
  await withDraft(SKELETON, async (file) => {
    const value = 'hook line\n\nbody line\n\nbonus detail';
    await stampDraft({ filePath: file, draftIndex: 1, updates: { Refined: value } });
    const parsed = await parseDraftFile(file);
    assert.equal(parsed[0].refined, value);
  });
});

test('parseDraftFile still reads legacy single-line **Field:** value', async () => {
  const legacy = `# Drafts

## 1. Legacy (proj)

> body

**Type:** t
**Refined:** old single-line refined output here
**Score:** specificity 4/5 · hook 3/5 · length 4/5 · pattern 3/5

---
`;
  await withDraft(legacy, async (file) => {
    const parsed = await parseDraftFile(file);
    assert.equal(parsed[0].refined, 'old single-line refined output here');
    assert.equal(parsed[0].score, 'specificity 4/5 · hook 3/5 · length 4/5 · pattern 3/5');
  });
});

test('stampDraft replaces multi-line block in place when shrinking to single-line', async () => {
  await withDraft(SKELETON, async (file) => {
    await stampDraft({ filePath: file, draftIndex: 1, updates: { Refined: 'a\nb\nc' } });
    await stampDraft({ filePath: file, draftIndex: 1, updates: { Refined: 'single line' } });

    const parsed = await parseDraftFile(file);
    assert.equal(parsed[0].refined, 'single line');

    // Verify no stale `> ` lines from the prior multi-line block survived.
    const text = await readFile(file, 'utf8');
    assert.match(text, /^\*\*Refined:\*\* single line$/m);
    // The old block lines should be gone.
    assert.doesNotMatch(text, /^> a$/m);
    assert.doesNotMatch(text, /^> b$/m);
  });
});

test('stampDraft replaces single-line in place when growing to multi-line', async () => {
  await withDraft(SKELETON, async (file) => {
    await stampDraft({ filePath: file, draftIndex: 1, updates: { Refined: 'one liner' } });
    await stampDraft({ filePath: file, draftIndex: 1, updates: { Refined: 'line a\nline b' } });

    const parsed = await parseDraftFile(file);
    assert.equal(parsed[0].refined, 'line a\nline b');

    const text = await readFile(file, 'utf8');
    assert.match(text, /^\*\*Refined:\*\*$/m);
    assert.match(text, /^> line a$/m);
    assert.match(text, /^> line b$/m);
    // The old single-line value should be gone.
    assert.doesNotMatch(text, /one liner/);
  });
});

test('stampDraft preserves the draft body block when stamping metadata after it', async () => {
  await withDraft(SKELETON, async (file) => {
    await stampDraft({
      filePath: file,
      draftIndex: 1,
      updates: { Refined: 'r1\nr2', Winner: 'A' },
    });
    const parsed = await parseDraftFile(file);
    // Body of the draft (the original `> body line one ... > body line two` block)
    // must remain intact — the new multi-line metadata block must not bleed
    // into the body parser.
    assert.equal(parsed[0].body, 'body line one\nbody line two');
    assert.equal(parsed[0].refined, 'r1\nr2');
  });
});

test('stampDraft updates multiple fields in one call without corrupting earlier blocks', async () => {
  await withDraft(SKELETON, async (file) => {
    await stampDraft({
      filePath: file,
      draftIndex: 1,
      updates: {
        Critique: 'weak hook. add metric.',
        Refined: 'hook\n\nbody',
        Winner: 'A',
        Ranking: 'A > original > B > C',
      },
    });
    const parsed = await parseDraftFile(file);
    assert.equal(parsed[0].critique, 'weak hook. add metric.');
    assert.equal(parsed[0].refined, 'hook\n\nbody');
    // body stays intact regardless of how many fields we add
    assert.equal(parsed[0].body, 'body line one\nbody line two');
  });
});
