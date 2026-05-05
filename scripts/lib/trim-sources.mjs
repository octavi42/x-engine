// Helpers to keep the drafting agent's system prompt bounded.
// The system prompt is built from voice + projects + every sources/*/latest.md
// + posted/archive.md. Without caps, a single runaway file (especially the
// monotonically appended trending log) can push the spawn argv past the
// kernel's ARG_MAX (~128KB on Linux) and trigger E2BIG.

// Keeps only the most recent `days` `## YYYY-MM-DD` sections of a rolling log
// like sources/trending/latest.md. Newest sections are at the top of the file
// (the convention enforced by the research phase), so we walk top-to-bottom
// and stop after `days` headers. Frontmatter + intro before the first dated
// header are preserved verbatim.
export function trimTrendingLog(content, days = 14) {
  const lines = content.split('\n');
  const headerRe = /^## \d{4}-\d{2}-\d{2}\s*$/;

  let firstHeader = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) { firstHeader = i; break; }
  }
  if (firstHeader === -1) return content; // no dated sections — nothing to trim

  let kept = 0;
  let cutoff = lines.length; // default: keep everything
  for (let i = firstHeader; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      kept += 1;
      if (kept > days) { cutoff = i; break; }
    }
  }
  if (cutoff === lines.length) return content; // already within window

  // Trim trailing blank lines so the result doesn't end with whitespace soup.
  let end = cutoff;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(0, end).join('\n') + '\n';
}

// Hard byte cap for a single source's content. Keeps the head — newest items
// live at the top of trending, x-profile, peer-posts, and most other sources.
// Adds a visible truncation marker so the agent knows it's looking at a slice.
export function clipText(content, maxBytes) {
  if (typeof content !== 'string') return content;
  // Use Buffer.byteLength for an accurate UTF-8 size check; slicing by char
  // index is fine because our sources are ASCII-heavy and we add a generous
  // safety margin via the marker.
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content;
  const marker = '\n\n_(truncated for prompt size)_\n';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  return content.slice(0, budget) + marker;
}
