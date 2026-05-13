import { readFile } from "node:fs/promises";

export async function parseDraftFile(filePath) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");

  const drafts = [];
  let i = 0;
  while (i < lines.length) {
    const headerMatch = lines[i].match(/^## (\d+)\.\s+(.+?)\s*$/);
    if (!headerMatch) { i++; continue; }

    const index = Number(headerMatch[1]);
    let title = headerMatch[2];
    let project = null;
    const projMatch = title.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (projMatch) {
      title = projMatch[1].trim();
      project = projMatch[2].trim();
    }

    i++;
    while (i < lines.length && lines[i].trim() === "") i++;

    const bodyLines = [];
    while (i < lines.length && lines[i].startsWith("> ")) {
      bodyLines.push(lines[i].slice(2));
      i++;
    }
    const body = bodyLines.join("\n").trim();

    const metadata = {};
    while (i < lines.length) {
      const cur = lines[i];
      if (cur.startsWith("## ") || cur.trim() === "---") break;
      const fm = cur.match(/^\*\*([^:*]+):\*\*\s*(.*?)\s*$/);
      if (fm) {
        const key = fm[1].toLowerCase().trim();
        const inline = fm[2].trim();
        // Multi-line block form: `**Field:**` alone on its line, followed
        // (optionally after blank lines) by `> `-prefixed lines, which
        // we collect as the field value joined by \n (preserving blank
        // lines as empty strings). Used for Refined when the rewrite has
        // line breaks. Legacy single-line `**Field:** value` still works.
        if (inline === "") {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === "") j++;
          if (j < lines.length && lines[j].startsWith("> ")) {
            const collected = [];
            while (j < lines.length && lines[j].startsWith(">")) {
              collected.push(lines[j].startsWith("> ") ? lines[j].slice(2) : lines[j].slice(1));
              j++;
            }
            metadata[key] = collected.join("\n").replace(/\n+$/, "");
            i = j;
            continue;
          }
        }
        metadata[key] = inline;
      }
      i++;
    }

    drafts.push({
      filePath,
      index,
      title,
      project: project || metadata.project || null,
      body,
      status: metadata.status || "",
      posted: metadata.posted || "",
      tweetUrl: metadata.tweeturl || "",
      type: metadata.type || "",
      source: metadata.source || "",
      refined: metadata.refined || "",
      score: metadata.score || "",
      critique: metadata.critique || "",
    });
  }

  return drafts;
}
