// Drives `claude -p` (Claude Code headless mode) as a subprocess so the
// research and improve agents bill against the user's Claude Pro/Max
// subscription instead of an Anthropic API key.
//
// Wire reference:
//  - https://code.claude.com/docs/en/headless
//  - https://code.claude.com/docs/en/cli-reference
//  - https://code.claude.com/docs/en/mcp
//
// Critical billing footgun (well documented incidents): if ANTHROPIC_API_KEY
// is set, the CLI silently uses API billing instead of OAuth. We require it
// to be unset (not just empty).

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

export class ClaudeAuthError extends Error {}
export class ClaudeRunError extends Error {}

export function ensureSubscriptionAuth() {
  if ('ANTHROPIC_API_KEY' in process.env && process.env.ANTHROPIC_API_KEY !== '') {
    throw new ClaudeAuthError(
      'ANTHROPIC_API_KEY is set in env. Claude Code would silently bill API ' +
        'instead of your subscription. Unset it (e.g., remove from .env.local) ' +
        'and retry. See https://github.com/anthropics/claude-code/issues/37686'
    );
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new ClaudeAuthError(
      'CLAUDE_CODE_OAUTH_TOKEN not set. Generate one with `claude setup-token` ' +
        '(while logged into your Pro/Max plan) and add it to .env.local.'
    );
  }
}

// Best-effort: ask the CLI which auth source it would use. Catches the case
// where a settings.json apiKeyHelper or ~/.claude.json entry would override
// the OAuth token even with a clean env. We treat any reference to an API
// key as a hard fail — when in doubt, don't bill the wrong account.
//
// Returns { ok: true } or { ok: false, reason }. Doesn't throw — the caller
// decides whether to surface this as a warning or abort.
export async function probeClaudeAuth(env = process.env) {
  try {
    const { stdout } = await execFileAsync('claude', ['auth', 'status'], {
      env: { ...env, ANTHROPIC_API_KEY: undefined },
      timeout: 10_000,
    });
    const lower = stdout.toLowerCase();
    if (lower.includes('api key') || lower.includes('api_key')) {
      return { ok: false, reason: `claude auth status mentions API key:\n${stdout.trim()}` };
    }
    return { ok: true, detail: stdout.trim() };
  } catch (err) {
    // `claude auth status` may not be a command on every CLI version.
    // Don't block the run on a missing subcommand — the env-only check is
    // already in place.
    return { ok: true, detail: `(claude auth status unavailable: ${err.message})` };
  }
}

