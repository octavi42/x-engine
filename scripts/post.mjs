#!/usr/bin/env node
import { readdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { parseDraftFile } from "./lib/parse-drafts.mjs";
import { stampDraft } from "./lib/stamp-draft.mjs";

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, "drafts");
const ARCHIVE_PATH = path.join(ROOT, "posted/archive.md");
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN ?? 3);
const CHAR_LIMIT = 280;
const DRY = process.argv.includes("--dry");

async function findCandidates() {
  const files = (await readdir(DRAFTS_DIR)).filter(f => f.endsWith(".md"));
  const all = [];
  for (const f of files) {
    const drafts = await parseDraftFile(path.join(DRAFTS_DIR, f));
    all.push(...drafts);
  }
  return all.filter(d => d.status.toLowerCase() === "approved" && !d.posted);
}

function validate(candidates) {
  const errors = [];
  if (candidates.length === 0) errors.push("No drafts marked Status: approved (with empty Posted).");
  if (candidates.length > MAX_PER_RUN) errors.push(`Too many candidates (${candidates.length}); cap is ${MAX_PER_RUN} per run.`);
  for (const c of candidates) {
    const file = path.basename(c.filePath);
    if (!c.body) errors.push(`[${file} #${c.index}] empty body.`);
    if (c.body.length > CHAR_LIMIT) errors.push(`[${file} #${c.index}] ${c.body.length} chars > ${CHAR_LIMIT}.`);
  }
  return errors;
}

function preview(c) {
  const file = path.basename(c.filePath);
  const trim = c.body.length > 70 ? c.body.slice(0, 67) + "..." : c.body;
  return `  [${file} #${c.index}] (${c.body.length}c) ${trim}`;
}

async function archive(c, tweetUrl) {
  const today = new Date().toISOString().slice(0, 10);
  const block = [
    "",
    `## ${today}`,
    `> ${c.body.replace(/\n/g, "\n> ")}`,
    "",
    `URL: ${tweetUrl}`,
    `Project: ${c.project || "general"}`,
    "Likes: — | Reposts: — | Replies: — | Notes:",
    "",
  ].join("\n");
  await appendFile(ARCHIVE_PATH, block);
}

async function main() {
  console.log(DRY ? "[DRY RUN]" : "[LIVE POST]");

  const candidates = await findCandidates();
  const errors = validate(candidates);
  if (errors.length) {
    console.error("Validation failed:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  console.log(`Plan: ${candidates.length} draft${candidates.length === 1 ? "" : "s"}`);
  for (const c of candidates) console.log(preview(c));

  if (DRY) {
    console.log("(dry run, no posts made)");
    return;
  }

  const { tweet } = await import("./lib/x-client.mjs");

  for (const c of candidates) {
    const file = path.basename(c.filePath);
    console.log(`-> Posting [${file} #${c.index}]...`);
    let result;
    try {
      result = await tweet(c.body);
    } catch (e) {
      console.error(`  X tweet failed: ${e.message}`);
      console.error("  Aborting. No state changed for this draft.");
      process.exit(1);
    }
    console.log(`  posted: ${result.url}`);
    try {
      await stampDraft({
        filePath: c.filePath,
        draftIndex: c.index,
        updates: { Posted: new Date().toISOString(), TweetURL: result.url },
      });
      await archive(c, result.url);
    } catch (e) {
      console.error(`  ! tweet posted (${result.url}) but stamp/archive failed: ${e.message}`);
      console.error(`  manually add **Posted:** + **TweetURL:** to draft ${file} #${c.index} to prevent re-posting.`);
      process.exit(1);
    }
    console.log("  stamped + archived");
  }

  console.log(`done. ${candidates.length} posted.`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
