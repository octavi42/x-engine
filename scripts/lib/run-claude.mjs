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

import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

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

async function writeTempMcpConfig({ servers }) {
  const dir = join(tmpdir(), `x-engine-${randomBytes(4).toString('hex')}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'mcp.json');
  await writeFile(path, JSON.stringify({ mcpServers: servers }, null, 2));
  return { path, dir };
}

// Runs `claude -p` and yields parsed stream-json events (line-delimited JSON).
// Returns { events, finalText, toolUses, exitCode }.
//
// Options:
//   prompt          — the user prompt (string)
//   systemPrompt    — overrides Claude Code's default system prompt
//   model           — e.g. 'claude-sonnet-4-6'
//   mcpServers      — { name: { command, args, env } } (writes to a temp config)
//   allowedTools    — array of tool patterns, e.g. ['mcp__peer_posts__*']
//   maxTurns        — caps the tool-use loop
//   cwd             — working dir for the subprocess
//   onEvent         — callback(event) for each parsed line
export async function runClaude({
  prompt,
  systemPrompt,
  model,
  mcpServers,
  allowedTools = [],
  maxTurns,
  cwd = process.cwd(),
  onEvent,
}) {
  ensureSubscriptionAuth();

  const { path: mcpConfigPath, dir: mcpDir } = await writeTempMcpConfig({ servers: mcpServers });

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose', // required when --output-format=stream-json
    '--mcp-config', mcpConfigPath,
  ];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (model) args.push('--model', model);
  if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
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

  const events = [];
  const toolUses = [];
  const textChunks = [];
  let stderrBuf = '';

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
      events.push(evt);
      handleEvent(evt, { toolUses, textChunks });
      if (onEvent) onEvent(evt);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', (err) => reject(new ClaudeRunError(`failed to spawn claude: ${err.message}`)));
    child.on('close', (code) => resolve(code ?? 0));
  });

  // Best-effort temp cleanup.
  await rm(mcpDir, { recursive: true, force: true }).catch(() => {});

  if (exitCode !== 0) {
    throw new ClaudeRunError(
      `claude -p exited ${exitCode}\nstderr:\n${stderrBuf.slice(-2000)}`
    );
  }

  return {
    events,
    toolUses,
    finalText: textChunks.join('').trim(),
    exitCode,
  };
}

// Walks a stream-json event and records tool_use blocks + text deltas.
// We are deliberately lenient about event shape — Claude Code's stream-json
// format is documented but evolves; we only inspect well-known fields.
function handleEvent(evt, { toolUses, textChunks }) {
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
