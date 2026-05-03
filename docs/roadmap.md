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

## v2.3 — Engagement sync

**Status:** archive format already supports it; just needs the script.

`scripts/sync-engagement.mjs`, runs once daily, walks `posted/archive.md`, parses `URL:` lines, hits X API `tweets.fields=public_metrics` for each, writes back `Likes: N | Reposts: N | Replies: N` inline. Closes the engine's "what worked" loop. Bearer Token (already saved separately) suffices for read-only.

Expected effort: ~30 min. Run via cron alongside daily post.

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

## What we will NOT build

- Slack/Pushover post-success pings (over-engineering for personal use)
- Web UI for draft management (terminal + Obsidian or VS Code editing the markdown is enough)
- DM/reply automation (different blast-radius — keep one-way for now)
- Per-tweet A/B testing (volume too low to be statistically meaningful)
