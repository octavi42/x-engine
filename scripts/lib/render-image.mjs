// Renders synthesis-screenshot image posts: a strict markdown subset
// (1 title + 3–5 sections × 2–5 bullets) → PNG via Satori → resvg.
//
// The format is a Ben Lang-style takeaway card: dark background, structured
// hierarchy, screenshot-shareable. Single template for v1 — adjust constants
// below to retune the aesthetic.
//
// Public surface:
//   parseImageMarkdown(md)       → { title, sections }   (throws on invalid)
//   buildElement({ title, sections }) → JSX-shape object for satori
//   renderToPng({ title, sections }, opts?) → Promise<Uint8Array>
//   renderMarkdownToPng(md, opts?)         → Promise<Uint8Array>
//
// Throws RenderImageError on parse/validation failures — caller decides
// whether to surface that to the user or fall back to a single-tweet draft.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

export class RenderImageError extends Error {}

// -------- layout constants -------------------------------------------------
const WIDTH = 800;
const HEIGHT = 1200;
const BG = '#0a0a0a';
const FG = '#f5f5f5';
const ACCENT = '#a5b4fc'; // indigo-300
const MUTED = '#9ca3af'; // gray-400
const PAD_X = 60;
const PAD_TOP = 80;
const PAD_BOTTOM = 80;
const TITLE_SIZE = 52;
const SECTION_SIZE = 30;
const BULLET_SIZE = 22;
const SECTION_GAP = 36;
const BULLET_GAP = 14;
const TITLE_GAP = 56;

// -------- validation gates -------------------------------------------------
const MAX_TITLE_CHARS = 80;
const MIN_SECTIONS = 3;
const MAX_SECTIONS = 5;
const MIN_BULLETS = 2;
const MAX_BULLETS = 5;
const MAX_BULLET_CHARS = 140;
const MAX_SECTION_HEADING_CHARS = 70;

// -------- markdown parser (strict subset) ----------------------------------
//
// Accepts only:
//   # <title>            (exactly one)
//   ## <section>         (3–5)
//   - <bullet>           (2–5 per section)
//   blank lines (ignored)
//
// Anything else throws. Strictness is the point — the layout has no room
// to be flexible, so we reject early instead of producing a broken PNG.
export function parseImageMarkdown(md) {
  if (typeof md !== 'string' || !md.trim()) {
    throw new RenderImageError('empty markdown input');
  }

  let title = null;
  const sections = [];
  let current = null;

  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('# ') && !line.startsWith('## ')) {
      if (title !== null) {
        throw new RenderImageError(`multiple H1 titles on line ${i + 1}`);
      }
      title = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      current = { heading, bullets: [] };
      sections.push(current);
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!current) {
        throw new RenderImageError(`bullet before any section heading on line ${i + 1}`);
      }
      current.bullets.push(line.slice(2).trim());
      continue;
    }

    throw new RenderImageError(`unexpected content on line ${i + 1}: "${rawLine.slice(0, 60)}"`);
  }

  if (title === null) throw new RenderImageError('missing H1 title');
  if (title.length === 0) throw new RenderImageError('empty H1 title');
  if (title.length > MAX_TITLE_CHARS) {
    throw new RenderImageError(`title too long (${title.length} > ${MAX_TITLE_CHARS})`);
  }
  if (sections.length < MIN_SECTIONS || sections.length > MAX_SECTIONS) {
    throw new RenderImageError(
      `expected ${MIN_SECTIONS}–${MAX_SECTIONS} sections, got ${sections.length}`
    );
  }

  for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i];
    if (!s.heading) throw new RenderImageError(`section ${i + 1}: empty heading`);
    if (s.heading.length > MAX_SECTION_HEADING_CHARS) {
      throw new RenderImageError(
        `section ${i + 1} heading too long (${s.heading.length} > ${MAX_SECTION_HEADING_CHARS})`
      );
    }
    if (s.bullets.length < MIN_BULLETS || s.bullets.length > MAX_BULLETS) {
      throw new RenderImageError(
        `section ${i + 1} ("${s.heading}"): expected ${MIN_BULLETS}–${MAX_BULLETS} bullets, got ${s.bullets.length}`
      );
    }
    for (let b = 0; b < s.bullets.length; b += 1) {
      const bullet = s.bullets[b];
      if (!bullet) {
        throw new RenderImageError(`section ${i + 1} bullet ${b + 1}: empty`);
      }
      if (bullet.length > MAX_BULLET_CHARS) {
        throw new RenderImageError(
          `section ${i + 1} bullet ${b + 1}: too long (${bullet.length} > ${MAX_BULLET_CHARS})`
        );
      }
    }
  }

  return { title, sections };
}

