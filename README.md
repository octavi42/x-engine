# x-engine

Personal X/Twitter content engine powered by Claude Code scheduled tasks.

## Adding a new project

Drop a `.md` file in `config/projects/` with this format:

```markdown
# Project Name

- **Repo:** https://github.com/user/repo
- **Description:** One-line description of the project.
- **Stack:** Tech 1, Tech 2, Tech 3
- **Status:** actively building | paused | launched
- **Content angles:**
  - Angle 1
  - Angle 2
```

Optionally create a matching `sources/raw-ideas/<project-name>.md` for project-specific idea dumps.

That's it — the engine picks it up on the next run.

## Workflow

1. **Add projects** — Drop project files into `config/projects/`
2. **Raw ideas** — Throughout the day, dump thoughts into `sources/raw-ideas/`
3. **Daily AI drafts** — Claude Code reads voice profile, checks project repos, scans trending topics, and generates drafts in `drafts/YYYY-MM-DD.md`
4. **Review** — Review, edit, or kill drafts
5. **Approve** — Add `**Status:** approved` to a draft's metadata block
6. **Post** — `npm run post` publishes approved drafts to X, stamps the draft with the tweet URL, and appends to `posted/archive.md`

See [`docs/roadmap.md`](docs/roadmap.md) for planned work (image attachments via gpt-image-2, cron auto-posting, engagement sync, thread support).

## Posting

```bash
cp .env.local.example .env.local   # then fill in your X API keys
npm install
npm run post:dry                    # preview which drafts would post
npm run post                        # actually post
```

X API keys come from `developer.x.com` → your Project → App → Keys and tokens. The app needs **Read and Write** permission. Auth is OAuth 1.0a User Context.

Hard limits: max 3 posts per run, ≤280 chars per tweet, single tweets only (threads not supported in v1).

## Structure

```
config/
  voice.md                  — tone, style, banned phrases
  projects/                 — one .md file per project (modular)
    historai.md
sources/
  raw-ideas/                — per-project idea dumps
    historai.md
    general.md              — cross-project ideas
  x-profile.md              — auto-updated account context
  trending-log.md           — auto-populated trending topics
drafts/                     — daily draft files
posted/
  archive.md                — published posts + engagement tracking
scripts/
  post.mjs                  — approval-gated X poster (single tweets, OAuth 1.0a)
  lib/
    parse-drafts.mjs        — markdown → draft objects
    stamp-draft.mjs         — write Posted/TweetURL back into the draft
    x-client.mjs            — twitter-api-v2 wrapper
.env.local.example          — required env keys (X API)
package.json                — npm run post / npm run post:dry
```
