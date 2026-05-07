import { sendMessage, deleteMessages, escapeHtml, sanitizeTelegramHtml } from "./telegram.js";
import { getFile, putFile } from "./github.js";
import { parseDrafts, stampDraft, replaceBody } from "./drafts.js";
import { runAgent, clearHistory } from "./llm.js";

const REPO = "octavi42/x-engine";
const MSGS_KEY = (chatId) => `msgs:${chatId}`;
const MSGS_TTL = 60 * 60 * 24 * 7;
const MAX_TRACKED = 1000;

function todayPath() {
  return `drafts/${new Date().toISOString().slice(0, 10)}.md`;
}

async function trackMessageId(env, chatId, messageId) {
  if (!env.CHAT_HISTORY || !messageId) return;
  const raw = await env.CHAT_HISTORY.get(MSGS_KEY(chatId));
  const ids = raw ? JSON.parse(raw) : [];
  ids.push(messageId);
  const trimmed = ids.length > MAX_TRACKED ? ids.slice(-MAX_TRACKED) : ids;
  await env.CHAT_HISTORY.put(MSGS_KEY(chatId), JSON.stringify(trimmed), { expirationTtl: MSGS_TTL });
}

async function loadTrackedMessages(env, chatId) {
  if (!env.CHAT_HISTORY) return [];
  const raw = await env.CHAT_HISTORY.get(MSGS_KEY(chatId));
  return raw ? JSON.parse(raw) : [];
}

async function clearTrackedMessages(env, chatId) {
  if (!env.CHAT_HISTORY) return;
  await env.CHAT_HISTORY.delete(MSGS_KEY(chatId));
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

  await trackMessageId(env, chatId, msg.message_id);

  if (text === "/start" || text === "/help") return reply(env, chatId, helpText());
  if (text === "/today") return cmdToday(env, chatId);
  if (text === "/queue") return cmdQueue(env, chatId);
  if (text === "/clear") return cmdClear(env, chatId);

  const m = text.match(/^\/(approve|reject)\s+(\d+)\s*$/);
  if (m) return cmdSetStatus(env, chatId, Number(m[2]), m[1] === "approve" ? "approved" : "rejected");

  const e = text.match(/^\/edit\s+(\d+)\s*[:：]\s*([\s\S]+)$/);
  if (e) return cmdEdit(env, chatId, Number(e[1]), e[2].trim());

  if (text.startsWith("/")) return reply(env, chatId, "unknown command — try /help");

  const agentReply = await runAgent(env, chatId, text);
  // LLM output is free-form — may contain stray "<" (e.g. "<3s") that the
  // HTML parser rejects. Sanitize while preserving allowed Telegram tags.
  return reply(env, chatId, sanitizeTelegramHtml(agentReply));
}

function helpText() {
  return [
    "<b>Commands</b>",
    "/today — list today's drafts with status",
    "/queue — list approved + unposted (next-up first)",
    "/approve N — approve draft #N",
    "/reject N — reject draft #N",
    "/edit N: new body — replace body of draft #N",
    "/clear — wipe the bot's conversation memory",
    "/help — this message",
    "",
    "<i>All edits target today's drafts file.</i>",
  ].join("\n");
}

async function reply(env, chatId, text) {
  const sent = await sendMessage(env, chatId, text);
  if (sent?.message_id) await trackMessageId(env, chatId, sent.message_id);
  return sent;
}

async function cmdClear(env, chatId) {
  const ids = await loadTrackedMessages(env, chatId);
  await clearHistory(env, chatId);
  await clearTrackedMessages(env, chatId);
  if (ids.length) {
    await deleteMessages(env, chatId, ids);
  }
  // No confirmation message — chat is wiped, that's the confirmation.
  // (Telegram silently skips messages older than 48h; we can't recover those.)
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
