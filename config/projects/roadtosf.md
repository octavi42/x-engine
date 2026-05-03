# Road to SF

- **Repo:** https://github.com/octavi42/roadtosf
- **Live:** https://roadtosf.com
- **Description:** AI interactive-fiction game built for ElevenLabs Hackathon #5 — you pitch your startup, land in SF, and live a founder's first day with real cameos (Altman, Thiel, Graham) and choices that rewrite the story. Story, voices, images, and real-news grounding all generated fresh per game.
- **Stack:** Next.js 16, Claude (Sonnet 4.6 for arc gen, Haiku 4.5 for everything else), OpenAI for images, ElevenLabs (Scribe Realtime STT + voice), Vercel Blob, Neon Postgres, Stripe, Resend
- **Status:** launched
- **Content angles:**
  - Hiding LLM latency by pre-generating the next episode while the player walks the current scene
  - Grounding LLM stories in real-world news (Silicon Mania weekly scrape → Jaccard rank → inject top 4 as "name verbatim" fate)
  - Cost gotcha: storing base64 image dataUrls in sessionStorage = ~$0.30/refresh in image regen
  - Browser autoplay UX: typewriter dialogue falls back to gesture-retry + 6s safety timer
  - ElevenLabs Scribe Realtime STT integration — manual commit strategy + partial overlay
  - Cast persistence across procedurally-generated episodes (names, voices, looks preserved)
  - Hackathon-ship gotchas: Resend sandbox sender, Stripe live-mode `NEXT_PUBLIC_*` baked at build
  - The "mystery is the product" design principle — silent flavor-tag extraction vs. explicit menus
