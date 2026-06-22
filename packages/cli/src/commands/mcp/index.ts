import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'mcp',
  description: 'Run the fleex Model Context Protocol (MCP) server',
  isParent: true,
  extraHelp: `\n${SECTION('What this is:')}
  Exposes the fleex domain (tickets, epics, boards, deliverables) as MCP tools,
  generated from the live CLI command tree. Any MCP client — Claude Code,
  Claude Desktop, OpenClaw — can drive fleex through it.

${SECTION('Transport:')}
  The server speaks ${GREEN('stdio')} (the MCP standard). It runs in the foreground and
  is meant to be ${chalk.bold('launched by an MCP client')}, which owns its lifecycle over the
  stdio pipes. There is no daemon/background mode for a stdio server — for a
  long-running socket service, use the side-panel host instead.

${SECTION('Examples:')}
  ${DIM('$')} fleex mcp start --workspace evaneos        ${DIM('# run for one workspace')}
  ${DIM('$')} claude mcp add fleex -- fleex mcp start --workspace evaneos
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
