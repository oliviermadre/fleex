import chalk from 'chalk';

import type { CommandDef } from '../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'epic',
  aliases: ['e'],
  description: 'Manage epics (list, show, create, update, delete, archive, membership)',
  isParent: true,
  extraHelp: `\n${SECTION('Epic ID:')}
  Use a full UUID or the 8-char prefix shown by ${GREEN('fleex epic list')}.

${SECTION('Examples:')}
  ${DIM('$')} fleex epic list                            ${DIM('# all epics, sorted now → next → later')}
  ${DIM('$')} fleex epic show abc12345                   ${DIM('# details + tickets in this epic')}
  ${DIM('$')} fleex epic create --name "Q3 Launch" --timeframe now
  ${DIM('$')} fleex epic update abc12345 --timeframe next --blocked
  ${DIM('$')} fleex epic add-ticket abc12345 42          ${DIM('# put ticket #42 in the epic')}
  ${DIM('$')} fleex epic remove-board abc12345 <board>   ${DIM('# unlink a board')}
  ${DIM('$')} fleex epic archive abc12345                ${DIM('# hide from the active list')}
  ${DIM('$')} fleex epic delete abc12345 -f              ${DIM('# delete (tickets are kept)')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
