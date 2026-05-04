#!/usr/bin/env node
// MCP stdio server for the draft-improve agent.
//
// Exposes one tool, `submit_critique`, that captures the structured score +
// critique + refined rewrite into a per-run result file. The parent script
// (scripts/enhance.mjs) reads this file after `claude -p` exits.

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const RESULT_FILE = process.env.IMPROVE_RESULT_FILE;
if (!RESULT_FILE) {
  process.stderr.write('improve MCP server: missing env IMPROVE_RESULT_FILE\n');
  process.exit(1);
}

const server = new McpServer({ name: 'improve', version: '1.0.0' });

server.registerTool(
  'submit_critique',
  {
    description:
      'Emit the structured critique + refined rewrite. Call exactly once. After this, end your turn — do not output additional text.',
    inputSchema: {
      score: z.object({
        specificity: z.number().int().min(1).max(5),
        hook: z.number().int().min(1).max(5),
        length: z.number().int().min(1).max(5),
        pattern_match: z.number().int().min(1).max(5),
      }),
      critique: z.string().describe('2-3 sentence direct critique'),
      refined: z
        .string()
        .describe('The rewritten tweet, single line, ≤ 280 chars. No preamble.'),
    },
  },
  async ({ score, critique, refined }) => {
    const existing = existsSync(RESULT_FILE)
      ? JSON.parse(await readFile(RESULT_FILE, 'utf8')).filter(Boolean)
      : [];
    existing.push({ score, critique, refined, ts: new Date().toISOString() });
    await writeFile(RESULT_FILE, JSON.stringify(existing, null, 2));
    return {
      content: [{ type: 'text', text: JSON.stringify({ received: true, count: existing.length }) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('improve MCP server connected\n');
