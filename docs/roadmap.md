# x-engine roadmap

Future work, ordered by leverage. v1 (manual `npm run post` for single tweets) is shipped.

---

## v2.1 — Image attachments via gpt-image-2

**Status:** designed, not built. Highest-leverage next feature for richer tweets.

### Honest tradeoff to remember
AI-generated images for technical content often hurt credibility. For a dev tweet about a real bug fix, a screenshot of the actual diff lands harder than any AI render. The plan supports both: AI-gen via gpt-image-2, OR drop a manual screenshot file. **Default to screenshots for code/diff content; reserve AI-gen for narrative/branded posts** (e.g., the "Road to SF" cinematic shots).

### Scope
- Opt-in image attachment per draft via metadata field
- Two image sources: AI-generated via gpt-image-2, or pre-existing local file (screenshot)
- Visual review before posting (image lands on disk, eyeball, then approve)
- Single image per tweet (X allows 4 but multi-image is over-scope)

### Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Image source | Standalone OpenAI client in x-engine, not roadtosf's endpoint | Self-contained; no cross-repo dep |
| API | `client.images.generate({ model: "gpt-image-2", prompt, size, response_format: "b64_json" })` | Same path as roadtosf's `openai-image.ts` |
| Storage | `posted/images/staged/<filename>-<n>.png` (pre-post) → `posted/images/<tweetId>.png` (post-post) | Local files, gitignored. X hosts media after upload |
| Default size | `1024x1024` square; prompt metadata can override to `1536x1024` | Fits X's autoplay across feeds |
| Approval flow | Two stages: `npm run gen-image` → review file → `npm run post` (uploads + posts) | Same approval-gate as text |
| Cost / imaged-tweet | ~$0.04 OpenAI image + $0.01 X post = ~$0.05 | Negligible |

### Draft format extension
Two new optional metadata fields:
```
**Image prompt:** illustration of base64 data flooding into a closed wallet, surreal, muted palette
**Image:**                              ← stamped by gen-image with the staged file path
```

### File changes
**New:**
- `scripts/gen-image.mjs` — entry for image generation
- `scripts/lib/openai-image.mjs` — gpt-image-2 wrapper, returns base64 + writes to disk
- `scripts/lib/x-media.mjs` — `uploadMedia(filePath) → mediaId` via twitter-api-v2's `v1.uploadMedia()`
- `posted/images/.gitkeep`

**Modified:**
- `scripts/lib/parse-drafts.mjs` — extract `imagePrompt`, `image` fields
- `scripts/post.mjs` — if `image` path exists, upload media + attach to tweet via `client.v2.tweet({ text, media: { media_ids: [id] } })`; rename staged file to `<tweetId>.png` after success
- `scripts/check-auth.mjs` — add v1.1 media upload sanity probe
- `package.json` — add `openai` dep + `gen-image` npm script
- `.env.local.example` — document `OPENAI_API_KEY`
- `.gitignore` — add `posted/images/*.png`
- `CLAUDE.md` + `README.md` — document image flow

### Implementation steps (~85 min)
1. Image library (~15 min): `npm i openai`, write `openai-image.mjs`, smoke-test with one image to `/tmp/test.png`
2. `gen-image.mjs` (~20 min): walk drafts, find `Image prompt` + empty `Image` + empty `Posted`, gen + stamp. Cap 3/run, `--dry` flag.
3. X media upload helper (~10 min): `uploadMedia(filePath)` returns mediaId. Note: media upload is still v1.1 even with v2 posting.
4. `post.mjs` integration (~15 min): upload media first when `image` set, attach via `media_ids`, rename staged file after post success.
5. Archive + docs (~10 min): archive entry includes `Image: <path>` line.
6. End-to-end test (~15 min): mark a draft with image prompt, gen, eyeball, approve, post.

### Deferred from this plan
- Multi-image tweets (4 images per tweet)
- Auto image-prompt generation by the drafting layer
- Re-roll: `gen-image --re-roll <draft#>`
- Aspect-ratio control via metadata
- Alt text generation

---

## v2.2 — Cron / scheduled posting

**Status:** designed, holding for ~1 week of clean manual runs first.

