# Comment-hunter run log

Append-only record of every hunt run (non-dry). Each section logs the
funnel — what was searched, scored, notified, and rejected. Rejection
reasons are captured so threshold tuning is data-driven.

---

## 2026-05-05 17:33 UTC

Searched: **67** unique · Scored: **6** · Notified: **3**

### Notified

- **@OfficialLoganK** · 58.5× · 324❤ 57💬 in 72m · vel 6.12/min vs author median 0.10 → 58.5×
  - URL: https://x.com/OfficialLoganK/status/2051698665652412919
  - Tweet: Today we are rolling out edit mode in AI Studio Vibe Coding ✏️, select components to quickly edit them, annotate right on the UI with a pen, and select image assets to change them with Nano Banana + upload content! https://t.co/Ct9H98o3iT
  - Suggestion: annotation-on-UI beats text descriptions for grounding — coords collapse component ambiguity fast. what does the model see: full page screenshot with overlay, or just the selected region crop?
  - Reasoning: Picks up the specific annotation feature, adds the missing technical mechanism (spatial grounding vs text, full-frame vs crop context window), and ends with a sharp implementation question that pulls OP into answering.
  - Query: `("AI coding" OR "vibe coding" OR "AI engineer") -airdrop -token -$`

- **@zodchiii** · 20.6× · 258❤ 7💬 in 83m · vel 3.28/min vs author median 0.16 → 20.6×
  - URL: https://x.com/zodchiii/status/2051695810702717052
  - Tweet: > start a new project > open Claude Code > no CLAUDE.md > Claude doesn't know your stack > "can I edit this file?" yes > click Allow 30 times > realize .env was read 5 minutes ago > spend 2 hours configuring everything > start next project > do it all over again from scratch > there's a starter kit that does all of this in 5 minutes
  - Suggestion: the .env read is the real one — ~/.claude/CLAUDE.md as global template + deny rules in ~/.claude/settings.json means every new project inherits them, zero re-clicks
  - Reasoning: Pins on the sharpest concrete pain point (silent .env read), then adds a specific mechanism OP didn't mention (global ~/.claude/ layer) that partially invalidates the "start from scratch" premise — inviting OP and others to push back or confirm.
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

- **@willmenaker** · 7.2× · 147❤ 5💬 in 18m · vel 8.92/min vs author median 1.25 → 7.2×
  - URL: https://x.com/willmenaker/status/2051712261647978735
  - Tweet: "A spokesperson for New York City Mayor Zohran Mamdani declined to comment on the Israeli real estate expo"
  - Suggestion: no comment from a mayor's office isn't neutral — it's a signal. costs nothing diplomatically, signals disapproval to the base, and keeps deniability if the optics shift.
  - Reasoning: Adds a political-comms mechanism the OP left implicit (strategic silence as low-cost signaling), which invites the OP and readers to agree or push back on the framing — high reply bait.
  - Query: `("React Native" OR Expo OR "mobile dev") -airdrop -token -$`

### Rejected (top 1 scored)

- @MarioNawfal · 2.1× · 317❤ 37💬 in 76m · vel 5.18/min vs author median 2.49 → 2.1×
  - 🇹🇷 Turkey just unveiled its first ever intercontinental ballistic missile. Called the Yildirimhan, it went public today at the SAHA 2026 defence expo in Istanbul, built entirely in-house by Turkey's
  - Query: `("React Native" OR Expo OR "mobile dev") -airdrop -token -$`

---
## 2026-05-06 12:56 UTC

Searched: **47** unique · Scored: **8** · Notified: **3**

### Notified

- **@HeartyFgs** · 44.2× · 51❤ 36💬 in 76m · vel 1.62/min vs author median 0.04 → 44.2× · controversy 0.71 (replies/likes)
  - URL: https://x.com/HeartyFgs/status/2051990196904673281
  - Tweet: here are the Arcs we’ve had so far this year. - Ai Arc - Reply Guy Arc - Lists Arc - Rug / Drains Arc - Trends Arc - vibe-coding Arc - Unemployment Arc Which of these did you participate in? https://t.co/ANWp4Ku4WO
  - Suggestion: vibe-coding is the only arc here that left artifacts outside X. the rest are engagement behaviors. one produced repos, the others produced impressions.
  - Reasoning: Draws a sharp technical distinction between production arcs and social arcs — a counter-angle the OP didn't name — which gives developers something concrete to agree with or push back on, pulling both OP and replies into the thread.
  - Query: `("AI coding" OR "vibe coding" OR "AI engineer") -airdrop -token -$`

