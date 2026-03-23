# x-engine — Claude Code Instructions

This repo generates daily X/Twitter post drafts for @octavicristea.

## Branch
- Always work on the `main` branch. Never create or push to `master`.

## Skills
- The x-writing skill is installed at `.claude/skills/x-writing/` — never reinstall it during runs.

## Before writing any content
1. Always read `config/voice.md` for tone, style, and constraints.
2. Always read `config/projects.md` to know what to write about.
3. Always read `sources/x-profile.md` for current account context, recent posts, and content gaps.

## Research phase
- For each project in `config/projects.md`, use web search to check its GitHub repo for recent commits. Never clone repos into this workspace.
- Search the web for trending dev/AI/startup topics each run.
- Check `sources/raw-ideas.md` for manual ideas I've added.
- After searching for trending topics, append today's findings to `sources/trending-log.md` with a `## YYYY-MM-DD` date header before drafting. This builds a history of what was trending over time.

## Profile sync phase
- Search the web for recent posts from @octavicristea (try queries like "from:octavicristea site:x.com" or "octavicristea twitter"). Extract the last 10 posts with their text and any visible engagement.
- Read posted/archive.md for engagement data on past posts.
- Scan the last 14 days of files in drafts/ to see what topics were recently generated.
- Update sources/x-profile.md with:
  - Recent posts: last 10 posts found (text + engagement if visible)
  - Topics covered: extracted from recent posts and drafts over last 14 days
  - Content gaps: compare all content angles from config/projects.md against topics covered — flag any angle not posted about in 14+ days
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
- Prioritize content gaps — angles from projects.md that haven't been covered recently.
- At least one draft per run should address a content gap.

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
