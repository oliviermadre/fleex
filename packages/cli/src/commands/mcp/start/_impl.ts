import { spawn } from 'node:child_process';
import path from 'node:path';

export interface McpStartOptions {
  /** Workspace the MCP tools target (forwarded as FLEEX_WORKSPACE → --workspace). */
  workspace?: string;
  /** Comma-separated top-level command groups to expose (FLEEX_MCP_INCLUDE). */
  include?: string;
  /** Let destructive tools skip the CLI confirmation prompt (FLEEX_MCP_ASSUME_YES). */
  assumeYes?: boolean;
}

/** Filesystem anchors the launcher resolves against — overridable in tests. */
export interface McpLaunchContext {
  /** Executable used to run the TS entrypoints (the current Bun runtime). */
  execPath: string;
  /** Absolute path of the @fleex/mcp stdio server entry. */
  serverPath: string;
  /** Absolute path of this CLI's entrypoint, so the server re-invokes THIS code. */
  cliEntry: string;
  /** Base environment to layer overrides onto (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
}

export interface McpLaunch {
  bin: string;
  args: string[];
  /** Only the variables this launcher sets; merge over baseEnv to get the child env. */
  envOverrides: Record<string, string>;
}

/**
 * Pure: compute how to spawn the stdio MCP server for the given options.
 *
 * The server's executor runs `fleex` to fulfil each tool call; we point it at
 * THIS CLI (same Bun runtime + this entrypoint) so the exposed tool surface and
 * the executed commands never drift from the version the user invoked. An
 * explicit env var already set by the caller always wins (so power users can
 * override the binary, prefix, include set, or workspace).
 */
export function buildMcpLaunch(opts: McpStartOptions, ctx: McpLaunchContext): McpLaunch {
  const base = ctx.baseEnv ?? {};
  const envOverrides: Record<string, string> = {};

  const workspace = opts.workspace ?? base.FLEEX_WORKSPACE;
  if (workspace) envOverrides.FLEEX_WORKSPACE = workspace;

  const include = opts.include ?? base.FLEEX_MCP_INCLUDE;
  if (include) envOverrides.FLEEX_MCP_INCLUDE = include;

  // Opt-in only: without it the server refuses tools that would block on the
  // CLI's confirmation prompt, rather than silently forcing them through.
  // Set solely by the flag. A value already in the environment reaches the child
  // by inheritance (see runMcpStart), so `server.ts` stays the ONE place that
  // decides what counts as "on". Re-emitting it here meant two parsers for one
  // security flag, and the looser one won: `FLEEX_MCP_ASSUME_YES=0` is a truthy
  // string, so it was normalised to '1' and turned the bypass on.
  if (opts.assumeYes) envOverrides.FLEEX_MCP_ASSUME_YES = '1';

  // Re-invoke this exact CLI for tool execution unless the caller overrode it.
  envOverrides.FLEEX_MCP_BIN = base.FLEEX_MCP_BIN ?? ctx.execPath;
  envOverrides.FLEEX_MCP_PREFIX = base.FLEEX_MCP_PREFIX ?? ctx.cliEntry;

  return { bin: ctx.execPath, args: [ctx.serverPath], envOverrides };
}

function defaultContext(): McpLaunchContext {
  // import.meta.dir → packages/cli/src/commands/mcp/start
  const cliEntry = path.resolve(import.meta.dir, '../../../../index.ts');
  const serverPath = path.resolve(import.meta.dir, '../../../../../mcp/src/server.ts');
  return { execPath: process.execPath, serverPath, cliEntry, baseEnv: process.env };
}

/**
 * Launch the stdio MCP server in the foreground, wiring stdin/stdout/stderr
 * straight through so the calling MCP client speaks the protocol with it.
 * IMPORTANT: nothing is written to stdout here — that channel is the protocol.
 */
export async function runMcpStart(opts: McpStartOptions = {}): Promise<void> {
  const ctx = defaultContext();
  const { bin, args, envOverrides } = buildMcpLaunch(opts, ctx);

  await new Promise<void>((_resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: 'inherit',
      env: { ...process.env, ...envOverrides },
    });

    // Forward termination signals so the child stops cleanly with the launcher.
    const forward = (sig: NodeJS.Signals) => () => {
      if (!child.killed) child.kill(sig);
    };
    const onInt = forward('SIGINT');
    const onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);

    child.on('error', (err) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      if (signal) {
        // Mirror the child's terminating signal in our exit status.
        process.exit(1);
      }
      process.exit(code ?? 0);
    });
  });
}