- **@unclebobmartin** · 35.0× · 110❤ 16💬 in 51m · vel 2.80/min vs author median 0.08 → 35.0×
  - URL: https://x.com/unclebobmartin/status/2051996501245575254
  - Tweet: In this letter, the CEO of Coinbase talks about non-technical teams shipping production code. Honestly, I don’t think he knows what he’s talking about. Using AI agents makes it possible for teams who are not deeply technical in the syntax of a language to ship production code. But that team had better be very deeply technical in managing the structure and quality of the code that is produced. What
  - Suggestion: syntax is learnable in days. spotting a god class or tight coupling takes years of pattern-matching — and AI will generate both without complaint when the prompter can't reject them.
  - Reasoning: Mirrors Uncle Bob's own Clean Code vocabulary (god class) to signal genuine fluency, then adds the specific failure mechanism he omitted: AI produces architectural antipatterns silently, so the bottleneck is recognition, not generation — provocative enough to pull a reply from him.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- **@YellowMedia_HQ** · 18.9× · 70❤ 15💬 in 36m · vel 2.75/min vs author median 0.15 → 18.9×
  - URL: https://x.com/YellowMedia_HQ/status/2052000140165251263
  - Tweet: Google Cloud Taps Solana to Enable Stablecoin Payments for AI Agents https://t.co/gByqsTdpyl
  - Suggestion: solana finality (~400ms, $0.00025/tx) makes agent micropayments viable, but the real blocker is key custody — who holds the private key when the agent is a stateless lambda?
  - Reasoning: Acknowledges the Solana-specific technical choice, then surfaces the unsolved problem (key custody for stateless agents) that practitioners will debate, driving replies from infra engineers and founders thinking through the same architecture.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

### Rejected (top 2 scored)

- @mitang_____ · 0.2× · 138❤ 0💬 in 79m · vel 1.74/min vs author median 9.49 → 0.2×
  - 26.05.06 | THAILAND DIVE EXPO 2026 🥑🛟 : ปะป๊าน้องซี AVOCEAN DIVING X TDEX #AVOCEANxTGDO2026 @avocean_GMMTV #AVOCEAN https://t.co/h6s7wZlqW0
  - Query: `("React Native" OR Expo OR "mobile dev") -airdrop -token -$`

- @coingecko · 2.1× · 47❤ 28💬 in 55m · vel 1.89/min vs author median 0.91 → 2.1× · controversy 0.60 (replies/likes)
  - Your crypto AI agent is only as smart as the data it consumes 🤖🦞 We had a great time at @OpenclawKL showcasing how to integrate real-time crypto market data directly into @openclaw agents – using th
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

---
## 2026-05-07 16:13 UTC

Searched: **57** unique · Scored: **8** · Notified: **3**

### Notified

- **@brian_armstrong** · 243.0× · 237❤ 63💬 in 24m · vel 15.41/min vs author median 0.06 → 243.0×
  - URL: https://x.com/brian_armstrong/status/2052415200981115172
  - Tweet: Now AI agents on AWS can pay for services in USDC, settled on @base
  - Suggestion: how do spend limits work per invocation? shared wallet + a runaway retry loop and it's empty before cloudwatch notices
  - Reasoning: Shape C — points at the real unsolved engineering problem (per-invocation spend caps on a shared wallet) with a concrete failure mode, sounds like an engineer who's actually thought about deploying this.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- **@SuhailKakar** · 33.3× · 95❤ 14💬 in 80m · vel 1.53/min vs author median 0.05 → 33.3×
  - URL: https://x.com/SuhailKakar/status/2052400942369386638
  - Tweet: watching people vibe code apps with zero security sense is crazy exposed api keys, no auth, prod secrets in client code - one push from a 40k openai bill and a leaked db i spent 6 years building apps used by millions, packaged my non-negotiables into 20 skills for claude code + codex - link below
  - Suggestion: hit this on roadtosf — stripe live key in NEXT_PUBLIC_* because the dashboard snippet defaulted to it. baked into the client bundle at build. caught it before prod, barely.
  - Reasoning: Shape A lived experience: anchors to a real shipped project with a specific Next.js footgun (NEXT_PUBLIC_* bakes secrets into the client bundle), directly matching the tweet's "prod secrets in client code" complaint with a concrete near-miss.
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

