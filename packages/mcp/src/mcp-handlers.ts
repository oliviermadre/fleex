/**
 * Pure mappers between the generated tool surface and the MCP wire shapes.
 *
 * Kept free of the SDK transport so they can be unit-tested without spawning a
 * server: `listTools` produces the `tools/list` payload, `callToolResult`
 * produces a `tools/call` result by executing the underlying CLI command.
 */
import { execFleex, type ExecOptions, type ExecResult } from './executor.ts';
import { isDestructiveLeaf } from './generator.ts';
import type { GeneratedTool } from './types.ts';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: GeneratedTool['inputSchema'];
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
  };
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
}

export function toMcpTool(tool: GeneratedTool): McpToolDef {
  const leaf = tool.commandPath[tool.commandPath.length - 1] ?? '';
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: `fleex ${tool.commandPath.join(' ')}`,
      readOnlyHint: !tool.mutating,
      destructiveHint: tool.mutating && isDestructiveLeaf(leaf),
    },
  };
}

export function listTools(tools: GeneratedTool[]): { tools: McpToolDef[] } {
  return { tools: tools.map(toMcpTool) };
}

export interface CallContext {
  /** Override the executor (tests). Defaults to the real `execFleex`. */
  exec?: (tool: GeneratedTool, input: Record<string, unknown>, opts: ExecOptions) => Promise<ExecResult>;
  /** Exec options (bin, prefixArgs, workspace, timeout). `json` is forced on. */
  execOpts?: ExecOptions;
  /**
   * Inject each tool's confirm-skip flag (`--force`). A stdio MCP server has no
   * confirmation channel of its own (stdin carries the protocol), so this is
   * only safe when the embedding client is the approval authority. Default
   * `false`: the library refuses rather than hangs on a prompt nobody answers.
   */
  assumeYes?: boolean;
}

export function resultText(res: ExecResult): string {
  if (res.ok) {
    if (res.data !== undefined) return JSON.stringify(res.data, null, 2);
    return res.stdout.trim() || 'OK';
  }
  if (res.timedOut) return `fleex ${res.argv.join(' ')} timed out after ${res.timeoutMs} ms`;
  return res.stdout.trim() || res.stderr.trim() || `fleex exited with code ${res.exitCode}`;
}

export async function callToolResult(
  tools: GeneratedTool[],
  name: string,
  args: Record<string, unknown>,
  ctx: CallContext = {},
): Promise<McpToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  const assumeYes = ctx.assumeYes ?? false;
  // Refuse rather than run: without `assumeYes` the CLI would block on its own
  // readline prompt until the exec timeout kills it, which reads as a hang.
  if (!assumeYes && tool.confirmFlag) {
    return {
      content: [{
        type: 'text',
        text: `${tool.name} needs an interactive confirmation that this non-interactive MCP `
          + 'server cannot answer. Start it with `fleex mcp start --assume-yes` '
          + '(or FLEEX_MCP_ASSUME_YES=1) if your MCP client is the approval authority.',
      }],
      isError: true,
    };
  }
  const exec = ctx.exec ?? execFleex;
  try {
    const res = await exec(tool, args ?? {}, { ...ctx.execOpts, json: true, assumeYes });
    return { content: [{ type: 'text', text: resultText(res) }], isError: !res.ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}
