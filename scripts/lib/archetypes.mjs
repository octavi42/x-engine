// Loads config/archetypes.md into structured objects the writer prompt can
// inject. The format is documented at the top of that file — block per
// archetype, each with mechanic / fits-types / structure / exemplars.

import { readFile } from 'node:fs/promises';

// Normalize a draft's `**Type:**` value to a canonical archetype-fit key.
// The drafts use messy types like "building in public — bug fix" or
// "technical tip · local AI pipeline". We strip anything after the first
// `—`, `·`, or `-` separator (only when surrounded by whitespace), then
// lowercase and replace spaces with hyphens.
export function normalizeType(type) {
  if (!type) return '';
  let t = String(type).trim().toLowerCase();
  // Cut at the first " — " / " · " / " - " separator.
  const sepMatch = t.match(/\s(?:—|·|-)\s/);
  if (sepMatch) t = t.slice(0, sepMatch.index);
  return t.trim().replace(/\s+/g, '-');
}

// Parse the archetype markdown. Returns an array of archetype objects.
// Each archetype starts with `## <name>` and ends at the next `## ` or end
// of file. The body is scanned for the four labeled fields.
export function parseArchetypes(content) {
  const lines = content.split('\n');
  const archetypes = [];

  let i = 0;
  // Skip everything before the first `## ` header (the file's intro prose).
  while (i < lines.length && !lines[i].startsWith('## ')) i++;

  while (i < lines.length) {
    const headerMatch = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!headerMatch) { i++; continue; }

    const name = headerMatch[1].trim();
    i++;

    // Find the end of this archetype block.
    let blockEnd = lines.length;
    for (let j = i; j < lines.length; j++) {
      if (lines[j].startsWith('## ')) { blockEnd = j; break; }
    }

    const arch = {
      name,
      mechanic: '',
      fitsTypes: [],
      structure: '',
      exemplars: [],
    };

    let j = i;
    while (j < blockEnd) {
      const line = lines[j];
      if (line.startsWith('**Mechanic:**')) {
        arch.mechanic = line.slice('**Mechanic:**'.length).trim();
        j++;
        continue;
      }
      if (line.startsWith('**Fits types:**')) {
        const raw = line.slice('**Fits types:**'.length).trim();
        arch.fitsTypes = raw.split(',').map(s => s.trim()).filter(Boolean);
        j++;
        continue;
      }
      if (line.startsWith('**Structure:**')) {
        // Find the next fenced code block and capture its contents.
        let k = j + 1;
        while (k < blockEnd && lines[k].trim() === '') k++;
        if (k < blockEnd && lines[k].startsWith('```')) {
          const fenceStart = k;
          k++;
          const buf = [];
          while (k < blockEnd && !lines[k].startsWith('```')) {
            buf.push(lines[k]);
            k++;
          }
          arch.structure = buf.join('\n');
          j = k + 1; // skip closing fence
        } else {
          j++;
        }
        continue;
      }
      if (line.startsWith('**Exemplars:**')) {
        let k = j + 1;
        while (k < blockEnd) {
          const e = lines[k];
          if (e.startsWith('- ')) {
            arch.exemplars.push(e.slice(2).trim());
            k++;
            continue;
          }
          if (e.trim() === '') { k++; continue; }
          // Non-bullet, non-blank → end of exemplar list.
          break;
        }
        j = k;
        continue;
      }
      j++;
    }

    archetypes.push(arch);
    i = blockEnd;
  }

  return archetypes;
}

export async function loadArchetypes(filePath) {
  const content = await readFile(filePath, 'utf8');
  return parseArchetypes(content);
}

// Given the full archetype bank and a draft's `**Type:**` value, return up
// to `n` archetypes that fit. Type-fit matching is: normalize the draft type
// (strips qualifier after `—`/`·`/`-`), then keep archetypes whose
// `fitsTypes` includes that normalized key. Falls back to the full bank if
// fewer than `n` match — better to give the writer choices than starve it.
export function selectArchetypesForDraft(archetypes, draftType, n = 3) {
  const key = normalizeType(draftType);
  const matched = archetypes.filter(a => a.fitsTypes.includes(key));
  if (matched.length >= n) return matched.slice(0, n);
  // Pad with non-matching archetypes (preserving file order) to reach n.
  const remaining = archetypes.filter(a => !matched.includes(a));
  return [...matched, ...remaining].slice(0, n);
}
