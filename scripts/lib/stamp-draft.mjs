import { readFile, writeFile } from "node:fs/promises";

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
    const fieldRe = new RegExp(`^\\*\\*${field}:\\*\\*`);
    let updated = false;
    for (let j = blockStart; j < blockEnd; j++) {
      if (fieldRe.test(lines[j])) {
        lines[j] = `**${field}:** ${value}`;
        updated = true;
        break;
      }
    }
    if (!updated) {
      let insertAt = blockEnd;
      while (insertAt > blockStart && lines[insertAt - 1].trim() === "") insertAt--;
      lines.splice(insertAt, 0, `**${field}:** ${value}`);
      blockEnd++;
    }
  }

  await writeFile(filePath, lines.join("\n"));
}
