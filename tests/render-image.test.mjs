import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseImageMarkdown,
  renderMarkdownToPng,
  RenderImageError,
  LIMITS,
} from '../scripts/lib/render-image.mjs';

// PNG magic header: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const validMarkdown = `# the system of tools

## section one
- bullet one
- bullet two

## section two
- bullet three
- bullet four

## section three
- bullet five
- bullet six
`;

test('parser: accepts minimum valid input (3 sections, 2 bullets each)', () => {
  const result = parseImageMarkdown(validMarkdown);
  assert.equal(result.title, 'the system of tools');
  assert.equal(result.sections.length, 3);
  assert.equal(result.sections[0].heading, 'section one');
  assert.deepEqual(result.sections[0].bullets, ['bullet one', 'bullet two']);
});

test('parser: rejects empty input', () => {
  assert.throws(() => parseImageMarkdown(''), RenderImageError);
  assert.throws(() => parseImageMarkdown('   \n  '), RenderImageError);
  assert.throws(() => parseImageMarkdown(null), RenderImageError);
});

test('parser: rejects missing title', () => {
  const md = `## section one\n- bullet\n- bullet\n## section two\n- bullet\n- bullet\n## section three\n- bullet\n- bullet`;
  assert.throws(() => parseImageMarkdown(md), /missing H1 title/);
});

test('parser: rejects multiple H1 titles', () => {
  const md = `# first\n# second\n## a\n- b\n- c\n## d\n- e\n- f\n## g\n- h\n- i`;
  assert.throws(() => parseImageMarkdown(md), /multiple H1 titles/);
});

test('parser: rejects too few sections', () => {
  const md = `# title\n## a\n- b\n- c\n## d\n- e\n- f`;
  assert.throws(
    () => parseImageMarkdown(md),
    new RegExp(`expected ${LIMITS.MIN_SECTIONS}.*sections, got 2`)
  );
});

test('parser: rejects too many sections', () => {
  const sections = Array.from({ length: LIMITS.MAX_SECTIONS + 1 }, (_, i) => `## s${i}\n- a\n- b`).join('\n');
  const md = `# title\n${sections}`;
  assert.throws(() => parseImageMarkdown(md), /expected .* sections, got/);
});

test('parser: rejects too few bullets in a section', () => {
  const md = `# title\n## a\n- one\n## b\n- two\n- three\n## c\n- four\n- five`;
  assert.throws(() => parseImageMarkdown(md), /section 1.*expected/);
});

test('parser: rejects too many bullets in a section', () => {
  const bullets = Array.from({ length: LIMITS.MAX_BULLETS + 1 }, (_, i) => `- b${i}`).join('\n');
  const md = `# title\n## one\n${bullets}\n## two\n- a\n- b\n## three\n- c\n- d`;
  assert.throws(() => parseImageMarkdown(md), /section 1.*expected/);
});

test('parser: rejects title that exceeds char limit', () => {
  const longTitle = 'x'.repeat(LIMITS.MAX_TITLE_CHARS + 1);
  const md = `# ${longTitle}\n## a\n- b\n- c\n## d\n- e\n- f\n## g\n- h\n- i`;
  assert.throws(() => parseImageMarkdown(md), /title too long/);
});

test('parser: rejects bullet that exceeds char limit', () => {
  const longBullet = 'x'.repeat(LIMITS.MAX_BULLET_CHARS + 1);
  const md = `# title\n## a\n- ${longBullet}\n- ok\n## b\n- ok\n- ok\n## c\n- ok\n- ok`;
  assert.throws(() => parseImageMarkdown(md), /too long/);
});

test('parser: rejects bullet before any section heading', () => {
  const md = `# title\n- orphan bullet\n## section\n- a\n- b\n## s2\n- c\n- d\n## s3\n- e\n- f`;
  assert.throws(() => parseImageMarkdown(md), /bullet before any section/);
});

test('parser: rejects unexpected content (e.g. h3 or paragraph)', () => {
  const md = `# title\n## section\nsome paragraph\n- bullet\n- bullet`;
  assert.throws(() => parseImageMarkdown(md), /unexpected content/);
});

test('parser: accepts asterisk bullets as equivalent to dash', () => {
  const md = `# title\n## a\n* one\n* two\n## b\n- three\n- four\n## c\n- five\n- six`;
  const result = parseImageMarkdown(md);
  assert.deepEqual(result.sections[0].bullets, ['one', 'two']);
});

test('parser: ignores blank lines between sections and bullets', () => {
  const md = `\n\n# title\n\n## a\n\n- b\n- c\n\n## d\n- e\n- f\n\n## g\n\n- h\n\n- i\n\n`;
  const result = parseImageMarkdown(md);
  assert.equal(result.sections.length, 3);
});

test('integration: renders valid markdown to PNG with PNG magic header', async () => {
  const png = await renderMarkdownToPng(validMarkdown);
  assert.ok(png.length > 1000, `expected non-trivial PNG (got ${png.length}B)`);
  const magic = Buffer.from(png).subarray(0, 8);
  assert.ok(magic.equals(PNG_MAGIC), 'PNG magic header mismatch');
});
