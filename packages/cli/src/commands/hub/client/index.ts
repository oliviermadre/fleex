import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'client',
  description: 'Manage authorized clients (per-instance tokens) for the event hub',
  isParent: true,
  extraHelp: `\n${SECTION('About:')}
  Each Fleex server instance authenticates to the hub with its own token,
  modelled after SSH's authorized_keys. Tokens are stored as sha256 hashes
  at ${chalk.cyan('~/.fleex/hub.clients.json')}; the raw token is only
  shown once at creation time.

${SECTION('Examples:')}
  ${DIM('$')} fleex hub client add my-laptop      ${DIM('# create + print token')}
  ${DIM('$')} fleex hub client list               ${DIM('# show authorized clients')}
  ${DIM('$')} fleex hub client revoke my-laptop   ${DIM('# delete; hot-disconnects')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
