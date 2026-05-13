#!/usr/bin/env node
// MCP stdio server for the draft-improve agent.
//
// Exposes two tools:
//   - submit_variants: writer emits 3 candidate rewrites + shared critique.
//   - submit_verdict:  judge ranks {original, A, B, C} and picks a winner.
//
// Each tool persists its payload to RESULT_FILE; the parent script
// (scripts/enhance.mjs) reads the file after `claude -p` exits. Same server,
// different result files per call — the writer pass and the judge pass each
// spawn their own claude -p with their own IMPROVE_RESULT_FILE.

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

async function appendResult(payload) {
  const existing = existsSync(RESULT_FILE)
    ? JSON.parse(await readFile(RESULT_FILE, 'utf8')).filter(Boolean)
    : [];
  existing.push({ ...payload, ts: new Date().toISOString() });
  await writeFile(RESULT_FILE, JSON.stringify(existing, null, 2));
  return existing.length;
}

const server = new McpServer({ name: 'improve', version: '2.0.0' });

const scoreSchema = z.object({
  specificity: z.number().int().min(1).max(5),
  hook: z.number().int().min(1).max(5),
  length: z.number().int().min(1).max(5),
  pattern_match: z.number().int().min(1).max(5),
});

server.registerTool(
  'submit_variants',
  {
    description:
      'Writer tool. Emit 3 candidate rewrites (A, B, C) with a shared critique of the original. Each variant names the archetype it uses and the mechanic that makes that archetype work. Text MAY contain newlines (and should, when the archetype calls for it). Call EXACTLY ONCE, then end your turn.',
    inputSchema: {
      critique: z
        .string()
        .describe('2-3 sentences naming what is weak in the original. Direct, no preamble.'),
      variants: z
        .array(
          z.object({
            label: z.enum(['A', 'B', 'C']),
            archetype: z
              .string()
              .describe('Name of the hook archetype, e.g. "introducing-X", "cause/fix", "I just replaced X with Y", "numbered gotchas".'),
            mechanic: z
              .string()
              .describe('One sentence: WHY this archetype fits this draft. What scroll-stop lever it pulls.'),
            text: z
              .string()
              .describe('The rewritten tweet. ≤ 280 chars including newlines. Newlines preserved.'),
            score: scoreSchema,
          })
        )
        .length(3),
    },
  },
  async ({ critique, variants }) => {
    const count = await appendResult({ kind: 'variants', critique, variants });
    return {
      content: [{ type: 'text', text: JSON.stringify({ received: true, count }) }],
    };
  }
);

server.registerTool(
  'submit_verdict',
  {
    description:
      'Judge tool. Given the original and the 3 candidate variants, rank all four (best-first) and pick a winner. If none of the variants meaningfully beats the original, pick "original" — do not refine for the sake of refining. Call EXACTLY ONCE, then end your turn.',
    inputSchema: {
      ranking: z
        .array(z.enum(['A', 'B', 'C', 'original']))
        .length(4)
        .describe('Best-first ordering of {A, B, C, original}. All four must appear exactly once.'),
      winner: z
        .enum(['A', 'B', 'C', 'original'])
        .describe('The winner. Must equal ranking[0]. Use "original" if no variant beats it.'),
      reasoning: z
        .string()
        .describe('1-2 sentences explaining what made the winner win (or why no variant beat the original).'),
      winner_score: scoreSchema,
    },
  },
  async ({ ranking, winner, reasoning, winner_score }) => {
    const count = await appendResult({ kind: 'verdict', ranking, winner, reasoning, winner_score });
    return {
      content: [{ type: 'text', text: JSON.stringify({ received: true, count }) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('improve MCP server connected\n');
