---
source: x-algorithm
type: static
description: X For You feed algorithm signals. Weight hierarchy, negative signals, and out-of-network reach triggers from xai-org/x-algorithm.
---

# X Algorithm Signals

Based on the open-sourced For You feed algorithm (xai-org/x-algorithm). The ranker predicts engagement probabilities and combines them into a weighted score: Final Score = Σ (weight × P(action)).

## Weight hierarchy (highest to lowest impact)

1. Reply — strongest positive signal
2. Repost / Quote — drives out-of-network distribution
3. Like — keeps you visible to existing followers only
4. Dwell — user stops scrolling and reads (standalone signal even without tap)
5. Follow — long-term signal, low frequency
6. Click / Profile click / Photo expand — moderate signals

## Negative signals (negative weights, tank reach)

- P(not_interested) — user taps "not interested"
- P(block_author) — user blocks you
- P(mute_author) — user mutes you
- P(report) — user reports the post

Any post predicted to trigger these gets scored down hard. Avoid: spam-like frequency, generic/vague content, off-topic pivots, controversial bait without substance.

## Out-of-network reach (how posts find new people)

Phoenix retrieval uses embedding similarity to surface posts to non-followers. Key triggers:
- Posts that get replies + reposts (not just likes) get boosted into out-of-network feeds
- Specific technical terms cluster better in embedding space than vague language
- Likes alone keep you in-network only

## Author diversity penalty

The algorithm attenuates repeated-author scores within a single feed session. Spacing posts across time slots prevents cannibalization.

## Dwell time

Multi-line posts with a strong first line buy dwell as a standalone signal. The algorithm counts time-on-post even if the user doesn't engage. Line breaks and paragraph structure earn dwell.

## Drafting checklist

- Each draft should trigger at least 2 positive action types (e.g., reply + like, or repost + dwell)
- Optimize for "would someone reply?" first, "would someone repost?" second
- Include a specific detail that makes the post quotable or debatable
- Avoid anything that could trigger not_interested or mute (vague, off-topic, repetitive)