- **@marclou** · 24.7× · 160❤ 44💬 in 59m · vel 4.23/min vs author median 0.17 → 24.7×
  - URL: https://x.com/marclou/status/2052406367785566210
  - Tweet: 2026 goal: make all my startups AI-first. I'm starting with @DataFast_: ✅ Open all API endpoints ✅ llms.txt & markdown docs ⬜️ CLI (in progress) ⬜️ MCP ⬜️ Generative UI ⬜️ Onboarding w/ paywall At the speed AI is going, I think a lot of front-end will disapear and SaaS will be mostly backend. AI assistants will do the UI.
  - Suggestion: who owns session state when generative UI regenerates the page on every turn
  - Reasoning: Shape C — targets the one unsolved implementation detail behind "AI assistants will do the UI," sounds like an engineer who's actually hit this wall rather than a cheerleader.
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

### Rejected (top 2 scored)

- @Cointelegraph · 2.3× · 106❤ 22💬 in 32m · vel 4.65/min vs author median 1.99 → 2.3×
  - 🔥 JUST IN: Coinbase integrates x402 payments into Amazon Bedrock AgentCore, enabling AI agents to make USDC micropayments on Base and Solana. https://t.co/GonpMNgybs
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- @Cointelegraph · 1.0× · 57❤ 34💬 in 63m · vel 1.99/min vs author median 2.04 → 1.0× · controversy 0.60 (replies/likes)
  - 🔥 INSIGHT: “If we believe AI agents are going to be economically important actors, we need a financial system that looks a lot like DeFi,” says @a16zcrypto GP Guy Wuollet. https://t.co/i6hdqr3sXZ
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

---
## 2026-05-08 15:47 UTC

Searched: **42** unique · Scored: **9** · Notified: **3**

### Notified

- **@AIFrontliner** · 280.5× · 110❤ 9💬 in 45m · vel 2.83/min vs author median 0.01 → 280.5×
  - URL: https://x.com/AIFrontliner/status/2052765511448969249
  - Tweet: The creator of Claude Code teaches more about vibe-coding in 30 minutes than most tutorials do in hours. Save this — it'll change how you build forever. https://t.co/x9jgGL1ApT
  - Suggestion: claude code writes confidently wrong types. without reading the output, you won't catch it until runtime.
  - Reasoning: Shape B counter — anchors the vibe-coding hype with a concrete failure mode (type errors) and a mechanism (confident-but-wrong output you miss by not reading), no AI tells stacked, sounds like an engineer who's been burned.
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

- **@XenBH** · 122.5× · 82❤ 27💬 in 39m · vel 3.45/min vs author median 0.03 → 122.5× · controversy 0.33 (replies/likes)
  - URL: https://x.com/XenBH/status/2052766975944806785
  - Tweet: AI agents will need to pay for things. API calls, compute, data, other agents' services. They can't pull out a credit card. They need payment rails that work without a person in the loop. x402 is a protocol for this. Base processes the majority of x402 agentic payment transactions. The Foundation behind it includes Cloudflare, AWS, Google, Stripe, Visa and Mastercard. I think the vast majority of 
  - Suggestion: what's the spending limit model? agent with open-ended payment authority + untrusted tool calls = prompt injection with a credit card.
  - Reasoning: Shape C — points to the unsolved authorization layer that x402 doesn't address, with a concrete attack vector (prompt injection + uncapped spend) that a real agent-builder would immediately worry about.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- **@YumaGroup** · 103.7× · 68❤ 9💬 in 52m · vel 1.65/min vs author median 0.02 → 103.7×
  - URL: https://x.com/YumaGroup/status/2052763807953375540
  - Tweet: Check out TaonSquare, where builders can explore all the AI tools powered by Bittensor. Review subnet capabilities, pricing, API details and more, or let your agents do it via MCP. https://t.co/C03ZdoHdua
  - Suggestion: how does pricing come through in the MCP tool response — structured enough for an agent to compare options without extra parsing?
  - Reasoning: Shape C pointed question targeting the specific unsolved technical detail: whether the MCP schema exposes pricing in a machine-readable form or forces downstream parsing — the exact thing a builder integrating this would need to know before committing.
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

