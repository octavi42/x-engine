# Autonomous-Company Tool

- **Repo:** none
- **Description:** Observes how a company actually operates via metadata signals and produces a ranked map of automation zones tight enough to justify deeper telemetry on the top 1–3 flows.
- **Stack:** Google Calendar API, Slack/Teams audit APIs, Google Workspace audit logs, Notion API, Bill.com/Ramp/Coupa/NetSuite APIs, graph schema (action nodes, handoff edges)
- **Status:** sketch
- **Content angles:**
  - Why mapping the org graph before automating it is the missing step everyone selling AI agents skips
  - Metadata-only observation: the four signals (calendar, messaging, doc edits, SaaS audit logs) that capture graph shape without touching content
  - Why screen recording and keystroke logging fail the "needed for ranking, not proving" test
  - Defining a node as `(actor, verb, object, t)` in 5-minute windows — and why granularity decisions break process maps
  - Handoff edges need a causality proxy (artifact reference), not bare temporal correlation — the honesty tax on graph builders
  - Three-bucket autonomy-readiness (A/B/C) instead of 0–1 floats: why fake precision dies in the falsifier
  - The 50-instance historical-replay falsifier: how to ship a rubric only after one round survives
  - Invoice-approval routing as the wedge: explicit handoffs, CFO-legible ROI, no causality inference needed
  - GDPR reality check: metadata is still personal data — DPIA + purpose limitation on day one, not as a retrofit
  - Why Celonis-style process mining sells to compliance and leaves the autonomy-planning wedge open for founders
  - The ICP shape for design partner #1: 100–400 FTE, post-Series-B, finance as cost center, no automation team
  - Selling the ranked map, not the automation — flipping the Sierra/Decagon/Cognition pitch


<!-- _source_hash: 90758ce852dcfa9e -->
<!-- _source_path: ~/Documents/Obsidian Vault/1-Projects/autonomous-company-tool/README.md -->
<!-- _discovered_at: 2026-05-15T16:13:58.905Z -->
