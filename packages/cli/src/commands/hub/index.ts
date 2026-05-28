import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'hub',
  description: 'Manage the Fleex event hub (multi-instance synchronization)',
  isParent: true,
  extraHelp: `\n${SECTION('About:')}
  The event hub fans out domain events between multiple Fleex server instances
  so frontends connected to any instance receive updates from writes that
  happened on other instances. Side-effects stay on the originator.

${SECTION('Usage:')}
  Start the hub once on the machine that will host it, then point every Fleex
  instance at it via the FLEEX_EVENT_HUB_URL environment variable.

${SECTION('Examples:')}
  ${DIM('$')} fleex hub start                       ${DIM('# random free port')}
  ${DIM('$')} fleex hub start --port 3002           ${DIM('# fixed port')}
  ${DIM('$')} fleex hub start --rotate-token        ${DIM('# regenerate the shared secret')}
  ${DIM('$')} fleex hub status                      ${DIM('# clients connected, uptime')}
  ${DIM('$')} fleex hub stop                        ${DIM('# shut down (token is kept)')}

${SECTION('Token:')}
  The shared secret is generated once and persisted at ${chalk.cyan('~/.fleex/hub.token')}.
  Hub restarts reuse it so already-running Fleex servers reconnect without
  having to re-export their env. Use ${chalk.cyan('--rotate-token')} to invalidate
  all connected clients (they must re-export FLEEX_EVENT_HUB_TOKEN).

${SECTION('Environment variables (for fleex start):')}
  FLEEX_EVENT_HUB_URL    WS URL printed by ${chalk.cyan('fleex hub start')}
  FLEEX_EVENT_HUB_TOKEN  Shared secret, also printed by start
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
