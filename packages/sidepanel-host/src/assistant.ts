/**
 * The assistant tool-use loop.
 *
 * A manual Messages API agentic loop (not Managed Agents) so we can gate
 * mutating tool calls behind human confirmation — the central defense, since
 * the assistant ingests untrusted web-page content (prompt-injection risk).
 *
 * Dependencies (LLM, executor, confirmation) are injected so the loop is fully
 * unit-testable without network or a running Fleex stack.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { buildArgv } from '@fleex/mcp';
import type { GeneratedTool } from '@fleex/mcp';
import { indexTools } from './tools.ts';

export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown>; argv: string[]; mutating: boolean }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; text: string }
  | { type: 'tool_denied'; id: string; name: string }
  | { type: 'done'; stopReason: string | null };

/** Streams the model's response and returns its final content + stop reason. */
export type LlmComplete = (
  params: { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] },
  onText: (delta: string) => void,
) => Promise<{ content: Anthropic.ContentBlock[]; stopReason: string | null }>;

/** Runs one tool against the CLI and returns a flattened result. */
export type ExecFn = (tool: GeneratedTool, input: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;

/** Asks the user to approve a mutating tool call. Resolves true to proceed. */
export type ConfirmFn = (req: { id: string; name: string; input: Record<string, unknown>; argv: string[] }) => Promise<boolean>;

export interface RunAssistantOptions {
  llm: LlmComplete;
  exec: ExecFn;
  confirm: ConfirmFn;
  tools: GeneratedTool[];
  anthropicTools: Anthropic.Tool[];
  system: string;
  /** Full conversation so far, including the latest user turn. Mutated in place. */
  messages: Anthropic.MessageParam[];
  onEvent: (e: AssistantEvent) => void;
  /** Workspace injected into every CLI invocation. */
  workspace?: string;
  /** Safety cap on tool-use rounds. Default 8. */
  maxIterations?: number;
}

function textOf(block: Anthropic.ContentBlock): string | null {
  return block.type === 'text' ? block.text : null;
}

/**
 * Drive the loop until the model stops requesting tools (or the cap is hit).
 * Returns the updated `messages` array.
 */
export async function runAssistant(opts: RunAssistantOptions): Promise<Anthropic.MessageParam[]> {
  const { llm, exec, confirm, tools, anthropicTools, system, messages, onEvent, workspace } = opts;
  const byName = indexTools(tools);
  const maxIterations = opts.maxIterations ?? 8;

  for (let i = 0; i < maxIterations; i++) {
    const { content, stopReason } = await llm({ system, messages, tools: anthropicTools }, (delta) =>
      onEvent({ type: 'text', text: delta }),
    );
    messages.push({ role: 'assistant', content });

    const toolUses = content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) {
      onEvent({ type: 'done', stopReason });
      return messages;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      const tool = byName.get(call.name);
      const input = (call.input ?? {}) as Record<string, unknown>;

      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: `Unknown tool: ${call.name}`, is_error: true });
        onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: false, text: `Unknown tool: ${call.name}` });
        continue;
      }

      let argv: string[];
      try {
        argv = buildArgv(tool, input, { workspace, json: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: `Invalid arguments: ${msg}`, is_error: true });
        onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: false, text: `Invalid arguments: ${msg}` });
        continue;
      }

      onEvent({ type: 'tool_call', id: call.id, name: call.name, input, argv, mutating: tool.mutating });

      // Gate: mutating calls require explicit user approval.
      if (tool.mutating) {
        const approved = await confirm({ id: call.id, name: call.name, input, argv });
        if (!approved) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'The user declined to run this action. Do not retry it; ask how to proceed.',
            is_error: true,
          });
          onEvent({ type: 'tool_denied', id: call.id, name: call.name });
          continue;
        }
      }

      const res = await exec(tool, input);
      toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: res.text || (res.ok ? 'OK' : 'failed'), is_error: !res.ok });
      onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: res.ok, text: res.text });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Hit the iteration cap with tools still pending.
  onEvent({ type: 'done', stopReason: 'max_iterations' });
  return messages;
}

export { textOf };