When v1 has been reliable for ~7 days with no manual intervention bugs, wire a daily cron:
- macOS launchd job at e.g. 8:00 local
- Job runs `npm run post` from `~/Dev/automations/x-engine`
- Workflow becomes: edit draft → set `Status: approved` → walk away. Posts when cron fires.
- Hard rate limit (3/run) already in v1 prevents accidents.
- Should also fire `npm run draft` daily (the drafting layer Claude run) before posting — TBD whether that's a separate job.

---

## v2.3 — Engagement sync ✅ shipped

`scripts/feedback.mjs` runs daily at 13:00 UTC via `.github/workflows/feedback.yml`. Walks `posted/archive.md`, batches tweet IDs (1-7d old, unstamped) into `twitterapi.io`'s `/twitter/tweets` endpoint, stamps `Likes/Reposts/Replies/Bookmarks/Views/Fetched` back inline, then regenerates the auto-marked `## Top performing` block in `sources/x-profile/latest.md`. The next morning's `enhance` run picks up those top performers as few-shot examples.

Closes the engine's "what worked" loop end-to-end.

---

## v2.4 — Thread support

**Status:** drafts already include thread outlines but not in tweet-sized form.

Current state: `Type: thread hook (first tweet of thread)` drafts have hook + bullet outline, where bullets are too long to be tweets as-is.

To enable: extend draft format so each follow-up tweet is its own `> ` line, validated ≤280 chars. Posting iterates `client.v2.tweetThread([line1, line2, ...])` (or chains `reply.in_reply_to_tweet_id` manually).

Only build after v1 has been reliable for ~2 weeks — threads are higher stakes (more likely to embarrass on rogue posts).

---

## v2.5 — Mine session-summaries for raw ideas

**Status:** suggested in initial brainstorm; biggest passive-quality win.

Right now `sources/raw-ideas/<project>.md` is manual dump. Replace with: drafting-phase agent reads `~/.claude/session-summaries/-Users-cristeaoctavian-Dev-startups-*/*.md` (last 7 days), extracts technical lessons + commits + decisions, treats them as raw ideas.

Result: zero-effort idea pipeline from work actually done. Combined with v2.2 (cron), the engine writes entirely from your real engineering activity without you opening it.

Expected effort: ~30 min once profile sync phase exists.

---

## v2.6 — Voice file with examples (not just bans)

`config/voice.md` currently has only "don't say X" rules. Add a section of "do this / not this" pairs from top-performing posts. Concrete examples train the drafting layer 10× faster than abstract bans.

Trigger: after `posted/archive.md` has ~10 posts with engagement data — then we can identify what *actually* works for this voice.

---

## v2.7 — Per-post cost tracking

Append `Cost: $0.05` to each archive entry (X post fee + image gen if attached). Sum at top of archive monthly. Trivial accounting that prevents the "wait, why is my OpenAI bill $X this month" surprise — same mistake we already shipped a tweet about.

---

## v2.8 — Knowledge base (Postgres + pgvector via Supabase)

**Status:** designed, not built. Highest-leverage architectural change after v2.3 — turns three independently-amnesiac loops into one self-improving system.

### The problem
All three Claude-driven loops are amnesiac across runs:
- **Drafting** reads static `sources/*/latest.md` snapshots; no memory of what shipped or what worked.
- **Peer-posts research** distills patterns from *that run's* pool only; cross-run signal is thrown away.
- **Autoimprover** scores drafts on a 4-axis rubric and produces refinements, but **never sees if the refinements actually outperformed**. There is currently zero feedback loop between predicted score and actual engagement.

`posted/archive.md` is enough for hand-skim review but useless for retrieval, time-series metrics, semantic dedup, or correlation analysis.

### Decision: hybrid store, not embeddings-only or SQL-only
Plain markdown won't scale past a few hundred posts. Pure embeddings can't answer *"my best posts about caching since March"*. Pure SQL can't answer *"find drafts semantically similar to this idea"*. Need both — structured columns for analytics + filtering, vector column for semantic recall.

