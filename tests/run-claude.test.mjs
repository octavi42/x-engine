import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSubscriptionAuth, handleEvent, ClaudeAuthError } from '../scripts/lib/run-claude.mjs';

// ----- ensureSubscriptionAuth -----

test('ensureSubscriptionAuth rejects when ANTHROPIC_API_KEY is set', () => {
  const orig = { ...process.env };
  try {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-foo';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-bar';
    assert.throws(() => ensureSubscriptionAuth(), ClaudeAuthError);
  } finally {
    Object.assign(process.env, orig);
    if (!('ANTHROPIC_API_KEY' in orig)) delete process.env.ANTHROPIC_API_KEY;
  }
});

test('ensureSubscriptionAuth rejects when CLAUDE_CODE_OAUTH_TOKEN is missing', () => {
  const orig = { ...process.env };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    assert.throws(() => ensureSubscriptionAuth(), ClaudeAuthError);
  } finally {
    Object.assign(process.env, orig);
  }
});

test('ensureSubscriptionAuth passes when only OAuth token is set', () => {
  const orig = { ...process.env };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-bar';
    assert.doesNotThrow(() => ensureSubscriptionAuth());
  } finally {
    Object.assign(process.env, orig);
  }
});

test('ensureSubscriptionAuth treats empty-string ANTHROPIC_API_KEY as unset', () => {
  const orig = { ...process.env };
  try {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-bar';
    assert.doesNotThrow(() => ensureSubscriptionAuth());
  } finally {
    Object.assign(process.env, orig);
  }
});

// ----- handleEvent (stream-json parser) -----

function emptyAccum() {
  return { toolUses: [], textChunks: [] };
}

test('handleEvent extracts tool_use blocks from assistant messages', () => {
  const acc = emptyAccum();
  handleEvent(
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'mcp__peer_posts__list_seeds', input: {} },
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 'toolu_2', name: 'mcp__peer_posts__fetch_user_tweets', input: { handle: 'levelsio' } },
        ],
      },
    },
    acc
  );
  assert.equal(acc.toolUses.length, 2);
  assert.deepEqual(acc.toolUses[0], { id: 'toolu_1', name: 'mcp__peer_posts__list_seeds', input: {} });
  assert.equal(acc.toolUses[1].input.handle, 'levelsio');
  assert.deepEqual(acc.textChunks, ['thinking...']);
});

test('handleEvent collects text from stream_event content_block_delta', () => {
  const acc = emptyAccum();
  handleEvent({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'hello ' } } }, acc);
  handleEvent({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'world' } } }, acc);
  assert.deepEqual(acc.textChunks, ['hello ', 'world']);
});

test('handleEvent ignores unrelated event types', () => {
  const acc = emptyAccum();
  handleEvent({ type: 'system', subtype: 'init' }, acc);
  handleEvent({ type: 'result', subtype: 'success', total_cost_usd: 0.01 }, acc);
  handleEvent({ type: 'user', message: { content: [{ type: 'tool_result' }] } }, acc);
  assert.equal(acc.toolUses.length, 0);
  assert.equal(acc.textChunks.length, 0);
});

test('handleEvent is defensive against missing fields', () => {
  const acc = emptyAccum();
  // No throws on partial events
  handleEvent({ type: 'assistant' }, acc);
  handleEvent({ type: 'assistant', message: {} }, acc);
  handleEvent({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }, acc);
  handleEvent({ type: 'stream_event', event: {} }, acc);
  // Tool_use without input is still recorded — name may be enough for logging
  assert.equal(acc.toolUses.length, 1);
});

test('handleEvent collects text deltas with empty string fallback', () => {
  const acc = emptyAccum();
  handleEvent({ type: 'stream_event', event: { delta: { type: 'text_delta' } } }, acc);
  assert.deepEqual(acc.textChunks, ['']);
});
