import { readFile, writeFile } from "node:fs/promises";

function renderField(field, value) {
  const str = String(value ?? "");
  if (str.includes("\n")) {
    // Multi-line block: header on its own line, body lines `> `-prefixed.
    // Blank lines become `> ` (matching the body-block convention used by
    // buildDraftFile in scripts/draft.mjs) so a contiguous block stays parseable.
    const body = str.split("\n").map(l => `> ${l}`).join("\n");
    return [`**${field}:**`, body];
  }
  return [`**${field}:** ${str}`];
}

// Locate the range [start, end) of an existing field within a draft block.
// `start` is the `**Field:**` header line. `end` is one past the last line
// belonging to the field's value — for single-line fields this is start+1;
// for `> `-block fields it spans the contiguous block.
function findFieldRange(lines, blockStart, blockEnd, field) {
  const fieldRe = new RegExp(`^\\*\\*${field}:\\*\\*`);
  for (let j = blockStart; j < blockEnd; j++) {
    if (!fieldRe.test(lines[j])) continue;
    const headerMatch = lines[j].match(/^\*\*[^:*]+:\*\*\s*(.*?)\s*$/);
    const inline = headerMatch ? headerMatch[1].trim() : "";
    if (inline !== "") return { start: j, end: j + 1 };
    // Empty header — check for `> ` block underneath.
    let k = j + 1;
    while (k < blockEnd && lines[k].trim() === "") k++;
    if (k < blockEnd && (lines[k].startsWith("> ") || lines[k] === ">")) {
      while (k < blockEnd && (lines[k].startsWith("> ") || lines[k] === ">")) k++;
      return { start: j, end: k };
    }
    return { start: j, end: j + 1 };
  }
  return null;
}

export async function stampDraft({ filePath, draftIndex, updates }) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");

  const headerRe = new RegExp(`^## ${draftIndex}\\.\\s`);
  const blockStart = lines.findIndex(l => headerRe.test(l));
  if (blockStart === -1) throw new Error(`Draft #${draftIndex} not found in ${filePath}`);

  let blockEnd = lines.length;
  for (let j = blockStart + 1; j < lines.length; j++) {
    if (lines[j].startsWith("## ") || lines[j].trim() === "---") {
      blockEnd = j;
      break;
    }
  }

  for (const [field, value] of Object.entries(updates)) {
    const rendered = renderField(field, value);
    const range = findFieldRange(lines, blockStart, blockEnd, field);
    if (range) {
      const removed = range.end - range.start;
      lines.splice(range.start, removed, ...rendered);
      blockEnd += rendered.length - removed;
    } else {
      let insertAt = blockEnd;
      while (insertAt > blockStart && lines[insertAt - 1].trim() === "") insertAt--;
      lines.splice(insertAt, 0, ...rendered);
      blockEnd += rendered.length;
    }
  }

  await writeFile(filePath, lines.join("\n"));
}