### Stack: Supabase + pgvector
- One Postgres instance, `pgvector` extension, embeddings as a column type. No separate vector DB.
- The Supabase MCP plugin is already wired up in this workspace → drafting + improver agents can RAG-query their own history at runtime via MCP, not just read static snapshots.
- Free tier covers ~10k posts + ~100k peer tweets easily. Egress is the only thing to watch.

### Honest tradeoff to remember
Adding a remote DB introduces a hard dependency for `draft` and `enhance` runs in CI. Failure mode: Supabase down → drafting agent runs without history (degraded, not broken — fall back to current static `latest.md` snapshots). Don't make any loop *require* the DB; it's an enrichment, not a critical path.

### Schema sketch

```sql
posts (
  id, tweet_id, posted_at, body, project, type,
  has_image, status, draft_file
)

post_metrics (                  -- snapshots over time, not single row
  id, post_id, snapshot_at,
  likes, reposts, replies, bookmarks, views, engagement_rate
)

post_images (
  id, post_id, url,
  ai_description,               -- vision pass: literal contents
  ai_meaning                    -- vision pass: why this image with this post
)

post_comments (
  id, post_id, parent_id, author, body, posted_at, likes
)

post_analysis (                 -- one LLM pass per post
  post_id, relevance_score, themes[], hooks_used[],
  voice_match, why_it_worked
)

peer_tweets (                   -- every peer tweet ever scored
  id, tweet_id, author, posted_at, body, metrics jsonb,
  relevance_score, classification
)

peer_authors (                  -- running aggregates per seed handle
  handle, niche_drift_score, relevance_trend, last_seen
)

peer_patterns (                 -- identified hook/format archetypes
  id, label, exemplar_tweet_id,
  first_seen, last_seen, freq_trend, avg_engagement
)

enhance_runs (                  -- the feedback table — joined to posts
  id, draft_id, draft_body, score jsonb, critique, refined,
  variant_shipped,              -- original | refined | rejected
  fk → posts.id
)

embeddings (                    -- one polymorphic table, ref_table discriminator
  id, ref_table, ref_id,
  content text, vector vector(1536), model
)
```

One `embeddings` table with a `ref_table` discriminator means a single semantic search returns posts + comments + image meanings + peer tweets together. Cross-domain queries are the whole point.

### What it unlocks (per loop)

**Drafting agent**
- Real "don't repeat" check: `cosine_distance(draft, recent_post) < 0.25` over 90 days. Replaces the current 7-day string match (which misses paraphrases).
- Content-gap detection becomes a query: angles in `config/projects/*` not semantically covered in last N days. Replaces the manual hand-pass during profile sync.
- Track-record-aware: agent RAGs "top 10 of my own posts on caching" before drafting on caching, not blindly imitating peer patterns.

**Peer-posts research**
- Novel hook detection — tweets that cluster together but are far from the 30-day corpus → emergent pattern. Surface at top of `latest.md`.
- Saturation detection — pattern showed up 3×/week last month, 12× this week → already overused. Stops the system from chasing dying memes.
- Proactive author drift — author's recent embedding centroid drifts > threshold from their historical centroid → blacklist before the relevance scorer notices.
- `peer-posts/latest.md` stops being a per-run snapshot and becomes a **rendered query** over the rolling corpus with novelty/saturation labels.

**Autoimprover (highest leverage)**
- Calibrated rubric: after ~30 enhanced posts, regress each axis against `engagement_rate` → discover which axes actually predict engagement *for this account*. Drop or reweight the noisy ones.
- A/B the improver itself: when shipped variant was `refined`, did it beat the `original`-variant median? **Right now you cannot tell.** This is the only place the system makes a prediction with a measurable outcome.
- Predicted engagement: "this draft scores like your historical median (~30 likes)" — concrete signal at approval time instead of vibes.
- In-context exemplars: feed the improver its top-10 historical "draft → refined → outperformed" triples. Sharper output without retraining.

### Cross-domain queries (none of the three loops can do alone)
- *"Find peer tweets semantically similar to my top-performing posts"* → cross-pollinate proven angles back into research seeds.
- *"Find drafts that scored ≥4 on every axis but flopped"* → debug the improver's blind spots.
- *"Find post archetypes I've never tried that work for accounts of my size"* → anti-imitation; do what others don't.

