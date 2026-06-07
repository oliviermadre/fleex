/**
 * Real implementations of the assistant's injected dependencies:
 * a streaming Claude completion and a CLI executor.
 */
import Anthropic from '@anthropic-ai/sdk';
import { execFleex, type ExecOptions } from '@fleex/mcp';
import type { ExecFn, LlmComplete } from './assistant.ts';

export const DEFAULT_MODEL = 'claude-opus-4-8';

export function createClient(apiKey?: string): Anthropic {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

/**
 * Streaming completion on Claude Opus 4.8 with adaptive thinking. Text deltas
 * are forwarded to `onText` as they arrive; the final content + stop reason are
 * returned for the tool-use loop.
 */
export function createLlm(client: Anthropic, model: string = DEFAULT_MODEL, maxTokens = 8192): LlmComplete {
  return async (params, onText) => {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
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
    const res = await execFleex(tool, input, { ...execOpts, json: true });
    const text = res.ok
      ? res.data !== undefined
        ? JSON.stringify(res.data)
        : res.stdout.trim() || 'OK'
      : res.stdout.trim() || res.stderr.trim() || `fleex exited with code ${res.exitCode}`;
    return { ok: res.ok, text };
  };
}
