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
      if (fm) metadata[fm[1].toLowerCase().trim()] = fm[2].trim();
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
