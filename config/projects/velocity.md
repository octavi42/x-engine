# Velocity

- **Repo:** https://github.com/octavi42/velocity (private)
- **Live:** https://velocity-web-roan.vercel.app
- **Description:** Pipeline that imports YC startups, snapshots their X follower counts daily, and ranks them by 7d/30d/90d growth. The first tool in a system of tools for starting a startup — answers "which YC founders are actually winning on X right now."
- **Stack:** Node, GitHub Actions (daily cron at 09:00 UTC), twitterapi.io, Vercel (UI), yc-oss/api for company import
- **Status:** v1 shipped 2026-05-13 (3,011 startups, 94% Day-0 coverage). First publishable 7d leaderboard: 2026-05-20. First 30d: 2026-06-12.
- **Content angles:**
  - Weekly leaderboard drop — "fastest-growing YC startups on X this week" (top 5 by 7d delta, named handles + numbers)
  - Outlier exposé — "this 200-follower YC company gained more followers this week than [big name]. here's the one post that did it"
  - Sub-1K underdog breakout — surface accounts in the 1,157-company underdog cohort that just doubled
  - Contrarian-take-with-data — "everyone says X grows on Twitter. data from 3,011 YC companies says Y"
  - Build-in-public weekend ship — "shipped Velocity in a weekend. 3,011 startups, daily cron, $0/mo stack. here's the GitHub"
  - System-of-tools framing — Velocity as tool #1, link to the manifesto
  - Day-0 baseline facts (one-time post) — largest tracked: @9GAG 15.9M / @Twitch 9.5M / @coinbase 6.9M. 187 dead accounts (suspended/deleted).
  - Methodology transparency — how the snapshot pipeline handles retries, throttle, idempotency, dead-account detection
