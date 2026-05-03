// Generic tool-use loop over the Anthropic Messages API.
// Drives both the peer-posts research agent and the draft-improve agent.

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MAX_STEPS = 30;
const DEFAULT_MAX_TOKENS = 4096;

export function makeClient({ apiKey } = {}) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
}

// `tools` is an array of `{ name, description, input_schema, run(input) -> any }`.
// The runner strips `run` before sending to the API; everything else is passed through.
export async function runAgent({
  client,
  model,
  system,
  tools,
  userPrompt,
  terminalTool,
  maxSteps = DEFAULT_MAX_STEPS,
  maxTokens = DEFAULT_MAX_TOKENS,
  onStep,
}) {
  const toolSchemas = tools.map(({ run, ...rest }) => rest);
  const toolImpls = Object.fromEntries(tools.map((t) => [t.name, t.run]));

  const messages = [{ role: 'user', content: userPrompt }];
  const log = [];
  let response;
  let steps = 0;
  let terminalInput = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  while (steps < maxSteps) {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: toolSchemas,
      messages,
    });

    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;
    totalCacheRead += response.usage?.cache_read_input_tokens ?? 0;
    totalCacheWrite += response.usage?.cache_creation_input_tokens ?? 0;

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      break;
    }
    if (response.stop_reason !== 'tool_use') {
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    let sawTerminal = false;
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const impl = toolImpls[block.name];
      const stepInfo = { step: steps, name: block.name, input: block.input };
      try {
        if (!impl) throw new Error(`unknown tool: ${block.name}`);
        const result = await impl(block.input);
        const content = result == null ? 'ok' : typeof result === 'string' ? result : JSON.stringify(result);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content,
        });
        stepInfo.ok = true;
        if (terminalTool && block.name === terminalTool) {
          terminalInput = block.input;
          sawTerminal = true;
        }
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Error: ${err.message}`,
          is_error: true,
        });
        stepInfo.ok = false;
        stepInfo.error = err.message;
      }
      log.push(stepInfo);
      if (onStep) onStep(stepInfo);
    }

    messages.push({ role: 'user', content: toolResults });
    steps += 1;
    if (sawTerminal) break;
  }

  const text = (response?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return {
    text,
    steps,
    stop_reason: response?.stop_reason,
    terminalInput,
    log,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cache_read_input_tokens: totalCacheRead,
      cache_creation_input_tokens: totalCacheWrite,
    },
  };
}
