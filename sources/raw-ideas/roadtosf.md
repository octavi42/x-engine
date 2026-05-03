# Raw Ideas — Road to SF

Building log dump from the ElevenLabs Hackathon #5 ship. Each item is a real, specific technical detail from the work.

---

## The $0.30/refresh image-regen bug
Stored generated scene images as base64 `dataUrl` in zustand session state, persisted via `sessionStorage`. Zustand's `partialize` was stripping the `imageUrl` field on rehydrate, so on every refresh the page-load effect saw "no image yet" and re-fired image-gen. Cost: ~$0.30 per refresh.

Fix: rewrote `/api/generate-image` to upload the OpenAI b64 result via `@vercel/blob` `put()`, return `{ url, format }`, drop `dataUrl` from the result type, keep `imageUrl` in the partialize allowlist. ~15 lines diff. Bonus: blob URLs survive deploys, dataUrls didn't.

Lesson: never persist large blobs to client storage when the regenerator is non-idempotent and expensive.

---

## Hiding 5s arc generation behind a "level"
The episode arc generation takes 4-6s with Sonnet 4.6 even with streaming. Instead of optimizing the model call, the loading screen became gameplay: the player sees "you just landed at SFO, your co-founder is texting you" while the LLM finishes.

Then the next-level pattern: pre-fire the *next* episode in the background while the player walks the final scene of the current one. By the time they finish, the next arc + scene 0 image are warm.

Pattern: latency-hiding via level design, not faster inference.

---

## Silicon Mania grounding (real news → fate)
Got asked on X if the AI hallucinates Peter Thiel quotes. It doesn't.

Pipeline:
1. Weekly Haiku 4.5 scrape of `siliconmania.tv/weekly` → structured JSON `{headline, summary, category, tags, people, companies, vcs}`. ~30-40 items/week, stored by ISO week in Postgres.
2. `selectFlavorPool(playerTags, 4)` — Jaccard(player tags ∩ item tags) + 0.15 if `category=cameo` + 0.1 if item names a real person. Top 4.
3. Inject into the episode prompt under `## REAL SF TECH NEWS — THIS WEEK` with "MUST name at least one verbatim".

Names are real. Lines are model-written. No quoted speech ever survives the digest.

---

## Autoplay-blocked typewriter
Prod fresh tabs froze on the dialogue scene. Browser blocked `audio.play()` because no user gesture had happened yet.

Fix: on play() rejection, attach one-shot `pointerdown` and `keydown` listeners on document, retry play on first gesture. 6s safety timer flips `audioEnded` so the typewriter falls back to fixed cadence and reveals the line silently as last resort.

Net effect: words always show up, audio syncs once the user touches anything.

---

## ElevenLabs Scribe Realtime STT
Voice input on the text panel. Server route mints a 15-min single-use token from `ELEVENLABS_API_KEY` (must have `speech_to_text` scope, not enabled by default). Browser `useScribe` from `@elevenlabs/react` connects with `scribe_v2_realtime` and `CommitStrategy.MANUAL`.

UX: snapshot textarea into a ref before connect, overlay partials in real-time, concat committed segments on commit. `echoCancellation` + `noiseSuppression` on the mic stream. Mic button toggles state.

Failure mode if scope missing: 401 `missing_permissions` from token mint. Took 5 minutes to diagnose because the symptom is in the browser but the cause is server-side.

---

## Cast persistence across procedural episodes
Each new episode is a fresh LLM call. To stop the cast from morphing every 5 scenes: snapshot `{name, voiceId, visualLook}` per character into the run state, pass them back in as constraints in the next episode prompt.

Two side bugs from this:
- Sonnet sometimes returns malformed cast shapes when forced to pivot — added a tolerator.
- Real-actor name collisions (NPC "Dev Patel" → renamed `Devraj Mehta`).

Cast cap of 1 real-figure per episode — more than that breaks the "rare cameo" feeling.

---

## Hackathon-ship gotchas worth a post
- Resend default `onboarding@resend.dev` only delivers to the account owner → 403 OTP for every visitor on launch day. Fix: verify domain, set `RESEND_FROM`, redeploy.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is baked at build time — must be set on Vercel *before* the prod build, and you must uncheck "Use existing Build Cache" on the redeploy after swapping live keys.
- Stripe statement descriptor: short brand, no phone, `ROADTOSF` / `RTSF`. Recognition prevents chargebacks; phone implies staffed support you don't have.
