export function parseDrafts(content) {
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
    if (projMatch) { title = projMatch[1].trim(); project = projMatch[2].trim(); }

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
      index,
      title,
      project: project || metadata.project || null,
      body,
      status: metadata.status || "",
      posted: metadata.posted || "",
      type: metadata.type || "",
    });
  }
  return drafts;
}

export function stampDraft(content, draftIndex, updates) {
  const lines = content.split("\n");
  const headerRe = new RegExp(`^## ${draftIndex}\\.\\s`);
  const blockStart = lines.findIndex(l => headerRe.test(l));
  if (blockStart === -1) throw new Error(`Draft #${draftIndex} not found`);

  let blockEnd = lines.length;
  for (let j = blockStart + 1; j < lines.length; j++) {
    if (lines[j].startsWith("## ") || lines[j].trim() === "---") { blockEnd = j; break; }
  }

  for (const [field, value] of Object.entries(updates)) {
    const fieldRe = new RegExp(`^\\*\\*${field}:\\*\\*`, "i");
    let updated = false;
    for (let j = blockStart; j < blockEnd; j++) {
      if (fieldRe.test(lines[j])) {
        lines[j] = `**${field}:** ${value}`;
        updated = true; break;
      }
    }
    if (!updated) {
      let insertAt = blockEnd;
      while (insertAt > blockStart && lines[insertAt - 1].trim() === "") insertAt--;
      lines.splice(insertAt, 0, `**${field}:** ${value}`);
      blockEnd++;
    }
  }
  return lines.join("\n");
}

export function replaceBody(content, draftIndex, newBody) {
  const lines = content.split("\n");
  const headerRe = new RegExp(`^## ${draftIndex}\\.\\s`);
  const blockStart = lines.findIndex(l => headerRe.test(l));
  if (blockStart === -1) throw new Error(`Draft #${draftIndex} not found`);

  let bodyStart = blockStart + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++;

  let bodyEnd = bodyStart;
  while (bodyEnd < lines.length && lines[bodyEnd].startsWith("> ")) bodyEnd++;

  if (bodyStart === bodyEnd) throw new Error(`Draft #${draftIndex} has no body to replace`);

  const newBodyLines = newBody.split("\n").map(l => `> ${l}`);
  lines.splice(bodyStart, bodyEnd - bodyStart, ...newBodyLines);
  return lines.join("\n");
}
