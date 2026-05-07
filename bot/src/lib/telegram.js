export async function sendMessage(env, chatId, text, opts = {}) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...opts,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    console.error("telegram sendMessage error", res.status, JSON.stringify(json));
    return null;
  }
  return json.result;
}

export async function deleteMessages(env, chatId, messageIds) {
  if (!messageIds.length) return;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessages`;
  for (let i = 0; i < messageIds.length; i += 100) {
    const batch = messageIds.slice(i, i + 100);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_ids: batch }),
    });
    if (!res.ok) {
      console.error("deleteMessages error", res.status, await res.text());
    }
  }
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Sanitize free-form text (e.g. LLM output) for sendMessage's parse_mode=HTML.
// Preserves Telegram's allowed tags (b, i, u, s, code, pre, a, etc.) and
// escapes everything else. Without this, model output containing "<3s" or
// raw "<" tanks the entire message with "Bad Request: can't parse entities".
const ALLOWED_TAG = /^(b|strong|i|em|u|ins|s|strike|del|tg-spoiler|code|pre|a|blockquote)$/i;
export function sanitizeTelegramHtml(s) {
  const src = String(s);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "&") {
      const m = src.slice(i).match(/^&(amp|lt|gt|quot|#\d+);/);
      if (m) { out += m[0]; i += m[0].length; }
      else { out += "&amp;"; i++; }
    } else if (ch === "<") {
      const m = src.slice(i).match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/);
      if (m && ALLOWED_TAG.test(m[1])) {
        out += m[0];
        i += m[0].length;
      } else {
        out += "&lt;";
        i++;
      }
    } else if (ch === ">") {
      out += "&gt;";
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
