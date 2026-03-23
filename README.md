# x-engine

Personal X/Twitter content engine powered by Claude Code scheduled tasks.

## Workflow

1. **Raw ideas** — Throughout the day, dump thoughts and links into `sources/raw-ideas.md`
2. **Daily AI drafts** — Claude Code reads my voice profile, checks project repos for recent activity, scans trending topics, and generates draft posts in `drafts/YYYY-MM-DD.md`
3. **Review** — I review, edit, or kill drafts
4. **Post** — Publish to X, then move to `posted/archive.md` with engagement notes

## Structure

```
config/voice.md      — tone, style, banned phrases
config/projects.md   — projects to write about
sources/raw-ideas.md — manual idea dump
sources/trending-log.md — auto-populated trending topics
drafts/              — daily draft files
posted/archive.md    — published posts + engagement tracking
```

---

**[View landing page](https://octavi42.github.io/x-engine)** — Apple Glass design, powered by GitHub Pages