// -------- JSX-shape tree (Satori consumes this) ----------------------------
//
// Satori takes React-element-shaped objects: { type, props: { children, style } }.
// We build them by hand to avoid pulling in React just for layout.
function el(type, style, children) {
  return { type, props: { style, children } };
}

export function buildElement({ title, sections }) {
  const accentBar = el('div', {
    width: 4,
    height: 56,
    backgroundColor: ACCENT,
    marginRight: 24,
    borderRadius: 2,
  });

  const titleRow = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: TITLE_GAP,
    },
    [
      accentBar,
      el(
        'div',
        {
          fontSize: TITLE_SIZE,
          fontWeight: 700,
          color: FG,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          flex: 1,
        },
        title
      ),
    ]
  );

  const sectionEls = sections.map((s, i) => {
    const heading = el(
      'div',
      {
        fontSize: SECTION_SIZE,
        fontWeight: 700,
        color: ACCENT,
        marginBottom: 16,
        letterSpacing: '-0.01em',
      },
      s.heading
    );

    const bullets = s.bullets.map((b) =>
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          marginBottom: BULLET_GAP,
        },
        [
          el(
            'div',
            {
              fontSize: BULLET_SIZE,
              color: MUTED,
              marginRight: 12,
              lineHeight: 1.5,
            },
            '•'
          ),
          el(
            'div',
            {
              fontSize: BULLET_SIZE,
              color: FG,
              lineHeight: 1.5,
              flex: 1,
            },
            b
          ),
        ]
      )
    );

    return el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: i === sections.length - 1 ? 0 : SECTION_GAP,
      },
      [heading, ...bullets]
    );
  });

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: BG,
      paddingLeft: PAD_X,
      paddingRight: PAD_X,
      paddingTop: PAD_TOP,
      paddingBottom: PAD_BOTTOM,
      fontFamily: 'Inter',
    },
    [titleRow, ...sectionEls]
  );
}

// -------- font loading ------------------------------------------------------
//
// Cached after first load — fonts are ~70KB each, no point re-reading per render.
let cachedFonts = null;

async function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..');
  const fontDir = join(repoRoot, 'node_modules', '@fontsource/inter', 'files');
  // Satori accepts WOFF (NOT WOFF2 — verified experimentally despite docs).
  // @fontsource/inter ships both; we pin to WOFF.
  const [regular, bold] = await Promise.all([
    readFile(join(fontDir, 'inter-latin-400-normal.woff')),
    readFile(join(fontDir, 'inter-latin-700-normal.woff')),
  ]);
  cachedFonts = [
    { name: 'Inter', data: regular, weight: 400, style: 'normal' },
    { name: 'Inter', data: bold, weight: 700, style: 'normal' },
  ];
  return cachedFonts;
}

// -------- render -----------------------------------------------------------
export async function renderToPng(parsed, opts = {}) {
  const { width = WIDTH, height = HEIGHT } = opts;
  const fonts = await loadFonts();
  const tree = buildElement(parsed);
  const svg = await satori(tree, { width, height, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  // resvg returns a Buffer; downstream callers may prefer Uint8Array — both work.
  return png;
}

export async function renderMarkdownToPng(md, opts) {
  const parsed = parseImageMarkdown(md);
  return renderToPng(parsed, opts);
}

// -------- constants exported for tests + cli -------------------------------
export const LIMITS = {
  WIDTH,
  HEIGHT,
  MAX_TITLE_CHARS,
  MIN_SECTIONS,
  MAX_SECTIONS,
  MIN_BULLETS,
  MAX_BULLETS,
  MAX_BULLET_CHARS,
  MAX_SECTION_HEADING_CHARS,
};