### Rejected (top 1 scored)

- @eng_khairallah1 · 2.6× · 27❤ 16💬 in 54m · vel 1.09/min vs author median 0.42 → 2.6× · controversy 0.59 (replies/likes)
  - The Head of Claude Code at Anthropic said he hasn’t written code by hand in months. In 2 days he shipped 49 full features. All written 100% by AI. He just dropped a 30 min talk on exactly how he does 
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

---
## 2026-05-09 15:04 UTC

Searched: **32** unique · Scored: **9** · Notified: **3**

### Notified

- **@orangie100x** · 342.3× · 65❤ 17💬 in 90m · vel 1.10/min vs author median 0.00 → 342.3×
  - URL: https://x.com/orangie100x/status/2053106098031272423
  - Tweet: This vibe coder told Orangie that he made 47,000$ in just 45 days through vibe coding https://t.co/u2oe3OY8VR
  - Suggestion: what's the actual product? $47k gross in 45 days with no churn context is impossible to evaluate
  - Reasoning: Shape C — one pointed question that exposes the missing mechanic (churn/recurring vs. one-time), sounds like an engineer stress-testing a claim rather than hyping or dunking it.
  - Query: `("AI coding" OR "vibe coding" OR "AI engineer") -airdrop -token -$`

- **@Build4ai** · 173.5× · 135❤ 22💬 in 62m · vel 2.88/min vs author median 0.02 → 173.5×
  - URL: https://x.com/Build4ai/status/2053113042536374313
  - Tweet: BNBChain is ABSOLUTELY DOMINATING AI Agent adoption! Just look at NfaScan: • 142K AI agents on @BNBCHAIN → 66.6% market share 🔥 While others talk, BNBCHAIN delivers. The AI agent revolution is happening on the fastest, cheapest, and most scalable chain. #BNBChain #AIAgents
  - Suggestion: 142K deployed isn't 142K running. what's the 30-day active count, wallets that actually fired a tx?
  - Reasoning: Shape C question that cuts the vanity metric with a concrete mechanism — deployed count vs. active tx count is the real signal engineers care about, and it exposes the hype without being a hot take.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- **@reppo** · 45.6× · 39❤ 5💬 in 41m · vel 1.21/min vs author median 0.03 → 45.6×
  - URL: https://x.com/reppo/status/2053118458146197960
  - Tweet: Reppo CLI is shipped 🚀 After 🚢 the Reppo Agent natively on https://t.co/X6MDpwugNx, we are now releasing a non-interactive CLI built so agents like Hermes, OpenClaw, Claude Code, and others can interact with @Reppo directly: mint pods, vote, lock REPPO, query balances, manage datanet access, and more. This is a big step toward making Reppo programmable, agent-native, and easier to build on. Try 
  - Suggestion: curious how auth works when Claude Code shells out to this. wallet key in env vars, or does the agent need to sign each tx separately?
  - Reasoning: Shape C — points to the real unsolved question for anyone wiring an agent to this CLI: key management for non-interactive signing, with a concrete split (env vars vs per-tx signing) that engineers actually debate.
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

### Rejected (top 1 scored)

