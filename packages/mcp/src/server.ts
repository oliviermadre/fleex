#!/usr/bin/env bun
/**
 * fleex-mcp — a Model Context Protocol stdio server exposing the fleex CLI
 * domain surface (tickets, epics, boards, deliverables) as typed tools.
 *
 * The tools are generated from the live CLI command tree and executed by
 * running `fleex` (argv, no shell). Reusable by any MCP client — Claude Code,
 * OpenClaw, Claude Desktop — and by the side panel companion.
 *
 * Configuration via env:
 *   FLEEX_WORKSPACE      target workspace name (injected as --workspace)
 *   FLEEX_MCP_BIN        fleex binary (default: `fleex`)
 *   FLEEX_MCP_PREFIX     space-separated args before fleex argv (e.g. for bun)
 *   FLEEX_MCP_INCLUDE    comma-separated top-level groups to expose
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { buildProgram } from '@fleex/cli/program';

import { generateTools } from './generator.ts';
import { listTools, callToolResult } from './mcp-handlers.ts';

import type { ExecOptions } from './executor.ts';

async function main(): Promise<void> {
  const root = await buildProgram();
  const include = process.env.FLEEX_MCP_INCLUDE
    ? process.env.FLEEX_MCP_INCLUDE.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const tools = generateTools(root, include ? { include } : {});

  const execOpts: ExecOptions = {
    workspace: process.env.FLEEX_WORKSPACE,
    bin: process.env.FLEEX_MCP_BIN,
    prefixArgs: process.env.FLEEX_MCP_PREFIX
      ? process.env.FLEEX_MCP_PREFIX.split(' ').filter(Boolean)
      : undefined,
  };

  const server = new Server({ name: 'fleex', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => listTools(tools));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const result = await callToolResult(
      tools,
      req.params.name,
      (req.params.arguments ?? {}) as Record<string, unknown>,
      { execOpts },
    );
    return result as CallToolResult;
  });

  await server.connect(new StdioServerTransport());
  // stdout is reserved for the protocol — log readiness to stderr only.
  process.stderr.write(`fleex-mcp: ${tools.length} tools ready\n`);
}

main().catch((e) => {
  process.stderr.write(`fleex-mcp fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
