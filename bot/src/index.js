import { handleCommand } from "./lib/commands.js";
import { sendMessage } from "./lib/telegram.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok", { status: 200 });

    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    let update;
    try { update = await request.json(); }
    catch { return new Response("bad json", { status: 400 }); }

    const msg = update.message;
    if (!msg || !msg.text) return new Response("ok");

    if (String(msg.chat.id) !== String(env.ALLOWED_CHAT_ID)) {
      console.log("dropped non-allowlisted chat", msg.chat.id);
      return new Response("ok");
    }

    ctx.waitUntil((async () => {
      try {
        await handleCommand(env, msg);
      } catch (e) {
        console.error("handler error:", e?.stack || e);
        try { await sendMessage(env, msg.chat.id, `error: ${e.message || e}`); } catch {}
      }
    })());

    return new Response("ok");
  },
};
