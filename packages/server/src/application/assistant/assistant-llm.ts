import type Anthropic from '@anthropic-ai/sdk';

/**
 * One streaming Messages-API completion for the assistant. Injected into the
 * use case so tests script the model's answer without network.
 */
export type AssistantLlm = (
  params: {
    model: string; system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[];
    /**
     * A decision turn (thread wake-up, or a user message while threads are open):
     * the model is asked to think before acting, where its API allows it.
     * Constant across the rounds of one turn.
     */
    thinking?: boolean;
  },
  onText: (delta: string) => void,
) => Promise<{ content: Anthropic.ContentBlock[]; stopReason: string | null; usage?: AssistantUsage }>;

/** Tokens one completion billed, cache included — what the turn's cost is computed from. */
export interface AssistantUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * What the assistant's model accepts, as the Models API advertises it. The
 * persona's model is configurable, so nothing here is assumed from its name.
 */
export interface AssistantModelProfile {
  /** `thinking: { type: 'adaptive' }` is accepted. */
  adaptiveThinking: boolean;
  /** The model's `max_tokens` ceiling; null when unknown. */
  maxOutputTokens: number | null;
}

/** Nothing is known about the model: send only what every model accepts. */
export const UNKNOWN_MODEL_PROFILE: AssistantModelProfile = { adaptiveThinking: false, maxOutputTokens: null };

/**
 * Output cap of one round. 4096 truncated long delegation `turn`s into invalid
 * tool calls; thinking, where on, is billed against the same cap.
 */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 32_000;
/** Cap used when the model's own ceiling is unknown: below the ceiling of every served model. */
export const ASSISTANT_FALLBACK_OUTPUT_TOKENS = 16_000;

const EPHEMERAL = { type: 'ephemeral' as const };

/** The last message with a cache breakpoint on its last block — on a copy: markers must not pile up round after round. */
function withTailBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]
    : [...last.content];
  const tail = blocks.at(-1);
  // Only block types that take `cache_control`; a turn always ends on the user prompt or on tool results.
  if (!tail || (tail.type !== 'text' && tail.type !== 'tool_result')) return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: EPHEMERAL };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

/**
 * The Messages-API request of one round.
 *
 * Prompt caching: one breakpoint on the system prompt (tools render before
 * system, so it covers both — 100+ tool schemas and every persona identity
 * were re-billed in full each round), one on the last block of the
 * conversation, so each round reads everything the previous one wrote. Default
 * 5-minute TTL: the rounds of a turn follow each other within seconds.
 *
 * Thinking: asked for (`adaptive`) on decision turns, only where the model
 * advertises it. Otherwise the parameter is omitted — never `disabled`, never
 * a token budget: both are rejected by several current models, while omitting
 * is accepted by all (models that always think then think anyway).
 */
export function buildAssistantRequest(
  params: Parameters<AssistantLlm>[0],
  profile: AssistantModelProfile,
): Anthropic.MessageStreamParams {
  return {
    model: params.model,
    max_tokens: profile.maxOutputTokens
      ? Math.min(ASSISTANT_MAX_OUTPUT_TOKENS, profile.maxOutputTokens)
      : ASSISTANT_FALLBACK_OUTPUT_TOKENS,
    system: [{ type: 'text', text: params.system, cache_control: EPHEMERAL }],
    tools: params.tools,
    messages: withTailBreakpoint(params.messages),
    ...(params.thinking && profile.adaptiveThinking ? { thinking: { type: 'adaptive' as const } } : {}),
  };
}

export function createAnthropicAssistantLlm(client: Anthropic): AssistantLlm {
  // One lookup per model for the life of the server. A failed lookup is not
  // remembered: the turn runs on the safe profile and the next one asks again.
  const profiles = new Map<string, AssistantModelProfile>();
  const profileOf = async (model: string): Promise<AssistantModelProfile> => {
    const known = profiles.get(model);
    if (known) return known;
    try {
      const info = await client.models.retrieve(model);
      const profile: AssistantModelProfile = {
        adaptiveThinking: info.capabilities?.thinking?.types?.adaptive?.supported === true,
        maxOutputTokens: typeof info.max_tokens === 'number' && info.max_tokens > 0 ? info.max_tokens : null,
      };
      profiles.set(model, profile);
      return profile;
    } catch {
      return UNKNOWN_MODEL_PROFILE;
    }
  };

  return async (params, onText) => {
    const stream = client.messages.stream(buildAssistantRequest(params, await profileOf(params.model)));
    stream.on('text', (delta: string) => onText(delta));
    const final = await stream.finalMessage();
    return {
      // Thinking blocks included: the caller sends the content back unchanged on the next round.
      content: final.content,
      stopReason: final.stop_reason,
      usage: {
        inputTokens: final.usage?.input_tokens,
        outputTokens: final.usage?.output_tokens,
        cacheReadTokens: final.usage?.cache_read_input_tokens ?? undefined,
        cacheCreationTokens: final.usage?.cache_creation_input_tokens ?? undefined,
      },
    };
  };
}

/** `KEY=value` lines of `~/.fleex/config` (dotenv-style, no quoting rules beyond trimming). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) out[key] = value;
  }
  return out;
}
