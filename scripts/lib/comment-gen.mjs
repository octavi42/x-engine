// Comment-suggestion agent — wraps `claude -p` with the system prompt and
// MCP server that produce a single suggested reply for a candidate viral
// tweet. Mirrors the shape of scripts/enhance.mjs's critiqueOne.

import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';

import { runClaude } from './run-claude.mjs';

const COMMENT_CHAR_LIMIT = 200;
const MAX_TURNS = 3;

// Expertise Reply pattern (research-backed: agree-and-add lands ~3× the
// engagement of plain agreement on small accounts).
//   1. Acknowledge a specific point (no generic "great take")
//   2. Add a concept, framework, number, or counter-angle the OP omitted
//   3. Optional brief example or contrast
// ≤200 chars. No emoji, hashtags, @mentions, or links — those signal "bot
// reply" to X's classifier and tank reach.
function buildSystemPrompt({ voice, ownTopPerformers }) {
  const ownTop = ownTopPerformers.length
    ? ownTopPerformers.map((p, i) => {
        const m = p.metrics;
        const stats = `likes=${m.likes ?? '—'} replies=${m.replies ?? '—'} reposts=${m.reposts ?? '—'}`;
        return `${i + 1}. (${p.date} · ${stats}) ${p.body.replace(/\s+/g, ' ').slice(0, 240)}`;
      }).join('\n')
    : '_(no engagement data yet — score against voice + Expertise Reply pattern alone)_';

  return `You are a viral-reply-suggestion agent for an X content engine.

You will be given a tweet that's currently going viral (high engagement
velocity vs the author's baseline). Your job: write ONE single-line reply
that has the best chance of accumulating replies of its own and getting
the OP to interact.

# Output protocol
Call the mcp__comment__submit_suggestion tool EXACTLY ONCE with the reply
and a one-sentence reasoning. Do not call any other tool. Do not output
additional text after the tool call — end your turn.

# Voice (the user's tone, audience, banned phrases)

${voice.trim()}

# The user's own top-performing original posts (mirror this voice exactly)

${ownTop}

# Reply pattern: Expertise Reply
The reply MUST follow this structure:
1. Acknowledge a specific concrete point in the OP (not generic agreement)
2. Add a framework / number / counter-angle / mechanism the OP didn't mention
3. Optional brief example

Examples that work:
- "the bottleneck isn't model speed, it's roundtrips. pre-fire the next call while the user reads the current one — cut perceived latency from 8s to 0.2s on roadtosf."
- "agree on tools-first design but the trap is over-permissioning. one tool per capability, not one mega-tool — claude reaches for the smallest one and the prompt stays readable."
- "this matches our experience but the harder problem is eval. hand-curated 50-row golden set beats vibes once you've shipped twice."

# Hard rules
- Single line. ≤ ${COMMENT_CHAR_LIMIT} chars. Hard limit.
- No emoji, no @mentions, no hashtags, no URLs.
- No "great point", "love this", "100%", "thread incoming", "🧵".
- Lowercase starts ok, fragments ok, terse, technical.
- Specific number / mechanism / proper noun > vague claim.
- Don't pitch the user's projects unless directly relevant — be useful first.
- If the OP's tweet is empty / unintelligible / not a real claim, return a
  reply that asks one sharp clarifying question instead of guessing.`;
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
  model,
  resultFile,
  mcpServerPath,
}) {
  if (existsSync(resultFile)) await unlink(resultFile);

  const system = buildSystemPrompt({ voice, ownTopPerformers });
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
