import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureHandles,
  rotatePick,
  recordPull,
  blacklistHandle,
  recordDiscovery,
  promoteDiscovered,
  avgScore,
} from '../scripts/lib/peer-state.mjs';

function emptyState() {
  return { handles: {}, discovered: {}, last_run: null };
}

test('ensureHandles seeds new handles and does not clobber existing', () => {
  const state = ensureHandles(emptyState(), ['Alice', 'BOB']);
  assert.equal(state.handles.alice.handle, 'Alice');
  assert.equal(state.handles.alice.status, 'active');
  assert.equal(state.handles.bob.handle, 'BOB');

  // Mutate one and re-seed; existing entry should survive.
  state.handles.alice.last_pulled = '2026-05-01';
  state.handles.alice.score_sum = 9;
  state.handles.alice.score_n = 3;
  ensureHandles(state, ['Alice', 'CAROL']);
  assert.equal(state.handles.alice.last_pulled, '2026-05-01', 'existing last_pulled preserved');
  assert.equal(state.handles.alice.score_sum, 9, 'existing scores preserved');
  assert.equal(state.handles.carol.status, 'active');
});

test('ensureHandles resurrects pruned handles', () => {
  const state = ensureHandles(emptyState(), ['dave']);
  state.handles.dave.status = 'pruned';
  ensureHandles(state, ['dave']);
  assert.equal(state.handles.dave.status, 'active');
});

test('rotatePick orders by oldest last_pulled (null first)', () => {
  const state = ensureHandles(emptyState(), ['a', 'b', 'c']);
  state.handles.a.last_pulled = '2026-05-03';
  state.handles.b.last_pulled = null;
  state.handles.c.last_pulled = '2026-05-01';

  const picked = rotatePick(state, 2);
  assert.deepEqual(picked, ['b', 'c'], 'null-pulled first, then oldest');
});

test('rotatePick skips blacklisted handles', () => {
  const state = ensureHandles(emptyState(), ['a', 'b']);
  blacklistHandle(state, 'a', 'drift');
  const picked = rotatePick(state, 5);
  assert.deepEqual(picked, ['b']);
});

test('recordPull stamps last_pulled and accumulates scores', () => {
  const state = ensureHandles(emptyState(), ['alice']);
  recordPull(state, 'alice', [4, 5]);
  recordPull(state, 'alice', [3]);
  const a = state.handles.alice;
  assert.equal(a.score_sum, 12);
  assert.equal(a.score_n, 3);
  assert.equal(avgScore(a), 4);
  assert.match(a.last_pulled, /^\d{4}-\d{2}-\d{2}$/);
});

test('recordPull on unseeded handle creates the entry', () => {
  const state = emptyState();
  recordPull(state, 'newperson', [3]);
  assert.equal(state.handles.newperson.score_sum, 3);
  assert.equal(state.handles.newperson.status, 'active');
});

test('promoteDiscovered promotes high scorers, skips active and blacklisted', () => {
  const state = ensureHandles(emptyState(), ['alreadyactive']);
  blacklistHandle(state, 'badactor', 'crypto');
  recordDiscovery(state, 'goodfind', 5, 'great content');
  recordDiscovery(state, 'meh', 2, 'mid');
  recordDiscovery(state, 'alreadyactive', 5, 'noop'); // should be skipped — already active
  recordDiscovery(state, 'badactor', 5, 'noop'); // should be skipped — blacklisted

  const promoted = promoteDiscovered(state);
  assert.deepEqual(promoted.sort(), ['goodfind']);
  assert.equal(state.handles.goodfind.status, 'active');
  assert.ok(state.handles.goodfind.promoted_at);
  assert.equal(state.handles.alreadyactive.promoted_at, undefined, 'active handle not re-promoted');
  assert.equal(state.handles.badactor.status, 'blacklisted', 'blacklist preserved');
});

test('promoteDiscovered respects custom minScore', () => {
  const state = emptyState();
  recordDiscovery(state, 'borderline', 4, 'ok');
  assert.deepEqual(promoteDiscovered(state, { minScore: 5 }), [], 'too low at minScore=5');
  assert.deepEqual(promoteDiscovered(state, { minScore: 4 }), ['borderline'], 'promoted at minScore=4');
});

test('recordDiscovery keeps highest score across calls', () => {
  const state = emptyState();
  recordDiscovery(state, 'h', 2, 'first sighting');
  recordDiscovery(state, 'h', 4, 'better content');
  recordDiscovery(state, 'h', 3, 'mid content');
  assert.equal(state.discovered.h.score, 4);
});

test('avgScore returns null on no scores', () => {
  assert.equal(avgScore({ score_sum: 0, score_n: 0 }), null);
  assert.equal(avgScore(undefined), null);
});
