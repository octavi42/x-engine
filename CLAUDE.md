# x-engine — Claude Code Instructions

This repo generates daily X/Twitter post drafts for @octavicristea.

## Branch
- Always work on the `main` branch. Never create or push to `master`.

## Skills
- The x-writing skill is installed at `.claude/skills/x-writing/` — never reinstall it during runs.

## Before writing any content
1. Always read `config/voice.md` for tone, style, and constraints.
2. Always read every file in `config/projects/` to know what to write about.
3. Run `npm run sync` to refresh fetched sources, then read every `sources/*/latest.md` for context (recent posts, content gaps, manual ideas, trending topics, vault notes).

## Project structure
- Each project is a separate `.md` file in `config/projects/`.
- Each project file defines: repo URL, description, stack, status, and content angles.
- To add a new project, drop a new `.md` file in `config/projects/` — the engine picks it up automatically.

## Sources
Sources are pluggable. Each source lives at `sources/<name>/` and contains:
- `source.config.json` — declares `name`, `type`, `description`, `enabled`, `params`.
- `latest.md` — normalized output the drafting agent reads. Has YAML frontmatter (`source`, `type`, `description`, optionally `fetched_at`).
- `fetch.mjs` *(optional)* — exports `async function fetch(source, env) → { items, meta? }`. If absent, `latest.md` is hand-edited (static source).

Current sources:
- `sources/x-profile/` — static. Account snapshot, hand-edited during profile sync phase below.
- `sources/trending/` — static. Append a `## YYYY-MM-DD` section each run with trending findings.
- `sources/raw-ideas/` — concat. Drop manual ideas in `sources/raw-ideas/items/<project>.md`; sync concatenates into `latest.md`.
- `sources/obsidian-personal/` — obsidian-vault. Pulls Build Log + Ideas from recent daily notes.
- `sources/github-commits/` — github-commits. Recent commits across each project's GitHub repo (auto-discovered from `config/projects/*.md`). Requires `gh` CLI authenticated locally.
- `sources/rss-trending/` — rss. Recent items from configured AI/dev/startup news feeds (HN, TechCrunch AI, The Verge AI by default). Edit `params.feeds` in the config to add or remove sources.
- `sources/peer-posts/` — peer-posts. Autoresearch agent (Sonnet 4.6 via Anthropic SDK + tool use) that rotates seed handles, fetches their recent tweets via twitterapi.io, scores relevance to my niche, traverses search results to discover new accounts, and emits a distilled patterns analysis + top tweets. State (rotation cursor, scores, blacklist) lives in `sources/peer-posts/.state.json`. Requires `TWITTERAPI_IO_KEY` and `ANTHROPIC_API_KEY` in `.env.local`. Edit `params.seedHandles` to curate the seed pool.

To add a new source: create `sources/<name>/source.config.json` (and optionally `fetch.mjs`). No changes needed elsewhere — the orchestrator and drafting agent discover it automatically. By convention, fetched sources gitignore their `latest.md` (it's regenerated each sync) — drop a `.gitignore` containing `latest.md` next to the `fetch.mjs`.

## Research phase
- Run `npm run sync` first — refreshes all fetched sources. The primary trending signal is `sources/rss-trending/latest.md` (last ~48h of feed items); recent project commits land in `sources/github-commits/latest.md`. Never clone repos into this workspace.
- Optionally search the web for additional context not covered by the configured feeds.
- Distill the run's trending signal (RSS items + any extra web findings) into a curated `## YYYY-MM-DD` section appended to `sources/trending/latest.md` (keep the frontmatter at the top). This is the long-running history; rss-trending is the volatile feed.

## Profile sync phase
- Search the web for recent posts from @octavicristea (try queries like "from:octavicristea site:x.com" or "octavicristea twitter"). Extract the last 10 posts with their text and any visible engagement.
- Read posted/archive.md for engagement data on past posts.
- Scan the last 14 days of files in drafts/ to see what topics were recently generated.
- Update `sources/x-profile/latest.md` (preserve the frontmatter) with:
  - Recent posts: last 10 posts found (text + engagement if visible)
  - Topics covered: extracted from recent posts and drafts over last 14 days
  - Content gaps: compare all content angles from every file in config/projects/ against topics covered — flag any angle not posted about in 14+ days
  - Current narrative: one paragraph summarizing what I'm publicly building and talking about right now
  - Top performing: pull highest engagement posts from posted/archive.md
- This file is the system's memory. Always read it before drafting.

## Drafting rules
- Save drafts to `drafts/YYYY-MM-DD.md`.
- Commit with message `daily drafts YYYY-MM-DD`.
- **Single tweets: 280 characters max. Hard limit.**
- Max 1 emoji per post, zero preferred.
- Every post needs a specific technical detail — never vague.
- Never repeat a topic I posted about in the last 7 days (check x-profile.md recent posts and topics covered).
- Prioritize content gaps — angles from any project in config/projects/ that haven't been covered recently.
- At least one draft per run should address a content gap.
- Tag each draft with the project name it relates to (or "general" for cross-project posts).

## Autoimprove (optional, before approval)

After drafting, run `npm run enhance` to score each single-tweet draft against `sources/peer-posts/latest.md` patterns + `config/voice.md` and stamp three new metadata lines onto the draft:
- `**Score:**` — 4-axis rubric (specificity, hook, length, pattern_match)
- `**Critique:**` — 2-3 sentence direct critique
- `**Refined:**` — single-line rewrite ≤ 280 chars

Threads (drafts whose body is split into `### Hook (post 1)` style sub-sections) are skipped automatically. Already-enhanced drafts are skipped unless you pass `--force`. Single-draft mode: `npm run enhance -- --draft=3`.

## Approval & posting

The poster (`scripts/post.mjs`) reads inline metadata to decide what to send to X.

To approve a draft for posting:
- `**Status:** approved` — posts the original body (the `> ` blockquote)
- `**Status:** approved-refined` — posts the `**Refined:**` value instead (requires `npm run enhance` to have stamped one)
- The poster only fires on drafts where `Posted` is empty and status is one of the above.

Workflow:
1. `npm run enhance` — (optional) score + refine drafts.
2. `npm run post:dry` — preview which drafts would post, with char counts.
3. `npm run post` — actually post (requires `.env.local` with X API keys).
4. After success, the poster stamps `**Posted:** <ISO timestamp>` and `**TweetURL:** <url>` back into the draft, and appends an entry to `posted/archive.md` (with `Variant: original|refined`).

Hard limits enforced by the poster (do not bypass):
- Max 3 posts per invocation (bug-blast safety).
- Body must be ≤280 chars.
- Threads not supported in v1 — single tweets only.

## Banned phrases (from voice.md)
Never use any of these:
- "game-changer"
- "dive deep"
- "here's the thing"
- "let me explain"
- "thread :thread:"
- "hot take:"
- "unpopular opinion:"
- "let's talk about"
- "I'm excited to announce"
