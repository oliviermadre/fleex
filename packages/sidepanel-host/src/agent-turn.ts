/**
 * One Assistant turn, run by the Claude Agent SDK.
 *
 * Options and env come from `buildSdkOptions('edit', …)` — the function that
 * builds persona runs — so the Assistant is the same agent as a persona:
 * `bypassPermissions`, the user's and project's MCP servers and skills, the
 * whole Claude Code toolset, every variable Fleex exports to its agents. The
 * companion only passes its own context (folder, identity, workspace, model,
 * resume) and its single guard (a file write outside the folder).
 *
 * `query` is injected so the mapping from SDK messages to companion events is
 * testable without network or a Claude Code install.
 */
import { buildSdkOptions } from '@fleex/shared';
import { GUARDED_TOOLS } from './outside-write-guard.ts';

export const ASSISTANT_ACTOR_NAME = 'Assistant';
/** Stored per tool call; beyond it the output is cut (P11). */
export const MAX_OUTPUT_BYTES = 200 * 1024;
/** A confirmation can wait for days (the panel may be closed): the hook must not time out first. */
const GUARD_HOOK_TIMEOUT_S = 7 * 24 * 3600;

export type ToolKind = 'read' | 'write' | 'edit' | 'bash' | 'mcp' | 'skill' | 'web' | 'other';
export type ToolStatus = 'running' | 'ok' | 'fail' | 'denied' | 'stopped' | 'interrupted';

export interface McpServerState {
  name: string;
  status: 'connected' | 'needs-auth' | 'failed' | 'pending';
  error?: string;
}

export type TurnEvent =
  | { type: 'session'; sdkSessionId: string }
  | { type: 'mcp_status'; servers: McpServerState[] }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; toolKind: ToolKind; target: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; ok: boolean; text: string; exitCode?: number; truncated?: boolean }
  | { type: 'max_turns'; limit: number }
  | { type: 'auth_failed'; message: string }
  | { type: 'done'; subtype: string };

/** The slice of an SDK message this module reads. */
export interface SdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  error?: string;
  is_error?: boolean;
  result?: string;
  mcp_servers?: Array<{ name: string; status: string; error?: string }>;
  message?: { content?: unknown };
}

export interface QueryHandle extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<unknown>;
}

export type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => QueryHandle;

export interface TurnContext {
  prompt: string;
  /** The conversation folder: the session's cwd. */
  workDir: string;
  model: string;
  maxTurns?: number;
  /** SDK session to resume (absent on the first turn). */
  resume?: string;
  /** Fleex workspace of the conversation, exported as FLEEX_WORKSPACE. */
  workspace?: string;
  /** Appended to the `claude_code` preset. */
  systemAppend: string;
  /** Use this API key instead of Claude Code's own login (T1 fallback). */
  apiKey?: string;
  /** `PreToolUse` callback guarding Write/Edit/NotebookEdit outside the folder. */
  guardHook: (input: never, toolUseId: string | undefined) => Promise<unknown>;
}

/** The SDK `query()` options of an Assistant turn. */
export function assistantSdkOptions(ctx: TurnContext): Record<string, unknown> {
  const options = buildSdkOptions('edit', {
    model: ctx.model,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: ctx.systemAppend },
    cwd: ctx.workDir,
    ...(ctx.resume ? { resume: ctx.resume } : {}),
    ...(ctx.maxTurns !== undefined ? { maxTurns: ctx.maxTurns } : {}),
    actorName: ASSISTANT_ACTOR_NAME,
    extraEnv: {
      ...(ctx.workspace ? { FLEEX_WORKSPACE: ctx.workspace } : {}),
      ...(ctx.apiKey ? { ANTHROPIC_API_KEY: ctx.apiKey } : {}),
    },
    // Claude Code's own login comes first (T1): an inherited API key would win
    // over it. A persona slug inherited from whoever started the companion is
    // not the Assistant's.
    omitEnv: [...(ctx.apiKey ? [] : ['ANTHROPIC_API_KEY']), 'FLEEX_ACTOR_PERSONA'],
  });
  // The whole toolset, not the edit allowlist: the Assistant has every tool a
  // persona can reach (RG4), MCP servers included.
  const { allowedTools: _editAllowlist, ...rest } = options;
  return {
    ...rest,
    // No UI answers this tool in the companion: questions are asked in text (P3).
    disallowedTools: ['AskUserQuestion'],
    hooks: {
      PreToolUse: [{ matcher: GUARDED_TOOLS.join('|'), hooks: [ctx.guardHook], timeout: GUARD_HOOK_TIMEOUT_S }],
    },
  };
}

