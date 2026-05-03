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
