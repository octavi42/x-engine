import { sendMessage, escapeHtml } from "./telegram.js";
import { getFile, putFile } from "./github.js";
import { parseDrafts, stampDraft, replaceBody } from "./drafts.js";

const REPO = "octavi42/x-engine";

function todayPath() {
  return `drafts/${new Date().toISOString().slice(0, 10)}.md`;
}

function statusEmoji(d) {
  if (d.posted) return "✅";
  const s = (d.status || "").toLowerCase();
  if (s === "approved") return "🟢";
  if (s === "rejected") return "❌";
  return "⚪";
}

export async function handleCommand(env, msg) {
  const text = msg.text.trim();
  const chatId = msg.chat.id;

  if (text === "/start" || text === "/help") return reply(env, chatId, helpText());
  if (text === "/today") return cmdToday(env, chatId);
  if (text === "/queue") return cmdQueue(env, chatId);

  const m = text.match(/^\/(approve|reject)\s+(\d+)\s*$/);
  if (m) return cmdSetStatus(env, chatId, Number(m[2]), m[1] === "approve" ? "approved" : "rejected");

  const e = text.match(/^\/edit\s+(\d+)\s*[:：]\s*([\s\S]+)$/);
  if (e) return cmdEdit(env, chatId, Number(e[1]), e[2].trim());

  return reply(env, chatId, "unknown command — try /help");
}

function helpText() {
  return [
    "<b>Commands</b>",
    "/today — list today's drafts with status",
    "/queue — list approved + unposted (next-up first)",
    "/approve N — approve draft #N",
    "/reject N — reject draft #N",
    "/edit N: new body — replace body of draft #N",
    "/help — this message",
    "",
    "<i>All edits target today's drafts file.</i>",
  ].join("\n");
}

async function reply(env, chatId, text) {
  await sendMessage(env, chatId, text);
}

async function cmdToday(env, chatId) {
  const path = todayPath();
  const file = await getFile(env, REPO, path);
  if (!file) return reply(env, chatId, `no drafts file at <code>${escapeHtml(path)}</code>`);
  const drafts = parseDrafts(file.content);
  if (!drafts.length) return reply(env, chatId, "today's file has no drafts");
  const lines = [`<b>${escapeHtml(path)}</b>`, ""];
  for (const d of drafts) {
    lines.push(`${statusEmoji(d)} <b>#${d.index}</b> · ${d.body.length}c · ${escapeHtml(d.project || "general")}`);
    const preview = d.body.length > 100 ? d.body.slice(0, 97) + "..." : d.body;
    lines.push(escapeHtml(preview), "");
  }
  await reply(env, chatId, lines.join("\n"));
}

async function cmdQueue(env, chatId) {
  const path = todayPath();
  const file = await getFile(env, REPO, path);
  if (!file) return reply(env, chatId, "queue empty (no drafts file today)");
  const drafts = parseDrafts(file.content)
    .filter(d => d.status?.toLowerCase() === "approved" && !d.posted);
  if (!drafts.length) return reply(env, chatId, "queue empty");
  const lines = ["<b>Queue (next-up first)</b>", ""];
  for (const d of drafts) {
    lines.push(`🟢 <b>#${d.index}</b> · ${d.body.length}c · ${escapeHtml(d.project || "general")}`);
    lines.push(escapeHtml(d.body), "");
  }
  await reply(env, chatId, lines.join("\n"));
}

async function cmdSetStatus(env, chatId, n, status) {
  const path = todayPath();
  const file = await getFile(env, REPO, path);
  if (!file) return reply(env, chatId, `no drafts file at <code>${escapeHtml(path)}</code>`);
  let updated;
  try { updated = stampDraft(file.content, n, { Status: status }); }
  catch (e) { return reply(env, chatId, `error: ${escapeHtml(e.message)}`); }
  if (updated === file.content) return reply(env, chatId, `#${n} is already <b>${status}</b>`);
  await putFile(env, REPO, path, updated, `bot: ${status} draft #${n}`, file.sha);
  const emo = status === "approved" ? "🟢" : "❌";
  await reply(env, chatId, `${emo} #${n} → <b>${status}</b>`);
}

async function cmdEdit(env, chatId, n, newBody) {
  if (newBody.length > 280) return reply(env, chatId, `body is ${newBody.length}c, max 280`);
  const path = todayPath();
  const file = await getFile(env, REPO, path);
  if (!file) return reply(env, chatId, `no drafts file at <code>${escapeHtml(path)}</code>`);
  let updated;
  try { updated = replaceBody(file.content, n, newBody); }
  catch (e) { return reply(env, chatId, `error: ${escapeHtml(e.message)}`); }
  await putFile(env, REPO, path, updated, `bot: edit draft #${n}`, file.sha);
  await reply(env, chatId, `✏️ #${n} updated (${newBody.length}c)`);
}
