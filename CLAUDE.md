# x-engine — Claude Code Instructions

This repo generates daily X/Twitter post drafts for @octavicristea.

## Skills
- The x-writing skill is installed at `.claude/skills/x-writing/` — never reinstall it during runs.

## Before writing any content
1. Always read `config/voice.md` for tone, style, and constraints.
2. Always read `config/projects.md` to know what to write about.

## Research phase
- For each project in `config/projects.md`, use web search to check its GitHub repo for recent commits. Never clone repos into this workspace.
- Search the web for trending dev/AI/startup topics each run.
- Check `sources/raw-ideas.md` for manual ideas I've added.
- After searching for trending topics, append today's findings to `sources/trending-log.md` with a `## YYYY-MM-DD` date header before drafting. This builds a history of what was trending over time.

## Drafting rules
- Save drafts to `drafts/YYYY-MM-DD.md`.
- Commit with message `daily drafts YYYY-MM-DD`.
- **Single tweets: 280 characters max. Hard limit.**
- Max 1 emoji per post, zero preferred.
- Every post needs a specific technical detail — never vague.

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
