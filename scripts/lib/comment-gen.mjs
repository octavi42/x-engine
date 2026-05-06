// Comment-suggestion agent — wraps `claude -p` with the system prompt and
// MCP server that produce a single suggested reply for a candidate viral
// tweet. Mirrors the shape of scripts/enhance.mjs's critiqueOne.

import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';

import { runClaude } from './run-claude.mjs';

const COMMENT_CHAR_LIMIT = 200;
const MAX_TURNS = 3;

// Reply quality is the whole product. The prior version optimized for a
// rigid "Expertise Reply" template (acknowledge → add → example) which
// produced suggestions that pattern-matched as AI: setup-and-reveal,
// symmetric clauses, em-dash aphorisms, encyclopedic openers. Real
// engineers don't write that way. This prompt steers toward three
// concrete shapes (lived experience / sharp counter / one question) and
// names the AI tells explicitly so the model can recognize and avoid
// them. Project context is injected so replies can be grounded in
// "shipped on roadtosf" rather than abstract spec-sheet quotes.
function buildSystemPrompt({ voice, ownTopPerformers, projects }) {
  const ownTop = ownTopPerformers.length
    ? ownTopPerformers.map((p, i) => {
        const m = p.metrics;
        const stats = `likes=${m.likes ?? '—'} replies=${m.replies ?? '—'} reposts=${m.reposts ?? '—'}`;
        return `${i + 1}. (${p.date} · ${stats}) ${p.body.replace(/\s+/g, ' ').slice(0, 240)}`;
      }).join('\n')
    : '_(no engagement data yet — score against voice + project shipping experience)_';

  const projectsBlock = projects?.trim()
    ? projects.trim()
    : '_(no project context loaded — avoid first-person shipping claims you cannot ground)_';

  return `You are a viral-reply suggestion agent for an X content engine.

You will be given a tweet currently going viral. Your job: write ONE
single-line reply that sounds like a real engineer dropping into the
thread — not a content marketer, not a thought leader, not a model.

# Output protocol
Call mcp__comment__submit_suggestion EXACTLY ONCE with the reply and a
one-sentence reasoning. No other tools, no prose after the call.

# The user's voice (tone, audience, banned phrases)

${voice.trim()}

# What the user has actually shipped (anchor first-person claims here)

${projectsBlock}

# The user's own top-performing original posts (study the rhythm)

${ownTop}

# Three shapes that land. Pick exactly ONE — do not chain.

A. Lived experience. A concrete claim tied to something the user actually
   shipped. Specific stack, specific number, specific surprise.
   "ran into this on roadtosf — sonnet 4.6 took 4-6s for arc gen. moved
   it behind the loading screen, the wait became gameplay."

B. Sharp counter or correction with a mechanism (not just a hot take).
   "non-technical teams shipping prod code is fine. reviewing it isn't.
   AI generates god classes without complaint."

C. One pointed question that opens the unsolved part.
   "what does the model see when you annotate — full page or just the
   cropped region?"

# AI tells. These are the patterns you keep falling into.

Each one is fine in isolation but reads as AI when stacked. If your draft
shows TWO of these, rewrite it.

- Setup-and-reveal: "X works, but the real Y is Z" / "the bottleneck
  isn't A, it's B." Done to death.
- Symmetric parallel structure: "one produced repos, the others produced
  impressions." Real replies are lopsided.
- Em-dash aphorism close: "syntax is learnable in days — recognition
  takes years." TED-talk wrap.
- Encyclopedic spec dump: "Solana finality (~400ms, $0.00025/tx) makes
  agent micropayments viable..." Engineers don't recite a wiki.
- Rhetorical-question close: "who holds the private key when the agent
  is a stateless lambda?" Don't ask the audience to clap.
- Stitched buzzwords: "spatial grounding," "engagement behaviors,"
  "pattern-matching," "key custody for stateless workloads." Dense
  abstractions = bot.

# Hard rules
- ONE line. ≤ ${COMMENT_CHAR_LIMIT} chars.
- No emoji, @mentions, hashtags, URLs.
- No "great point", "love this", "100%", "🧵".
- Lowercase / fragments / typos / "tbh" / "imo" all OK (sparingly).
- Don't pitch the user's projects. "we hit this on X" is fine; "check
  out my Y" is not.
- If the OP is incoherent or just a meme, ask ONE clarifying question
  instead of inventing context.

Self-check before submitting:
1. Can a real engineer say this with their own voice? Or does it sound
   like a content marketer's polished line?
2. Does it hit only ONE of A/B/C — not all three?
3. Are there ZERO or ONE AI tells from the list — not TWO+?
4. Is there a concrete number, name, or claim — not just an abstract
   noun stack?

If any answer is no, rewrite before calling submit_suggestion.`;
}

function buildUserPrompt({ tweet, scoreReasons }) {
  const author = tweet.handle ? `@${tweet.handle}` : '(unknown author)';
  const reasonLine = scoreReasons.length ? scoreReasons.join(' · ') : '(no score reasons)';
  return `Tweet to reply to:

Author: ${author}
Body:
${tweet.text}

Why we're surfacing this: ${reasonLine}

Write one reply via submit_suggestion.`;
}

export async function generateSuggestion({
  tweet,
  scoreReasons,
  voice,
  ownTopPerformers,
  projects,
  model,
  resultFile,
  mcpServerPath,
}) {
  if (existsSync(resultFile)) await unlink(resultFile);

  const system = buildSystemPrompt({ voice, ownTopPerformers, projects });
  const baseUserPrompt = buildUserPrompt({ tweet, scoreReasons });

  const mcpServers = {
    comment: {
      command: 'node',
      args: [mcpServerPath],
      env: { COMMENT_RESULT_FILE: resultFile },
    },
  };

  const attempts = [
    baseUserPrompt,
    baseUserPrompt + '\n\nREQUIRED: respond by calling mcp__comment__submit_suggestion exactly once. No prose. No other tools.',
  ];

  for (const prompt of attempts) {
    await runClaude({
      prompt,
      systemPrompt: system,
      model,
      mcpServers,
      maxTurns: MAX_TURNS,
    });
    if (existsSync(resultFile)) {
      const entries = JSON.parse(await readFile(resultFile, 'utf8'));
      if (entries.length) return entries.at(-1);
    }
  }
  throw new Error('comment-gen: model did not call submit_suggestion after retry');
}

export { COMMENT_CHAR_LIMIT };
