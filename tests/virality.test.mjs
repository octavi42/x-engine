import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ageMinutes,
  velocity,
  median,
  authorBaseline,
  scoreCandidate,
} from '../scripts/lib/virality.mjs';

const NOW = new Date('2026-05-05T12:00:00Z').getTime();

function tweet({ id = 't1', minutesAgo = 10, likes = 0, replies = 0, isReply = false, handle = 'alice' } = {}) {
  return {
    id,
    handle,
    text: 'sample',
    created_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
    likes,
    replies,
    is_reply: isReply,
  };
}

test('ageMinutes floors at 0.5 for fresh tweets', () => {
  const fresh = tweet({ minutesAgo: 0 });
  assert.equal(ageMinutes(fresh.created_at, NOW), 0.5);
});

test('ageMinutes returns Infinity for missing created_at', () => {
  assert.equal(ageMinutes(undefined, NOW), Infinity);
  assert.equal(ageMinutes(null, NOW), Infinity);
});

test('velocity weights replies 2× likes', () => {
  const t = tweet({ minutesAgo: 10, likes: 10, replies: 5 });
  // (10 + 2*5) / 10 = 2.0
  assert.equal(velocity(t, NOW), 2.0);
});

test('median handles empty + odd + even cases', () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('authorBaseline excludes the candidate and replies, keeps zero-engagement tweets', () => {
  const recent = [
    tweet({ id: 'cand', minutesAgo: 5, likes: 50, replies: 5 }),
    tweet({ id: 'a', minutesAgo: 60, likes: 10, replies: 0, isReply: true }),
    tweet({ id: 'b', minutesAgo: 60, likes: 0, replies: 0 }),
    tweet({ id: 'c', minutesAgo: 60, likes: 6, replies: 0 }),
    tweet({ id: 'd', minutesAgo: 120, likes: 12, replies: 0 }),
  ];
  const baseline = authorBaseline(recent, 'cand', NOW);
  // Excluded: cand (self), a (reply). Kept: b (0 eng), c, d.
  assert.equal(baseline.sampleSize, 3);
  // velocities: b=0 ; c=6/60=0.1 ; d=12/120=0.1 → median = 0.1
  assert.equal(baseline.median, 0.1);
});

test('scoreCandidate computes ratio and gates on absolute floor + ratio', () => {
  const candidate = tweet({ id: 'cand', minutesAgo: 10, likes: 30, replies: 5 });
  const recent = [
    tweet({ id: 'a', minutesAgo: 60, likes: 6, replies: 0 }),
    tweet({ id: 'b', minutesAgo: 120, likes: 12, replies: 0 }),
    tweet({ id: 'c', minutesAgo: 180, likes: 18, replies: 0 }),
    tweet({ id: 'd', minutesAgo: 240, likes: 24, replies: 0 }),
    tweet({ id: 'e', minutesAgo: 300, likes: 30, replies: 0 }),
  ];
  const result = scoreCandidate({ tweet: candidate, authorRecent: recent, now: NOW });
  // candidateVelocity = (30 + 2*5)/10 = 4.0 ; each peer is exactly 0.1/min
  // → median = 0.1 ; ratio = 40
  assert.equal(result.candidateVelocity, 4.0);
  assert.equal(result.authorMedianVelocity, 0.1);
  assert.equal(result.score, 40);
  assert.equal(result.passesFloors, true);
});

test('scoreCandidate fails the absolute-likes floor even with infinite ratio', () => {
  const candidate = tweet({ id: 'cand', minutesAgo: 5, likes: 5, replies: 0 });
  const recent = Array.from({ length: 5 }, (_, i) =>
    tweet({ id: `a${i}`, minutesAgo: 60 + i * 60, likes: 1, replies: 0 })
  );
  const result = scoreCandidate({
    tweet: candidate,
    authorRecent: recent,
    now: NOW,
    minLikesAbsolute: 10,
  });
  assert.equal(result.passesFloors, false);
});

test('scoreCandidate fails the velocity-ratio floor when sample exists', () => {
  const candidate = tweet({ id: 'cand', minutesAgo: 60, likes: 11, replies: 0 });
  const recent = Array.from({ length: 5 }, (_, i) =>
    tweet({ id: `a${i}`, minutesAgo: 60, likes: 50, replies: 5 })
  );
  const result = scoreCandidate({
    tweet: candidate,
    authorRecent: recent,
    now: NOW,
    minLikesAbsolute: 10,
    minVelocityRatio: 3,
  });
  // candidate vel = 11/60 ≈ 0.183 ; baseline = 60/60 = 1 → ratio ≈ 0.18
  assert.ok(result.score < 1);
  assert.equal(result.passesFloors, false);
});

test('scoreCandidate REJECTS cold authors — no baseline = no signal', () => {
  const candidate = tweet({ id: 'cand', minutesAgo: 5, likes: 25, replies: 0 });
  const result = scoreCandidate({
    tweet: candidate,
    authorRecent: [],
    now: NOW,
    minLikesAbsolute: 10,
    minVelocityRatio: 3,
  });
  assert.equal(result.authorSampleSize, 0);
  assert.equal(result.passesFloors, false);
});

test('scoreCandidate rejects authors with thin baseline (< minAuthorSampleSize)', () => {
  const candidate = tweet({ id: 'cand', minutesAgo: 5, likes: 25, replies: 0 });
  const recent = [tweet({ id: 'a', minutesAgo: 60, likes: 5, replies: 0 })];
  const result = scoreCandidate({
    tweet: candidate,
    authorRecent: recent,
    now: NOW,
    minAuthorSampleSize: 5,
  });
  assert.equal(result.authorSampleSize, 1);
  assert.equal(result.passesFloors, false);
});
