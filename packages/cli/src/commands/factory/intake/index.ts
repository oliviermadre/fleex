import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'intake',
  description: 'Intakes that pull their source (Gmail) — pull one now, check that the mailbox can be read',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex factory machine list --kind intake   ${DIM('# the intakes, what each dropped, its last pull')}
  ${DIM('$')} fleex factory intake mail                  ${DIM('# is gogcli installed and Gmail authorized?')}
  ${DIM('$')} fleex factory intake pull "Support inbox"  ${DIM('# without waiting for its interval')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