### File changes

**New:**
- `db/migrations/0001_init.sql` — schema above + pgvector extension.
- `scripts/sync-engagement.mjs` — for each row in `posted/archive.md`, hit `tweetsByIds` (already in `twitterapi-io.mjs`) + comments endpoint, upsert into `post_metrics` + `post_comments`.
- `scripts/index-posts.mjs` — for new posts: vision pass on images, LLM relevance/theme tagging, embeddings on body + image meaning + comment threads. Idempotent, content-hash gated.
- `scripts/lib/db.mjs` — Postgres pool wrapper, `upsertPost`, `upsertEmbedding`, `searchSimilar` helpers.
- `scripts/lib/embeddings.mjs` — wraps `text-embedding-3-small` ($0.02/1M tokens, ~free at this volume).
- `sources/post-history/` — new source. `fetch.mjs` queries Supabase for "top performers last 30d" + "posts on topics similar to today's draft candidates" → renders `latest.md`. **Closes the engagement loop.**
- `mcp-servers/knowledge/server.mjs` — exposes `search_my_posts(query, filters)`, `predict_engagement(body)`, `find_similar_peer_tweets(body)` tools to the draft + improve agents at runtime.

**Modified:**
- `scripts/post.mjs` — after successful post, `INSERT INTO posts` and seed first `post_metrics` snapshot.
- `scripts/enhance.mjs` — write each run into `enhance_runs` with the structured score, critique, refined body.
- `mcp-servers/peer-posts/server.mjs` — persist scored tweets into `peer_tweets` instead of throwing the corpus away each run.
- `mcp-servers/draft/server.mjs` — register the new `knowledge` server so the drafting agent can RAG live.
- `.env.local.example` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_EMBEDDINGS_KEY` (or reuse Claude vision via the existing OAuth token).
- `.github/workflows/morning.yml` — add `npm run sync-engagement` + `npm run index-posts` between `sync` and `draft`.

### Cost reality check
At current volume (~3 posts/day = ~1k posts/year + ~10k comments + ~1k images):
- Embeddings: cents per year (`text-embedding-3-small`).
- Vision: ~$0.001/image with `gpt-4o-mini`, or free via the existing Claude Pro/Max OAuth flow.
- Supabase: free tier covers it.
- Net: ~$0/month at personal-account scale.

### Implementation order (each independently valuable)

| Phase | Add | Unlocks |
|---|---|---|
| 1 | `posts` + `post_metrics` + `embeddings` (own posts) | Drafting agent gets memory, semantic dedup, gap detection |
| 2 | `peer_tweets` + `peer_authors` + `peer_patterns` | Novelty/saturation detection, proactive author drift |
| 3 | `enhance_runs` joined to `posts` | Improver becomes self-calibrating, predicted engagement |

By phase 3 the improver doesn't just see your post history — it sees *the peer corpus your hook was inspired by* and can flag *"this archetype is saturating, your last 2 attempts at it underperformed."* Not possible with markdown, three separate stores, or embeddings alone.

### Deferred from this plan
- Multi-account knowledge bases (one DB per X account)
- Public dashboard exposing the metrics
- Automatic seed-handle discovery from peer-tweet clustering
- LLM-driven schema migrations (let the agent ALTER TABLE — no, never)
- Replacing `posted/archive.md` entirely; keep it as the human-readable mirror

---

## v2.9 — Self-improving research & critique loops (literature-grounded)

**Status:** designed, not built. Builds on v2.8's KB. The KB schema is the *prerequisite*; this entry is what to actually run on top of it.

### Why this matters
v2.8 stores the data. This phase is what closes the prediction → outcome loop. Without it, the autoimprover keeps producing miscalibrated 1-5 scores forever, and peer-posts keeps re-distilling the same patterns each run with no temporal awareness.

### Source papers (all cited inline below)

| Tag | Paper | Year | Core idea |
|---|---|---|---|
| **Reflexion** | [Shinn et al., NeurIPS](https://arxiv.org/abs/2303.11366) | 2023 | Verbal natural-language reflections stored in episodic memory; next attempt RAGs closest reflections. +11pp HumanEval. |
| **Self-Refine** | [Madaan et al.](https://arxiv.org/abs/2303.17651) | 2023 | Iterative critique→refine loop, no training. ~20% absolute improvement across 7 tasks. |
| **Pearl** | [ACL 2024](https://aclanthology.org/2024.customnlp4u-1.16/) | 2024 | Generation-calibrated retriever — retrieval scores trained to correlate with downstream output quality, not raw similarity. |
| **Salemi 2025** | [Salemi et al.](https://arxiv.org/html/2504.08745v1) | 2025 | Author-specific features + contrastive counter-examples = +15% over baseline RAG personalization. |
| **LLM-Judge Overconfidence** | [arxiv 2508.06225](https://arxiv.org/html/2508.06225v1) | 2024-25 | LLM scores systematically overconfident, miscalibrated. Solutions: TH-Score, isotonic/Platt recalibration. |
| **TF-IDF+LSH novelty** | Verheij et al. ([1605.00122](https://arxiv.org/abs/1605.00122)) | 2016 | Cheap incremental sentence-level novelty detection in text streams. |
| **Dynamic NMF** | IBM/WSDM | 2012 | Topic emergence/evolution with temporal regularization. |
| **TwHIN-BERT** | Twitter | 2022 | Engagement-aware embeddings outperform text-only embeddings for downstream prediction. |

### Honest tradeoff to remember
Every technique below costs tokens or compute. At ~3 posts/day, recalibration math is free, contrastive exemplars are ~20% more retrieval cost, multi-step Self-Refine is 2-3× the LLM bill on enhance. Gate the expensive moves behind `--deep` flags; default to the cheap moves (recalibration, contrastive retrieval) which give the largest single boost in the literature.

### Autoresearch (peer-posts) — what to ship

| Technique | From | Concrete move |
|---|---|---|
| **Novelty via centroid distance** | TF-IDF+LSH / Semantic Scan | Compute rolling 30-day centroid of `peer_tweets` embeddings. Score each new tweet's distance from centroid → rank "emerging" hooks at top of `latest.md`. Trivial on pgvector. |
| **Saturation = cluster-frequency slope** | Dynamic NMF | HDBSCAN-cluster recent peer embeddings. Track cluster size per week. Positive slope + high density = saturating (deprioritize); positive slope + low density = emerging (surface). |
| **Burst-based seed discovery** | SDNML / burst detection | Authors who suddenly mention rising clusters get auto-promoted into the seed pool. Stops the system from depending on hand-curated `seedHandles` in `peer-posts/source.config.json`. |
| **Contrastive corpus tagging** | Salemi 2025 | Each peer pattern joined to own engagement → tagged `worked_for_me` / `flopped_for_me` / `untried`. Drafting agent sees both sides instead of blindly imitating. |

`peer-posts/latest.md` becomes a **rendered query** over the rolling corpus with `[novelty: 0.83]` / `[saturating]` labels attached. Per-run amnesia ends.

### Autoimprover (enhance) — what to ship (higher leverage than autoresearch)

| Technique | From | Concrete move |
|---|---|---|
| **Reflexion-style memory** | Shinn 2023 | After each post lands, generate a one-sentence verbal reflection ("predicted hook 5/5, actual engagement bottom quartile, likely too generic"). Store in `enhance_runs.reflection`. Next critique RAGs the 5 closest historical reflections as in-context examples. |
| **Iterative refine loop** | Self-Refine 2023 | Replace one-shot critique with: critique → refine → re-critique → stop when score plateaus or 3 iterations. +20% in the paper, costs 2-3× tokens. Keep behind `--deep` flag. |
| **Score recalibration** | TH-Score / isotonic | After ~30 (predicted_score, actual_engagement_percentile) pairs, fit isotonic regression in a `scripts/calibrate.mjs` weekly job. Ship `calibrated_score = isotonic(raw_score)`. Stamp it on the draft as `**CalibratedScore:**`. The raw 1-5 stops being trusted directly. |
| **Contrastive exemplars** | Salemi 2025 (+15%) | When critiquing, retrieve **(a)** top-3 own posts on similar topic that worked, **(b)** bottom-3 own posts on similar topic that flopped, **(c)** 1-2 peer posts in the same archetype. Show all three labeled. The model learns *what differentiates yours*. **Highest dollar-for-dollar move in this entire phase.** |
| **Generation-calibrated retrieval** | Pearl 2024 | Don't use cosine similarity to pick exemplars. Use historical "engagement of posts that imitated this exemplar" as the retrieval score. After enough data, dramatically better than text-similarity. Implement once contrastive-exemplar baseline exists. |
| **Thompson sampling over archetypes** | Spotify llm-bandit | Each hook archetype (completion-hook, symptom/cause/fix, X-things-list, etc.) is an arm. Sample with Thompson sampling — exploit known winners, reserve exploration probability for novel archetypes. After ~50 posts you have a real posterior, not vibes. |

### File changes (delta on top of v2.8)

**New:**
- `scripts/calibrate.mjs` — weekly isotonic regression on `enhance_runs` × `post_metrics` join. Writes `db/calibration_<date>.json`. Improver loads at startup.
- `scripts/lib/reflection.mjs` — generates one-sentence reflections after engagement lands; stamps `enhance_runs.reflection`.
- `scripts/lib/contrastive-retrieval.mjs` — given a draft body, returns `{wins[], flops[], peer_refs[]}` triples for the improver prompt.
- `scripts/lib/novelty.mjs` — `noveltyScore(embedding)` against the rolling 30-day centroid; `saturationLabel(cluster_id)` from frequency slope.
- `scripts/lib/bandit.mjs` — Thompson sampling over archetypes with persistent posterior in `archetype_arms` table.

**Modified:**
- `scripts/enhance.mjs` — add `--deep` flag for iterative refine loop; always inject contrastive exemplars; output calibrated score alongside raw score; bandit-pick the archetype hint when no archetype is forced.
- `mcp-servers/peer-posts/server.mjs` — emit `latest.md` as a rendered query (top-N by novelty score, exclude saturating clusters, prepend tagging).
- `mcp-servers/improve/server.mjs` — accept `contrastive_exemplars` in the tool schema and stamp `**CalibratedScore:**` + `**Reflection:**` (after post-mortem).
- `db/migrations/0002_loops.sql` — add `enhance_runs.reflection`, `archetype_arms (archetype, alpha, beta, last_updated)`, `cluster_state (cluster_id, label, freq_slope, last_seen)`.

### Implementation order (each independently useful)

| Phase | Add | Effort | Unlocks |
|---|---|---|---|
| 9.1 | Contrastive exemplars in enhance | ~1 day | Highest single boost. Drop-in on top of v2.8. |
| 9.2 | Score recalibration + reflection store | ~1 day | Improver stops being miscalibrated. Real predicted-engagement signal. |
| 9.3 | Novelty + saturation labels in peer-posts | ~2 days | Per-run amnesia ends. Stops chasing dying memes. |
| 9.4 | Iterative refine (`--deep`) | ~half day | Optional power move for important drafts. |
| 9.5 | Thompson-sampling archetype bandit | ~1 day | Real exploration/exploitation, not always-greedy. |
| 9.6 | Pearl-style generation-calibrated retrieval | ~2 days | Replaces cosine-similarity exemplar selection. Build last — needs ≥3 months of data. |

### Deferred from this plan
- TwHIN-style fine-tuned engagement-aware embeddings (training a model is overkill at this scale; isotonic recalibration on top of off-the-shelf embeddings captures most of the value)
- LoRA-finetuning the improver on own corpus (skip — in-context contrastive exemplars beat finetuning at this volume per Salemi 2025)
- Full multi-agent debate / tournament critique (over-engineered; single-agent with contrastive exemplars hits the diminishing-returns wall first)
- RLAIF/PPO loops (need >1000 samples to be statistically meaningful; not there yet)

---

## v3.0 — Early-reply hunter (notify-only)

**Status:** designed, not built. Researched 2026-05-04. Highest-leverage growth move at sub-1k follower scale — ride other people's viral waves instead of trying to make your own posts go viral cold.

### Why this matters (research-backed)
At a small account, original posts have low cold-start velocity. Replying early on tweets that *do* go viral is the only growth tactic with leverage:
- Replies carry **~150× the algorithmic weight of likes** in 2026 ([XLab guide](https://use-xlab.com/blog/how-to-grow-on-twitter-2026)).
- **67% of small-account growth** comes from reply consistency, not posting alone ([Witty Playbook](https://witty.so/playbook/reply-led-growth/anatomy-high-value-reply)).
- First **3-5 replies** on a tweet that goes big siphon disproportionate attention from the eventual viral wave.
- The **30-90 minute window** after a tweet posts is when X's algorithm tests it on a small audience — replies during this window influence whether it advances.

This pivots the engine from "post and grow" to "engage and grow." Both run in parallel.

### Honest tradeoff to remember
Auto-posting AI-generated replies via API is a **top-3 shadowban trigger** ([Amplifresh 2026 safety guide](https://amplifresh.com/blog/automate-x-twitter-engagement-without-getting-banned)). Even if the human taps "approve," if the comment text was machine-generated and posted seconds later through the same API key, X's spam classifier may pattern-match. **v1 is notify-only — Telegram message with a copy-pasteable suggestion, user opens X manually.** Auto-posting is deferred behind ≥2 weeks of clean manual usage.

### Tools landscape
Checked Tweet Hunter, Typefully, Hypefury, Reply Guy. **None ship a true viral-reply hunter** — they do scheduling, AI rewrites, popularity prediction for *your* posts. Reply Guy is closest but doesn't generate the comment. This is a real gap; building it on the existing twitterapi.io infra is reasonable.

### Architecture

```
.github/workflows/hunt.yml          every 30 min, 14:00-22:00 UTC (peak X hours)
   └─ npm run hunt                  ~16 runs/day
       │
       ├─ 1. Fetch (twitterapi.io userLastTweets)
       │     each peer-posts seed handle: last 5 tweets
       │     ~110 tweets/poll × 16 polls ≈ 1.8k/day → ~$0.15/day → ~$4.5/month
       │
       ├─ 2. Pre-filter
       │     posted in last 90 min · not a reply · not in 60d-ttl dedup cache
       │     ≥5 likes OR ≥2 replies (cheap absolute floor)
       │
       ├─ 3. Score (the part research changed my mind on)
       │     for each candidate, fetch author's last 20 tweets to compute
       │     median engagement velocity (likes + 2*replies) / minutes
       │     score = this_velocity / author_median_velocity
       │     comment_to_like_ratio (controversy / debate signal — strongest viral predictor per arXiv 1910.02807)
       │     keep top 2-3/day above combined threshold
       │
       ├─ 4. Generate suggested comment (claude -p, free on Pro/Max)
       │     system prompt:
       │       voice.md + own top performers (from feedback loop, v2.3)
       │       + "Expertise Reply" pattern (agree + add framework + brief example)
       │     constraints: ≤200 chars, no emojis, no hashtags, no @mentions, no link
       │
       ├─ 5. Notify (Telegram, existing infra)
       │     <body> · @author · 23❤ in 14m / median 3❤ → 7.6× velocity
       │     suggested comment in <code> block (mobile copy-tap)
       │     deeplink to open the tweet in X
       │     [optional] /skip <id> bot command to suppress similar future ones
       │
       └─ 6. Persist (sources/comment-hunter/.state.json, gitignored)
             {tweet_id, suggested_at, author, score, comment_text}
             60-day TTL · dedup · later inputs to a reply-engagement feedback loop
