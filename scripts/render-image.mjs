#!/usr/bin/env node
// CLI for the synthesis-screenshot image renderer. Phase 3a deliverable —
// renders standalone via markdown input. Phase 3c will wire this into
// scripts/post.mjs so approved image-post drafts auto-render before upload.
//
// Usage:
//   npm run render-image:demo                                  → ./out/demo.png
//   npm run render-image -- --markdown=path/file.md            → ./out/<file>.png
//   npm run render-image -- --markdown=path/file.md --out=foo  → ./out/foo.png
//   echo '# title …' | node scripts/render-image.mjs --stdin   → ./out/stdin.png
//
// Exit codes:
//   0  rendered successfully (writes "wrote <path> (<w>x<h>, <bytes>B, <ms>ms)")
//   1  parse/validation error or render error
//
// Validation errors surface the exact markdown line + reason. No silent fallbacks.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdownToPng, RenderImageError, LIMITS } from './lib/render-image.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const OUT_DIR = join(REPO_ROOT, 'out');
const DEMO_MD = join(REPO_ROOT, 'assets', 'demos', 'synthesis-screenshot-sample.md');

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

let markdown;
let outName;

if (args.demo === true) {
  markdown = await readFile(DEMO_MD, 'utf8');
  outName = args.out ?? 'demo';
} else if (args.stdin === true) {
  markdown = await readStdin();
  outName = args.out ?? 'stdin';
} else if (typeof args.markdown === 'string') {
  markdown = await readFile(args.markdown, 'utf8');
  outName = args.out ?? basename(args.markdown, extname(args.markdown));
} else {
  printUsage();
  process.exit(1);
}

let png;
try {
  png = await renderMarkdownToPng(markdown);
} catch (err) {
  if (err instanceof RenderImageError) {
    console.error(`render-image: ${err.message}`);
    console.error(`limits: title ≤${LIMITS.MAX_TITLE_CHARS}, sections ${LIMITS.MIN_SECTIONS}–${LIMITS.MAX_SECTIONS}, bullets ${LIMITS.MIN_BULLETS}–${LIMITS.MAX_BULLETS}/section, bullet ≤${LIMITS.MAX_BULLET_CHARS} chars`);
    process.exit(1);
  }
  throw err;
}

await mkdir(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `${outName}.png`);
await writeFile(outPath, png);

const elapsed = Date.now() - startedAt;
const bytes = png.length;
console.log(`wrote ${outPath} (${LIMITS.WIDTH}x${LIMITS.HEIGHT}, ${bytes}B, ${elapsed}ms)`);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) {
      out[arg.slice(2)] = true;
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return out;
}

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function printUsage() {
  console.error(
    [
      'usage:',
      '  npm run render-image:demo',
      '  npm run render-image -- --markdown=<path> [--out=<basename>]',
      '  cat in.md | node scripts/render-image.mjs --stdin [--out=<basename>]',
    ].join('\n')
  );
}