async function writeTempMcpConfig({ servers }) {
  // The config file embeds env blocks (incl. twitterapi.io key). Lock the
  // dir + file modes so it's not world-readable on shared machines.
  const dir = join(tmpdir(), `x-engine-${randomBytes(4).toString('hex')}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'mcp.json');
  await writeFile(path, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });
  return { path, dir };
}

// Default deny-list for Claude Code's built-in tools. We want the agent
// strictly confined to MCP tools registered in mcpServers; without this the
// agent has been observed reaching for Bash to "respect rate limits" via
// `sleep`, looping for minutes silently. ToolSearch must remain because
// Claude Code uses it to load MCP tool schemas on demand.
const DEFAULT_DISALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'KillBash',
  'NotebookEdit',
  'SlashCommand',
];

// Runs `claude -p` and yields parsed stream-json events (line-delimited JSON).
// Returns { finalText, toolUses, exitCode }.
//
// We always pass --permission-mode bypassPermissions + a deny-list for the
// built-in tools. Allow-listing patterns alone is fragile (server-name
// hyphen normalization, missing __* wildcards), and bypassPermissions on
// its own opens Bash/Read/Write to the agent.
//
// Options:
//   prompt           — the user prompt (string)
//   systemPrompt     — overrides Claude Code's default system prompt
//   model            — e.g. 'claude-sonnet-4-6'
//   mcpServers       — { name: { command, args, env } } (writes to a temp config)
//   maxTurns         — caps the tool-use loop
//   disallowedTools  — extra tools to block (default list above is always added)
//   cwd              — working dir for the subprocess
//   onEvent          — callback(event) for each parsed line
//   verbose          — if true, mirror tool calls + text to stderr live
export async function runClaude({
  prompt,
  systemPrompt,
  model,
  mcpServers,
  maxTurns,
  disallowedTools = [],
  cwd = process.cwd(),
  onEvent,
  verbose = false,
}) {
  ensureSubscriptionAuth();

  const { path: mcpConfigPath, dir: mcpDir } = await writeTempMcpConfig({ servers: mcpServers });

  const denyList = [...new Set([...DEFAULT_DISALLOWED_TOOLS, ...disallowedTools])];

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose', // required when --output-format=stream-json
    '--mcp-config', mcpConfigPath,
    '--permission-mode', 'bypassPermissions',
    '--disallowedTools', denyList.join(','),
  ];
  // Pass the system prompt via a file rather than --system-prompt <string>.
  // The system prompt is built from many sources (voice + projects + every
  // sources/*/latest.md + archive) and can easily exceed Linux's ARG_MAX
  // (~128KB total argv+envp) once enough days of trending data accumulate,
  // causing `spawn E2BIG`. The file path keeps argv small regardless of size.
  if (systemPrompt) {
    const systemPromptPath = join(mcpDir, 'system-prompt.txt');
    await writeFile(systemPromptPath, systemPrompt, { mode: 0o600 });
    args.push('--system-prompt-file', systemPromptPath);
  }
  if (model) args.push('--model', model);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  args.push(prompt);

  // Strip ANTHROPIC_API_KEY from the child env defensively (in addition to
  // the pre-flight check) — some env-loading tools silently re-inject it.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;

  const child = spawn('claude', args, {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const toolUses = [];
  const textChunks = [];
  let stderrBuf = '';
  const startTs = Date.now();
  let lastEventTs = startTs;

  // Heartbeat: every 15s with no events from claude, print elapsed time so
  // the user can tell "stuck" from "model is thinking." Cleared on exit.
  const heartbeat = setInterval(() => {
    if (!verbose) return;
    const idle = Date.now() - lastEventTs;
    if (idle >= 15_000) {
      const total = ((Date.now() - startTs) / 1000).toFixed(0);
      process.stderr.write(`[heartbeat] ${total}s elapsed · ${(idle / 1000).toFixed(0)}s idle\n`);
    }
  }, 15_000);

  let pendingLine = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pendingLine += chunk;
    const lines = pendingLine.split('\n');
    pendingLine = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      lastEventTs = Date.now();
      handleEvent(evt, { toolUses, textChunks });
      if (verbose) mirrorToStderr(evt);
      if (onEvent) onEvent(evt);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk;
  });

  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.on('error', (err) => reject(new ClaudeRunError(`failed to spawn claude: ${err.message}`)));
      child.on('close', (code) => resolve(code ?? 0));
    });
  } finally {
    // Always clear; otherwise a spawn ENOENT (or any rejection) leaks the
    // interval and keeps the event loop alive until the parent runner
    // kills the process.
    clearInterval(heartbeat);
    await rm(mcpDir, { recursive: true, force: true }).catch(() => {});
  }

  if (exitCode !== 0) {
    throw new ClaudeRunError(
      `claude -p exited ${exitCode}\nstderr:\n${stderrBuf.slice(-2000)}`
    );
  }

  return {
    toolUses,
    finalText: textChunks.join('').trim(),
    exitCode,
  };
}

// Mirrors interesting events to stderr for live diagnosis. When the agent
// hangs, stdout shows only tool_use; stderr now also shows model "thoughts"
// (text deltas), tool errors, and result events with cost/duration.
function mirrorToStderr(evt) {
  if (evt.type === 'assistant' && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        process.stderr.write(`[think] ${block.text.replace(/\s+/g, ' ').slice(0, 240)}\n`);
      }
    }
  }
  if (evt.type === 'user' && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === 'tool_result' && block.is_error) {
        const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        process.stderr.write(`[tool-error] ${text.slice(0, 240)}\n`);
      }
    }
  }
  if (evt.type === 'result') {
    const cost = evt.total_cost_usd ?? evt.usage?.total_cost_usd;
    const duration = evt.duration_ms;
    process.stderr.write(`[result] ${evt.subtype ?? 'done'} · ${duration ? `${(duration / 1000).toFixed(1)}s` : ''} · $${cost ?? '—'}\n`);
  }
}

// Walks a stream-json event and records tool_use blocks + text deltas.
// We are deliberately lenient about event shape — Claude Code's stream-json
// format is documented but evolves; we only inspect well-known fields.
// Exported for unit testing.
export function handleEvent(evt, { toolUses, textChunks }) {
  // The `assistant` event wraps a full message with content blocks.
  if (evt.type === 'assistant' && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      } else if (block.type === 'text' && typeof block.text === 'string') {
        textChunks.push(block.text);
      }
    }
  }
  // Some versions emit text via stream_event content_block_delta.text_delta.
  if (evt.type === 'stream_event' && evt.event?.delta?.type === 'text_delta') {
    textChunks.push(evt.event.delta.text ?? '');
  }
}