```

### Critical guardrails (non-negotiable in v1)

| Risk | Guardrail |
|---|---|
| Shadowban from automated reply pattern | **No auto-post.** Telegram → user opens X → user posts manually. Breaks the bot fingerprint. |
| Same tweet suggested twice | 60-day TTL dedup state file |
| Notification fatigue | Cap **2-3/day** top-scored only. Better to miss than burn engagement budget on mediocre. |
| Generic "great point!" replies | Few-shot prompt with research-backed Expertise Reply pattern + own top performers |
| Cost runaway | Hard fetch budget per run + per day; abort if exceeded |
| Detected as bot at the X-API level | Randomized timing on actual reply posts when v2 enables them |

### Why notify-only beats auto-post on the math
Research consensus: 30-50 thoughtful replies/day stays under rate limits — but that assumes *manual* replies. AI-generated replies are categorically different:
- Same tool fingerprint
- Same general voice
- Posted within seconds via the same API key

5/day of those = much higher detection probability than 5 manual replies. Notify-only sidesteps the whole vector.

### File changes

**New:**
- `scripts/hunt.mjs` — entry point.
- `scripts/lib/virality.mjs` — `scoreCandidate(tweet, authorBaseline)` returning `{score, reasons}`.
- `scripts/lib/comment-gen.mjs` — wraps `claude -p` with the suggestion system prompt.
- `mcp-servers/comment/server.mjs` — exposes `submit_suggestion` tool, mirrors the improve MCP shape.
- `sources/comment-hunter/.state.json` — gitignored persistent dedup + scores.
- `.github/workflows/hunt.yml` — cron every 30 min during 14-22 UTC.
- `tests/virality.test.mjs` — score formula correctness, baseline math, dedup logic.

**Modified:**
- `scripts/lib/twitterapi-io.mjs` — already has `userLastTweets`; no changes for v1.
- `scripts/lib/x-client.mjs` — add `reply(text, tweetId)` (just `client.v2.reply(text, tweetId)`). Unused in v1 but ready for v2.
- `package.json` — add `hunt` / `hunt:dry` / `hunt:ci` scripts.
- `CLAUDE.md` — document the hunt loop and the "no auto-reply yet" decision.
- `.env.local.example` — no new vars; reuses `TWITTERAPI_IO_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `TELEGRAM_*`, `X_API_*` (the X creds are pre-positioned for v2's auto-reply).

### Phased rollout (each phase independently valuable)

| Phase | Effort | What ships | What it unlocks |
|---|---|---|---|
| **3.0.1 Notify-only hunter** | ~3h | Polling, scoring, claude-gen suggestion, Telegram ping | Daily 2-3 manually-posted high-quality early replies |
| **3.0.2 Reply-engagement feedback** | ~2h, after 2 wks of 3.0.1 | New `posted/replies-archive.md` + `feedback-replies.mjs` mirroring `feedback.mjs` | Improver/comment-gen learn from which YOUR replies actually landed (not just peer patterns) |
| **3.0.3 Optional `/reply <id>` bot command** | ~2h, after another 2 wks | Cloudflare Worker bot extension that posts via X API | One-tap reply from notification — only safe after fingerprint stabilized |
| **3.0.4 Watch-tier expansion** | ~3h | Auto-discovers handles whose tweets routinely score >5× their baseline; promotes into a faster polling tier | Catch viral tweets from outside the hand-curated peer pool |

### Cross-loop wins after v2.8 (knowledge base) lands
Once posts + peer tweets + own engagement live in pgvector, the hunt loop gets meaningfully sharper:
- Comment generation pulls **own** top-replies as few-shot (currently can only pull own top *posts*).
- Pre-filter can dedup against *semantic* similarity to past suggestions, not just tweet ID.
- Score blends in "how often does this author's content historically convert into engagement-on-my-replies" — a much stronger ranker than absolute virality score.

### Deferred from this plan
- Hashtag/topic-search hunting (too noisy at v1; peer-handle list is the right starting envelope)
- WebSocket streaming from twitterapi.io (sub-second latency unnecessary at 30-min poll cadence; one extra moving part for negligible benefit)
- Auto-following the OP after replying (separate growth tactic, separate workflow, separate blast radius)
- Multi-account simulation (explicit anti-spam violation)
- LLM-judge scoring of comment quality (the human eyeball pass IS the quality filter in v1)
- Comment quality calibration via reply-engagement (lives in v3.0.2, not v3.0.1)

---

## What we will NOT build

- Slack/Pushover post-success pings (over-engineering for personal use)
- Web UI for draft management (terminal + Obsidian or VS Code editing the markdown is enough)
- Per-tweet A/B testing (volume too low to be statistically meaningful)
- DM automation (different blast-radius — replies are gated behind v3.0.3 manual-only window first)
