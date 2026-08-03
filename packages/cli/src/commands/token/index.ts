import chalk from 'chalk';

import type { CommandDef } from '../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'token',
  aliases: ['tokens'],
  description: 'Manage agent API tokens (list, create, revoke)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex token list                    ${DIM('# all agent tokens (prefix only, never the secret)')}
  ${DIM('$')} fleex token create --name ci-bot     ${DIM('# create a token — the secret is shown ONCE')}
  ${DIM('$')} fleex token revoke ci-bot -f         ${DIM('# revoke by name or id')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
