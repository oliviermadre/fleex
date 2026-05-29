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

${SECTION('Auth model:')}
  Each instance authenticates with its own token (modelled after SSH's
  authorized_keys). Tokens are stored as sha256 hashes at
  ${chalk.cyan('~/.fleex/hub.clients.json')} and sent in the
  ${chalk.cyan('Authorization: Bearer …')} header on the WS upgrade.
  The hub watches the file and hot-disconnects revoked clients.

${SECTION('Usual workflow:')}
  ${DIM('$')} fleex hub start                       ${DIM('# starts the hub')}
  ${DIM('$')} fleex hub client add my-laptop        ${DIM('# prints the token (once)')}
  ${DIM('$')} export FLEEX_EVENT_HUB_URL=…          ${DIM('# from hub start output')}
  ${DIM('$')} export FLEEX_EVENT_HUB_TOKEN=…        ${DIM('# from client add output')}
  ${DIM('$')} fleex start                           ${DIM('# instance connects')}

${SECTION('More:')}
  ${DIM('$')} fleex hub status                      ${DIM('# clients connected, uptime')}
  ${DIM('$')} fleex hub client list                 ${DIM('# show authorized clients')}
  ${DIM('$')} fleex hub client revoke my-laptop     ${DIM('# kick + deny')}
  ${DIM('$')} fleex hub stop                        ${DIM('# shut down (clients file kept)')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
