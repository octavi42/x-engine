# Velocity

- **Repo:** https://github.com/octavi42/velocity
- **Live:** https://velocity-web-roan.vercel.app
- **Description:** Daily X follower-growth leaderboard for 3,000+ YC startups, ranked by 7d/30d/90d deltas.
- **Stack:** Node.js, GitHub Actions, twitterapi.io, Vercel, Next.js, SQLite/Postgres
- **Status:** active
- **Content angles:**
  - Day-0 baseline: 2,851/3,038 YC accounts snapshotted (94% coverage) — the missing 187 are genuinely suspended X accounts
  - Why the underdog cohort matters: 1,157 YC startups under 1K followers is where the real growth signal will surface
  - Scraping 3,011 YC startups from yc-oss/api + ycombinator.com — what broke and how the merge resolved duplicates
  - Building idempotent daily snapshot pipelines: retry + throttle + dedup against twitterapi.io rate limits
  - The 7-day waiting game: you can't ship a growth leaderboard on day one — first publishable 7d list lands 2026-05-20
  - GitHub Actions as a cheap daily cron for data products — 09:00 UTC firing, end-to-end validated on run #4
  - Largest tracked accounts on the YC list: @9GAG 15.9M, @Twitch 9.5M, @coinbase 6.9M — the ceiling vs the floor
  - Future: multi-niche summary-image post automation inspired by Ben Lang's 451-like Jack Dorsey synthesis (31K views in 3h)
  - The Ben Lang format dissected: H2/H3 + bullets rendered as image escapes X's char limit and gets screenshot-shared
  - Shared infra vs per-niche pipeline: 15-20h for LLM summarizer + image renderer + scheduler, then 20-30h per niche
  - v2 discovery expansion: HN Show, GitHub trending, Product Hunt, CRT logs — beyond the YC walled garden
  - Bot/quality filtering with an LLM bio classifier — the unsolved layer between "follower count went up" and "actual humans"


<!-- _source_hash: 45fa035b5daea739 -->
<!-- _source_path: ~/Documents/Obsidian Vault/1-Projects/Velocity/Roadmap.md -->
<!-- _discovered_at: 2026-05-13T18:29:41.723Z -->