export function toolKind(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'LS':
      return 'read';
    case 'Write':
      return 'write';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit';
    case 'Bash':
      return 'bash';
    case 'Skill':
      return 'skill';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    default:
      return 'other';
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** What the tool line shows after the tool name (RG25). Paths are relative inside the folder (P22). */
export function toolTarget(name: string, input: Record<string, unknown>, workDir: string): string {
  const rel = (p: string): string => (p.startsWith(workDir + '/') ? p.slice(workDir.length + 1) : p);
  if (name.startsWith('mcp__')) {
    const [, server, ...tool] = name.split('__');
    return `${server} · ${tool.join('__')}`;
  }
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return rel(str(input.file_path));
    case 'NotebookEdit':
      return rel(str(input.notebook_path));
    case 'Bash': {
      const line = str(input.command).replace(/\s*\n\s*/g, ' ').trim();
      return line.length > 120 ? line.slice(0, 119) + '…' : line;
    }
    case 'Glob':
    case 'Grep':
      return str(input.pattern);
    case 'Skill':
      return str(input.skill) || str(input.command);
    case 'WebFetch':
      return str(input.url);
    case 'WebSearch':
      return str(input.query);
    default:
      return '';
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? str((b as { text?: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Cut a tool output to `MAX_OUTPUT_BYTES`, keeping its end (where errors and results are). */
export function capOutput(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_OUTPUT_BYTES) return { text, truncated: false };
  const buf = Buffer.from(text, 'utf8');
  return { text: buf.subarray(buf.length - MAX_OUTPUT_BYTES).toString('utf8') + '\n… sortie tronquée à 200 Ko', truncated: true };
}

function mcpState(status: string): McpServerState['status'] {
  if (status === 'connected' || status === 'needs-auth' || status === 'failed' || status === 'pending') return status;
  return status === 'needs_auth' ? 'needs-auth' : 'failed';
}

const AUTH_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed']);

/** Run one turn; resolves when the SDK stream ends. `onQuery` exposes the handle for Stop. */
export async function runTurn(
  query: QueryFn,
  ctx: TurnContext,
  onEvent: (e: TurnEvent) => void,
  onQuery?: (q: QueryHandle) => void,
): Promise<void> {
  const options = assistantSdkOptions(ctx);
  const q = query({ prompt: ctx.prompt, options });
  onQuery?.(q);
  let subtype = 'success';
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) onEvent({ type: 'session', sdkSessionId: msg.session_id });
      if (msg.mcp_servers?.length) {
        onEvent({
          type: 'mcp_status',
          servers: msg.mcp_servers.map((s) => ({ name: s.name, status: mcpState(s.status), ...(s.error ? { error: s.error } : {}) })),
        });
      }
      continue;
    }
    // A sub-agent's inner calls stay inside its own tool line.
    if (msg.parent_tool_use_id) continue;
    if (msg.type === 'assistant') {
      if (msg.error && AUTH_ERRORS.has(msg.error)) {
        onEvent({ type: 'auth_failed', message: msg.error });
        continue;
      }
      const blocks = Array.isArray(msg.message?.content) ? (msg.message!.content as Array<Record<string, unknown>>) : [];
      for (const b of blocks) {
        if (b.type === 'text' && str(b.text)) onEvent({ type: 'text', text: str(b.text) });
        else if (b.type === 'tool_use') {
          const name = str(b.name);
          const input = (b.input ?? {}) as Record<string, unknown>;
          onEvent({ type: 'tool_call', id: str(b.id), name, toolKind: toolKind(name), target: toolTarget(name, input, ctx.workDir), input });
        }
      }
      continue;
    }
    if (msg.type === 'user') {
      const blocks = Array.isArray(msg.message?.content) ? (msg.message!.content as Array<Record<string, unknown>>) : [];
      for (const b of blocks) {
        if (b.type !== 'tool_result') continue;
        const raw = resultText(b.content);
        const { text, truncated } = capOutput(raw);
        const exit = /(?:^|\n)Exit code (\d+)/.exec(raw);
        onEvent({
          type: 'tool_result',
          id: str(b.tool_use_id),
          ok: b.is_error !== true,
          text,
          ...(exit ? { exitCode: Number(exit[1]) } : {}),
          ...(truncated ? { truncated } : {}),
        });
      }
      continue;
    }
    if (msg.type === 'result') {
      subtype = msg.subtype ?? subtype;
      if (subtype === 'error_max_turns') onEvent({ type: 'max_turns', limit: Number(options.maxTurns) });
      else if (msg.is_error && /invalid api key|please run \/login|not logged in|authentication/i.test(str(msg.result))) {
        onEvent({ type: 'auth_failed', message: str(msg.result) });
      }
    }
  }
  onEvent({ type: 'done', subtype });
}
