import chalk from 'chalk';

import { runMcpStart, type McpStartOptions } from './_impl.ts';

import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'start',
  description: 'Start the stdio MCP server (foreground; launched by an MCP client)',
  setup(cmd) {
    cmd.option(
      '--workspace <name>',
      'Workspace the MCP tools target (forwarded to every tool as --workspace; defaults to the is_default workspace)',
    );
    cmd.option(
      '--include <groups>',
      'Comma-separated top-level command groups to expose as tools (default: ticket,epic)',
    );
  },
  extraHelp: `\n${SECTION('Foreground only:')}
  This is a stdio server — it stays attached to stdin/stdout for the MCP
  protocol and exits when the client disconnects. Run it from an MCP client
  rather than as a background daemon.

${SECTION('Register with Claude Code:')}
  ${DIM('$')} claude mcp add fleex -- fleex mcp start --workspace evaneos
`,
  action: async (opts: McpStartOptions) => {
    await runMcpStart(opts);
  },
};

export default def;
