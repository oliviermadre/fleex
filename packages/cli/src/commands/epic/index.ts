import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'epic',
  aliases: ['e'],
  description: 'Manage epics (list, show)',
  isParent: true,
  extraHelp: `\n${SECTION('Epic ID:')}
  Use a full UUID or the 8-char prefix shown by ${GREEN('fleex epic list')}.

${SECTION('Examples:')}
  ${DIM('$')} fleex epic list                            ${DIM('# all epics, sorted now → next → later')}
  ${DIM('$')} fleex epic list --board <uuid>             ${DIM('# scope to one board')}
  ${DIM('$')} fleex epic show abc12345                   ${DIM('# details + tickets in this epic')}
  ${DIM('$')} fleex ticket list --epic abc12345          ${DIM('# tickets of an epic via ticket cmd')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