- @RoundtableSpace · 2.6× · 97❤ 15💬 in 78m · vel 1.62/min vs author median 0.62 → 2.6×
  - CLAUDE CODE CAN NOW PULL LIVE DATA FROM 17,000+ STOCKS, CRYPTO PRICES, AND FINANCIAL STATEMENTS IN SECONDS. https://t.co/lLtS2I0IGA
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

---
## 2026-05-10 15:06 UTC

Searched: **32** unique · Scored: **8** · Notified: **3**

### Notified

- **@Investanswers** · 46.3× · 77❤ 13💬 in 21m · vel 4.93/min vs author median 0.11 → 46.3×
  - URL: https://x.com/Investanswers/status/2053486054825717862
  - Tweet: $SOL Alpenglow is now live - rem in the AGE of AGI FINALITY IS THE PRODUCT - SOL is 5000 to 6000 times faster than ETH... AI Agents will not hang around for 15 mins... to see if a Tx has finalized. #Solana $ETH https://t.co/bZYBIA1dQ7
  - Suggestion: 15min is economic finality, not pre-confirm. ETH slot is 12s. 30x slower than solana, not 5000x
  - Reasoning: Shape B correction — calls out the apples-to-oranges comparison (economic finality vs slot time) with three concrete numbers, no hype language, reads like an engineer who actually knows the spec.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- **@The_CoDEFi** · 42.7× · 42❤ 31💬 in 62m · vel 1.69/min vs author median 0.04 → 42.7× · controversy 0.74 (replies/likes)
  - URL: https://x.com/The_CoDEFi/status/2053475784208355753
  - Tweet: Manual research is slowly becoming outdated (( @heyaura is building an AI agent that: • studies your onchain activity • tracks market opportunities • suggests yields & airdrops • helps optimize portfolio moves • works across EVM chains Already: ▫️17K+ users ▫️$500M+ wallet volume analyzed ▫️$ADX listed on major exchanges Web3 moves fast. Your wallet probably needs an AI copilot now
  - Suggestion: what does it consume per chain: raw RPC calls or an indexer? that gap matters a lot for data freshness across EVM at scale
  - Reasoning: Shape C — a pointed technical question targeting the real unsolved part (data layer architecture), with specific terms (RPC, indexer, freshness) that signal genuine engineering curiosity rather than hype engagement.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

- **@DeFiDecoder_** · 31.5× · 32❤ 20💬 in 72m · vel 1.01/min vs author median 0.03 → 31.5× · controversy 0.63 (replies/likes)
  - URL: https://x.com/DeFiDecoder_/status/2053473310890193293
  - Tweet: Keeping on the streak of being the most dev-friendly blockchain, @Polkadot $DOT is now fully LLM-friendly as well Lots of great tools for AI agents and devs to make life easier to developing with AI
  - Suggestion: what does LLM-friendly mean concretely here: predictable JSON-RPC schemas, on-chain data formatting, or just docs rewritten with AI prompts?
  - Reasoning: Shape C pointed question — the tweet makes a vague "LLM-friendly" claim with zero specifics, so a real engineer's natural move is to ask exactly what changed; naming three concrete candidate mechanisms (JSON-RPC schemas, data formatting, docs) shows domain knowledge without sounding like a marketer.
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

### Rejected (top 2 scored)

- @cyrilXBT · 2.8× · 47❤ 10💬 in 58m · vel 1.15/min vs author median 0.41 → 2.8×
  - Obsidian + Claude Code = 24/7 personal operating system. Works while you sleep. Every note you have ever written becomes searchable intelligence. Every project updates itself automatically. Every morn
  - Query: `("claude code" OR claude-code OR mcp) -airdrop -presale -giveaway -token -$`

- @Av1dlive · 2.1× · 31❤ 11💬 in 61m · vel 0.87/min vs author median 0.40 → 2.1× · controversy 0.35 (replies/likes)
  - In 17 minutes, Andrej Karpathy will teach you more about building ai agents than most people figure out in a year. Bookmark &amp; watch, no matter what. It'll be the most productive thing you do this 
  - Query: `("AI agents" OR "AI agent") -airdrop -presale -giveaway -$VIRTUAL -token -$`

---
