import { getFile, putFile } from "./github.js";
import { stampDraft, replaceBody } from "./drafts.js";

const REPO = "octavi42/x-engine";
const MODEL = "claude-haiku-4-5-20251001";

function todayPath() {
  return `drafts/${new Date().toISOString().slice(0, 10)}.md`;
}

const SYSTEM_PROMPT = `You are a Telegram bot for managing daily X/Twitter post drafts for @octavicristea.

You can: inspect, approve, reject, and edit drafts in today's file. Today's drafts are injected as context each turn. Use tools to make changes — never claim you've changed something without calling the corresponding tool.

When the user is ambiguous (e.g. "approve the autoplay one"), match on body content or project. If two drafts could match, ask which.

Reply rules:
- Telegram-style: short, plain prose. No markdown headers. Use <b> and <i> sparingly.
- Confirm changes by stating what changed (e.g. "🟢 #4 approved").
- When listing drafts, prefix with status emoji: ✅ posted, 🟢 approved, ❌ rejected, ⚪ no status.
- If the user asks to edit, propose the new text first only if they were vague; if they gave the exact replacement, just call the tool.
- Hard limit: tweet bodies are ≤280 chars. Reject edits that exceed this.
- The poster picks the next approved+unposted draft at scheduled times (12/16/20 UTC = 15/19/23 EEST).`;

const TOOLS = [
  {
    name: "set_status",
    description: "Set the Status field on a draft in today's file. Use 'approved' to queue for posting, 'rejected' to skip. The 1-based draft number is shown in the file as '## N. Title'.",
    input_schema: {
      type: "object",
      properties: {
        draft_index: { type: "number", description: "1-based draft number from the '## N. Title' headers" },
        status: { type: "string", enum: ["approved", "rejected"] },
      },
      required: ["draft_index", "status"],
    },
  },
  {
    name: "edit_body",
    description: "Replace the body (the '> ...' lines) of a draft in today's file with new text. Body must be ≤280 chars.",
    input_schema: {
      type: "object",
      properties: {
        draft_index: { type: "number" },
        new_body: { type: "string", description: "Full replacement text. ≤280 chars." },
      },
      required: ["draft_index", "new_body"],
    },
  },
];

async function callClaude(env, { messages }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body}`);
  }
  return res.json();
}

async function executeTool(env, name, input) {
  const path = todayPath();
  if (name === "set_status") {
    const file = await getFile(env, REPO, path);
    if (!file) return `error: no drafts file at ${path}`;
    let updated;
    try { updated = stampDraft(file.content, input.draft_index, { Status: input.status }); }
    catch (e) { return `error: ${e.message}`; }
    if (updated === file.content) return `#${input.draft_index} was already ${input.status}`;
    await putFile(env, REPO, path, updated, `bot: ${input.status} draft #${input.draft_index}`, file.sha);
    return `ok — set #${input.draft_index} status to ${input.status}`;
  }
  if (name === "edit_body") {
    if (typeof input.new_body !== "string" || !input.new_body.length) return "error: new_body required";
    if (input.new_body.length > 280) return `error: body is ${input.new_body.length}c, max 280`;
    const file = await getFile(env, REPO, path);
    if (!file) return `error: no drafts file at ${path}`;
    let updated;
    try { updated = replaceBody(file.content, input.draft_index, input.new_body); }
    catch (e) { return `error: ${e.message}`; }
    await putFile(env, REPO, path, updated, `bot: edit draft #${input.draft_index}`, file.sha);
    return `ok — replaced body of #${input.draft_index} (${input.new_body.length}c)`;
  }
  return `unknown tool: ${name}`;
}

export async function runAgent(env, userText) {
  const path = todayPath();
  const file = await getFile(env, REPO, path);
  const draftsContent = file?.content || "(no drafts file exists for today yet)";

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: `Current drafts file (${path}):\n\n${draftsContent}` },
        { type: "text", text: `User: ${userText}` },
      ],
    },
  ];

  for (let i = 0; i < 6; i++) {
    const res = await callClaude(env, { messages });

    if (res.stop_reason === "tool_use") {
      const toolUses = res.content.filter(c => c.type === "tool_use");
      const toolResults = [];
      for (const t of toolUses) {
        let result;
        try { result = await executeTool(env, t.name, t.input); }
        catch (e) { result = `error: ${e.message || e}`; }
        toolResults.push({ type: "tool_result", tool_use_id: t.id, content: result });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = res.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
    return text || "(no reply)";
  }

  return "agent loop limit reached — try a more specific request";
}
