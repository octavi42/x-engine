# x-engine — Claude Code Instructions

This repo generates daily X/Twitter post drafts for @octavicristea.

## Branch
- Always work on the `main` branch. Never create or push to `master`.

## Skills
- The x-writing skill is installed at `.claude/skills/x-writing/` — never reinstall it during runs.

## Before writing any content
1. Always read `config/voice.md` for tone, style, and constraints.
2. Always read every file in `config/projects/` to know what to write about.
3. Always read `sources/x-profile.md` for current account context, recent posts, and content gaps.

## Project structure
- Each project is a separate `.md` file in `config/projects/`.
- Each project file defines: repo URL, description, stack, status, and content angles.
- To add a new project, drop a new `.md` file in `config/projects/` — the engine picks it up automatically.
- Raw ideas are stored per-project in `sources/raw-ideas/<project-name>.md`, plus `sources/raw-ideas/general.md` for cross-project ideas.

## Research phase
- For each project file in `config/projects/`, use web search to check its GitHub repo for recent commits. Never clone repos into this workspace.
- Search the web for trending dev/AI/startup topics each run.
- Check all files in `sources/raw-ideas/` for manual ideas I've added.
- After searching for trending topics, append today's findings to `sources/trending-log.md` with a `## YYYY-MM-DD` date header before drafting. This builds a history of what was trending over time.

## Profile sync phase
- Search the web for recent posts from @octavicristea (try queries like "from:octavicristea site:x.com" or "octavicristea twitter"). Extract the last 10 posts with their text and any visible engagement.
- Read posted/archive.md for engagement data on past posts.
- Scan the last 14 days of files in drafts/ to see what topics were recently generated.
- Update sources/x-profile.md with:
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

## Approval & posting

The poster (`scripts/post.mjs`) reads inline metadata to decide what to send to X.

To approve a draft for posting:
- Add `**Status:** approved` to the draft's metadata block.
- The poster only fires on drafts where `Status=approved` AND `Posted` is empty.

Workflow:
1. `npm run post:dry` — preview which drafts would post, with char counts.
2. `npm run post` — actually post (requires `.env.local` with X API keys).
3. After success, the poster stamps `**Posted:** <ISO timestamp>` and `**TweetURL:** <url>` back into the draft, and appends an entry to `posted/archive.md`.

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
