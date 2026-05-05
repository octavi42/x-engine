// Virality scoring for the early-reply hunter.
//
// Approach: compare a candidate tweet's engagement velocity (likes + 2*replies
// per minute) against the author's own historical median velocity. A score
// of N means the candidate is currently accumulating engagement N× faster
// than this author's typical tweet. Combined with an absolute floor (so
// brand-new tweets with 11 likes don't beat brand-new tweets with 200 likes),
// this catches tweets that are *unusually* hot for their author.
//
// Why "vs own baseline" not absolute: a tweet with 50 likes in 10 minutes
// from a 100k-follower account is normal. Same tweet from a 2k-follower
// account is a viral break-out and exactly what we want to reply to first.

const EPSILON = 1e-6;

export function ageMinutes(createdAt, now = Date.now()) {
  if (!createdAt) return Infinity;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max((now - t) / 60_000, 0.5);
}

// Velocity = engagement-weighted interactions per minute.
// Replies weighted 2× because they signal threaded discussion (algorithmic
// gold) and are harder to fake than likes.
export function velocity(tweet, now = Date.now()) {
  const age = ageMinutes(tweet.created_at, now);
  return (tweet.likes + 2 * tweet.replies) / age;
}

export function median(xs) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// Build the author's baseline from recent non-reply tweets. We exclude the
// candidate itself and any replies (their engagement is distorted by the
// parent's reach). Zero-engagement tweets stay in — for an author who
// usually posts duds, a single hit IS the signal we want to amplify.
export function authorBaseline(authorRecent, candidateId, now = Date.now()) {
  const eligible = authorRecent.filter(
    (t) => t.id !== candidateId && !t.is_reply
  );
  const velocities = eligible.map((t) => velocity(t, now));
  return {
    median: median(velocities),
    sampleSize: eligible.length,
  };
}

// Score a candidate against its author's baseline. Returns the velocity
// ratio plus structured "reasons" for the Telegram message.
//
// floors: tweet must clear minLikesAbsolute AND have score ≥ minVelocityRatio
// to be eligible. We surface controversy (replies/likes ratio) as a side
// signal — debate tweets often spike late and stay engaged longer, but we
// don't fold it into the primary score yet (tunable in v3.0.2 once we have
// own-reply engagement data).
export function scoreCandidate({
  tweet,
  authorRecent,
  now = Date.now(),
  minLikesAbsolute = 10,
  minVelocityRatio = 3.0,
  minAuthorSampleSize = 5,
}) {
  const candidateVelocity = velocity(tweet, now);
  const baseline = authorBaseline(authorRecent, tweet.id, now);
  const ratio = candidateVelocity / Math.max(baseline.median, EPSILON);

  const controversy = tweet.likes > 0 ? tweet.replies / tweet.likes : 0;
  const ageMin = ageMinutes(tweet.created_at, now);

  const reasons = [];
  reasons.push(
    `${tweet.likes}❤ ${tweet.replies}💬 in ${ageMin.toFixed(0)}m`
  );
  if (baseline.sampleSize >= minAuthorSampleSize) {
    const displayRatio = Math.min(ratio, 999);
    reasons.push(
      `vel ${candidateVelocity.toFixed(2)}/min vs author median ${baseline.median.toFixed(2)} → ${displayRatio.toFixed(1)}×`
    );
  } else {
    reasons.push(`thin author baseline (${baseline.sampleSize}/${minAuthorSampleSize})`);
  }
  if (controversy >= 0.3) {
    reasons.push(`controversy ${controversy.toFixed(2)} (replies/likes)`);
  }

  // No baseline = no signal. Reject. We were getting crypto-promo bots
  // through the "cold author" path because their feeds returned empty after
  // filtering (replies + zero-engagement tweets), causing sampleSize=0,
  // which used to default-pass on absolute likes alone.
  const passesFloors =
    tweet.likes >= minLikesAbsolute &&
    baseline.sampleSize >= minAuthorSampleSize &&
    ratio >= minVelocityRatio;

  return {
    score: ratio,
    candidateVelocity,
    authorMedianVelocity: baseline.median,
    authorSampleSize: baseline.sampleSize,
    controversy,
    ageMinutes: ageMin,
    reasons,
    passesFloors,
  };
}
