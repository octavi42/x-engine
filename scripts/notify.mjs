#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseDraftFile } from "./lib/parse-drafts.mjs";

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, "drafts");
const REPO = "octavi42/x-engine";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error("missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function findNext() {
  const files = (await readdir(DRAFTS_DIR)).filter(f => f.endsWith(".md")).sort();
  for (const f of files) {
    const drafts = await parseDraftFile(path.join(DRAFTS_DIR, f));
    for (const d of drafts) {
      if (d.status?.toLowerCase() === "approved" && !d.posted) return d;
    }
  }
  return null;
}

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    console.error("telegram api error:", JSON.stringify(json));
    process.exit(1);
  }
  return json;
}

async function main() {
  const next = await findNext();
  if (!next) {
    console.log("no candidates — silent");
    return;
  }
  const file = path.basename(next.filePath);
  const editUrl = `https://github.com/${REPO}/edit/main/drafts/${file}`;
  const project = next.project || "general";
  const body = escapeHtml(next.body);
  const msg = [
    `<b>Posting in ~1h</b>`,
    ``,
    body,
    ``,
    `<i>${next.body.length}c · ${escapeHtml(project)}</i>`,
    ``,
    `<a href="${editUrl}">Edit / reject on GitHub</a>`,
  ].join("\n");
  await send(msg);
  console.log(`notified: ${file} #${next.index} (${next.body.length}c)`);
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });
