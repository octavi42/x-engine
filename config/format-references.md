# Format Reference Library

The drafting agent must pick exactly one format from this menu for every draft and name it in the draft's `Type:` line. Formats marked `NYI` (not yet implemented) are visible to the agent but must not be drafted until their output pipeline ships.

Hand-curated. Updated when a new format proves itself on `posted/archive.md` engagement.

---

## Single-tweet formats (output: one tweet, ≤280 chars)

### bug-fix
- **Shape:** `cause:` → `symptom` → `fix:` with a named technical detail.
- **Strong opener:** label the failure state (`cause:`) rather than scene-setting prose.
- **Use for:** roadtosf, clio, ugc-discovery, velocity engineering posts.
- **Reference:** my own #2 and #3 by likes in `posted/archive.md` — both opened with `cause:` labels.

### stack-reveal
- **Shape:** `<input>` → `<component A>` → `<component B>` → `<output>`, with named tools and at least one metric (latency, cost, accuracy).
- **Connectors:** arrow `→`, not em dash.
- **Use for:** any project's pipeline reveal post.

### outlier-exposé
- **Shape:** specific named subject + counter-intuitive data point + one-line analysis.
- **Lead with the surprise.** Name the entity (handle, company, repo). Give the number. One-line why.
- **Requires data anchor** — pull from `sources/velocity-data/` or similar. Never fabricate the number.
- **Use for:** velocity weekly drops (text version while image-output is NYI).

### ship-gotchas
- **Shape:** "N <thing> launch-day landmines:" → arrow-list of N named issues with fix on each.
- **N = 2 or 3** typically. Each item must be specific enough that another dev recognizes the trap.
- **Use for:** roadtosf, clio, any post-launch retro.

### trending-reaction
- **Shape:** personal-observation opener + the trending event + how it lands against your current work.
- **Don't open as a press release** ("Anthropic shipped...") — open with the contrast or the gap it fills.
- **Source:** `sources/rss-trending/latest.md` and `sources/trending/latest.md`.

### contrarian-take-with-data
- **Shape:** "everyone says X. data says Y." + one specific number + one-line implication.
- **Requires data anchor.** Don't post contrarian-without-data — it reads as posturing.
- **Use for:** velocity (when leaderboard data is in), peer-posts patterns, paid-creator economics.

---

## Image-post formats (NYI — image renderer not yet built)

These formats are visible to the agent for *planning* (e.g., reserving a Monday-morning slot for the weekly leaderboard) but must NOT be drafted as outputs until the Satori renderer ships in Phase 3.

### synthesis-screenshot — `requires: image-renderer (NYI)`
- **Shape:** bold title → 3–5 H3 sections with bullets, rendered as a card-on-dark-bg PNG.
- **Caption:** 1–2 lines, ends with a hook to "see image."
- **Reference:** @benln "Jack Dorsey on how every company can now be a mini-AGI" (2026-05-13) — 451 likes / 31K views / 50 RTs in 3 hours.
- **Use for:** Velocity weekly leaderboard summaries, autonomous-company-tool manifestos, distilled podcast/talk takeaways.

### data-leaderboard — `requires: image-renderer (NYI)`
- **Shape:** title + ranked table/list of 5–10 items with delta column, rendered as PNG.
- **Caption:** 1 line naming the dataset window ("week ending YYYY-MM-DD · 3,011 YC startups").
- **Use for:** Velocity weekly drops once `sources/velocity-data/` ships.

---

## Thread formats (NYI — thread output not supported in v1)

### build-in-public-thread — `requires: thread-output (NYI)`
- **Shape:** 5–8 tweets. Hook → context → stack → 2–3 specific fixes/wins → repo link.
- **Use for:** weekend-ship recaps, manifesto posts. Currently use `stack-reveal` single-tweet as a smaller substitute.

---

## How the agent should choose

1. Filter formats to those not marked `NYI`.
2. Match to the project's `Content angles` line in `config/projects/<slug>.md`.
3. Prefer the format that **hasn't been used in the last 7 days** — see `sources/x-profile/latest.md` "topics covered" to check.
4. Stamp the chosen format name on the draft as `**Format:** <name>`.
