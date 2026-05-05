#!/usr/bin/env node
// MCP stdio server for the comment-suggestion agent.
//
// Exposes one tool, `submit_suggestion`, that captures the suggested reply
// (single line, ≤200 chars) plus a one-line reasoning into a per-run result
// file. The parent script (scripts/hunt.mjs) reads this file after
// `claude -p` exits. Same pattern as mcp-servers/improve/server.mjs.

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const RESULT_FILE = process.env.COMMENT_RESULT_FILE;
if (!RESULT_FILE) {
  process.stderr.write('comment MCP server: missing env COMMENT_RESULT_FILE\n');
  process.exit(1);
}

const server = new McpServer({ name: 'comment', version: '1.0.0' });

server.registerTool(
  'submit_suggestion',
  {
    description:
      'Emit the suggested reply for the given tweet. Call exactly once. After this, end your turn — do not output additional text.',
    inputSchema: {
      comment: z
        .string()
        .describe('Single-line reply, ≤200 chars. No emoji, no @mentions, no hashtags, no links.'),
      reasoning: z
        .string()
        .describe('One sentence: why this reply works for this tweet (pattern, hook, angle).'),
    },
  },
  async ({ comment, reasoning }) => {
    const existing = existsSync(RESULT_FILE)
      ? JSON.parse(await readFile(RESULT_FILE, 'utf8')).filter(Boolean)
      : [];
    existing.push({ comment, reasoning, ts: new Date().toISOString() });
    await writeFile(RESULT_FILE, JSON.stringify(existing, null, 2));
    return {
      content: [{ type: 'text', text: JSON.stringify({ received: true, count: existing.length }) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('comment MCP server connected\n');
