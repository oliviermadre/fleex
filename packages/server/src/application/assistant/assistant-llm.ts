import type Anthropic from '@anthropic-ai/sdk';

/**
 * One streaming Messages-API completion for the assistant. Injected into the
 * use case so tests script the model's answer without network.
 */
export type AssistantLlm = (
  params: { model: string; system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] },
  onText: (delta: string) => void,
) => Promise<{ content: Anthropic.ContentBlock[]; stopReason: string | null; usage?: { inputTokens?: number; outputTokens?: number } }>;

/**
 * No extended thinking on purpose: the assistant is a project manager who
 * answers fast and delegates the deep work — streaming text, not a long think.
 */
export function createAnthropicAssistantLlm(client: Anthropic, maxTokens = 4096): AssistantLlm {
  return async (params, onText) => {
    const stream = client.messages.stream({
      model: params.model,
      max_tokens: maxTokens,
      system: params.system,
      tools: params.tools,
      messages: params.messages,
    });
    stream.on('text', (delta: string) => onText(delta));
    const final = await stream.finalMessage();
    return {
      content: final.content,
      stopReason: final.stop_reason,
      usage: { inputTokens: final.usage?.input_tokens, outputTokens: final.usage?.output_tokens },
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
