#!/usr/bin/env node
// MCP stdio server for the drafting agent.
//
// Exposes one tool, `submit_drafts`, that captures the structured batch of
// drafts (single tweets + threads) into a result file the parent reads
// after `claude -p` exits. Same pattern as mcp-servers/improve/server.mjs.

import { writeFile } from 'node:fs/promises';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const RESULT_FILE = process.env.DRAFT_RESULT_FILE;
if (!RESULT_FILE) {
  process.stderr.write('draft MCP server: missing env DRAFT_RESULT_FILE\n');
  process.exit(1);
}

const server = new McpServer({ name: 'draft', version: '1.0.0' });

const threadPostSchema = z.object({
  label: z
    .string()
    .describe('Sub-section label like "Hook (post 1)" or "Post 2 — pre-fire next episode"'),
  body: z.string().describe('The post body, ≤280 chars. Use real newlines for X readability.'),
});

const draftSchema = z.object({
  title: z
    .string()
    .describe(
      'Draft heading text shown after "## N. " — a short descriptor like "Building in public — Road to SF (Narrator lobby)"'
    ),
  type: z
    .string()
    .describe(
      'Type label, e.g. "building in public — latency hiding via product", "technical tip — AI voice apps", "trending reaction", "engagement question", "thread hook"'
    ),
  source: z
    .string()
    .describe('Provenance — which sources/files inspired this draft (single line, references welcome)'),
  project: z
    .string()
    .describe('One of the project names from config/projects/*.md, or "general" for cross-project posts'),
  gap_addressed: z
    .string()
    .optional()
    .describe('If this draft fills a content gap, which one. Optional.'),
  body: z
    .string()
    .optional()
    .describe('Single-tweet body. ≤280 chars. Real newlines for breathing room. Either body OR thread_posts must be provided.'),
  thread_posts: z
    .array(threadPostSchema)
    .min(2)
    .max(8)
    .optional()
    .describe(
      'For a thread: 2-8 posts. Each ≤280 chars. The first post must work standalone as a hook.'
    ),
});

server.registerTool(
  'submit_drafts',
  {
    description:
      'Emit the structured batch of drafts. Call exactly once when done drafting. End your turn after this call.',
    inputSchema: {
      intro: z
        .string()
        .optional()
        .describe(
          'A short summary paragraph (1-3 sentences) that goes at the top of the file as a `> blockquote`, describing what was drafted and why (sources used, content gaps addressed).'
        ),
      drafts: z
        .array(draftSchema)
        .min(1)
        .max(8)
        .describe('4-6 drafts is typical. Mix types. Tag each with project + provenance.'),
    },
  },
  async ({ intro, drafts }) => {
    // Lightweight validation — char count + must-have-body-or-thread.
    const errors = [];
    drafts.forEach((d, i) => {
      const tag = `#${i + 1}`;
      if (!d.body && !d.thread_posts) errors.push(`${tag}: missing body and thread_posts`);
      if (d.body && d.body.length > 280) errors.push(`${tag}: body ${d.body.length} > 280 chars`);
      if (d.thread_posts) {
        d.thread_posts.forEach((p, j) => {
          if (p.body.length > 280) errors.push(`${tag}.post${j + 1}: body ${p.body.length} > 280 chars`);
        });
      }
    });
    if (errors.length) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accepted: false,
              errors,
              hint: 'Fix the issues and call submit_drafts again with the full corrected batch.',
            }),
          },
        ],
        isError: true,
      };
    }

    await writeFile(RESULT_FILE, JSON.stringify({ intro: intro ?? null, drafts }, null, 2));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            accepted: true,
            count: drafts.length,
            result_file: RESULT_FILE,
          }),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('draft MCP server connected\n');
