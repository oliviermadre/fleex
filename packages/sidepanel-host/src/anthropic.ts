/**
 * Real implementations of the assistant's injected dependencies:
 * a streaming Claude completion and a CLI executor.
 */
import Anthropic from '@anthropic-ai/sdk';

import { execFleex, type ExecOptions } from '@fleex/mcp';
import { inferModelCapabilities } from '@fleex/shared';

import type { ExecFn, LlmComplete } from './assistant.ts';

export const DEFAULT_MODEL = 'claude-opus-5';

export function createClient(apiKey?: string): Anthropic {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

/**
 * Streaming completion for the chosen Claude model. Adaptive thinking is only
 * sent for models that support it (Opus ≥ 4.5 / Sonnet ≥ 4.6) — Haiku and older
 * models reject `thinking` with a 400. Text deltas are forwarded to `onText` as
 * they arrive; the final content + stop reason are returned for the tool loop.
 */
export function createLlm(
  client: Anthropic,
  model: string = DEFAULT_MODEL,
  maxTokens = 8192,
): LlmComplete {
  const supportsThinking = inferModelCapabilities(model).supportsEffort;
  return async (params, onText) => {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(supportsThinking ? { thinking: { type: 'adaptive' } } : {}),
      system: params.system,
      tools: params.tools,
      messages: params.messages,
    } as Anthropic.MessageStreamParams);
    stream.on('text', (delta: string) => onText(delta));
    const final = await stream.finalMessage();
    return { content: final.content, stopReason: final.stop_reason };
  };
}

/** Executor that runs each tool via the fleex CLI with `--json` forced on. */
export function createExec(execOpts: ExecOptions = {}): ExecFn {
  return async (tool, input) => {
    // assumeYes: the host already obtained human approval for mutating tools,
    // so inject the CLI's confirm-skip flag to avoid blocking on a prompt.
    const res = await execFleex(tool, input, { ...execOpts, json: true, assumeYes: true });
    const text = res.ok
      ? res.data !== undefined
        ? JSON.stringify(res.data)
        : res.stdout.trim() || 'OK'
      : res.stdout.trim() || res.stderr.trim() || `fleex exited with code ${res.exitCode}`;
    return { ok: res.ok, text };
  };
}
