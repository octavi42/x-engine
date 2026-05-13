import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArchetypes, selectArchetypesForDraft, normalizeType } from '../scripts/lib/archetypes.mjs';

const SAMPLE = `# Hook Archetypes

Some intro prose that should be skipped by the parser.

---

## introducing-X

**Mechanic:** lowercase noun on line 1 locks scrolling eyes.

**Fits types:** building-in-public, trending-reaction

**Structure:**
\`\`\`
<name>

<step1> → <step2>

<outcome>
\`\`\`

**Exemplars:**
- @aidenybai · Claude Doctor — 2556L (2026-05-08)
- TODO: paste another peer URL

---

## cause/fix

**Mechanic:** failure-state hook + labeled diagnosis lines scan in two seconds.

**Fits types:** technical-tip, building-in-public

**Structure:**
\`\`\`
<symptom>

cause: <reason>
fix: <named mechanism>
\`\`\`

**Exemplars:**
- own 2026-05-09 offline-beat-recovery post

---

## outlier-data

**Mechanic:** counter-intuitive number on line 1 conflicts with the reader's prior.

**Fits types:** trending-reaction

**Structure:**
\`\`\`
<number>

<entity>. <why>
\`\`\`

**Exemplars:**
- (none yet)
`;

test('parseArchetypes extracts all archetype blocks with all four fields', () => {
  const archs = parseArchetypes(SAMPLE);
  assert.equal(archs.length, 3);
  const names = archs.map(a => a.name);
  assert.deepEqual(names, ['introducing-X', 'cause/fix', 'outlier-data']);
});

test('parseArchetypes captures mechanic, fitsTypes, structure, exemplars correctly', () => {
  const [intro] = parseArchetypes(SAMPLE);
  assert.equal(intro.name, 'introducing-X');
  assert.match(intro.mechanic, /lowercase noun on line 1/);
  assert.deepEqual(intro.fitsTypes, ['building-in-public', 'trending-reaction']);
  assert.match(intro.structure, /^<name>/);
  assert.match(intro.structure, /<outcome>$/);
  assert.equal(intro.exemplars.length, 2);
  assert.match(intro.exemplars[0], /aidenybai/);
});

test('parseArchetypes skips file intro prose before first ## header', () => {
  const archs = parseArchetypes(SAMPLE);
  // Intro text "Some intro prose..." must not become an archetype.
  assert.ok(archs.every(a => !a.name.includes('intro prose')));
});

test('normalizeType strips qualifier after — / · / -', () => {
  assert.equal(normalizeType('technical tip — codebase pattern'), 'technical-tip');
  assert.equal(normalizeType('building in public · design principle'), 'building-in-public');
  assert.equal(normalizeType('trending reaction - AI safety'), 'trending-reaction');
  assert.equal(normalizeType('technical-tip'), 'technical-tip');
  assert.equal(normalizeType('  Building In Public  '), 'building-in-public');
  assert.equal(normalizeType(''), '');
  assert.equal(normalizeType(null), '');
});

test('selectArchetypesForDraft returns archetypes whose fitsTypes include the normalized draft type', () => {
  const archs = parseArchetypes(SAMPLE);
  const selected = selectArchetypesForDraft(archs, 'technical tip — local AI pipeline', 3);
  assert.equal(selected.length, 3);
  // cause/fix fits technical-tip — must be in the result.
  assert.ok(selected.find(a => a.name === 'cause/fix'));
  // outlier-data does NOT fit technical-tip, but should appear as a
  // fallback when the type-match set is smaller than n.
  assert.ok(selected.find(a => a.name === 'outlier-data'));
});

test('selectArchetypesForDraft caps at n when more archetypes match than requested', () => {
  const archs = parseArchetypes(SAMPLE);
  // Both introducing-X and cause/fix fit building-in-public.
  const selected = selectArchetypesForDraft(archs, 'building-in-public', 2);
  assert.equal(selected.length, 2);
  // Both type-matches should come first; outlier-data should NOT appear
  // because we have 2 matches and asked for 2.
  const names = selected.map(a => a.name);
  assert.ok(names.includes('introducing-X'));
  assert.ok(names.includes('cause/fix'));
  assert.ok(!names.includes('outlier-data'));
});

test('selectArchetypesForDraft falls back to non-matching archetypes when too few match', () => {
  const archs = parseArchetypes(SAMPLE);
  // cause/fix does NOT fit trending-reaction; introducing-X and outlier-data
  // do. Asking for 3 should yield the 2 matches plus cause/fix as padding.
  const selected = selectArchetypesForDraft(archs, 'trending reaction — model release', 3);
  assert.equal(selected.length, 3);
  const names = selected.map(a => a.name);
  // The two matches must come first (preserving file order).
  assert.deepEqual(names.slice(0, 2), ['introducing-X', 'outlier-data']);
  // cause/fix is the fallback.
  assert.equal(names[2], 'cause/fix');
});

test('selectArchetypesForDraft handles draft types that match nothing', () => {
  const archs = parseArchetypes(SAMPLE);
  const selected = selectArchetypesForDraft(archs, 'engagement question — agent memory', 3);
  // Nothing in our sample bank fits engagement-question; the loader
  // pads with all archetypes in file order.
  assert.equal(selected.length, 3);
});
