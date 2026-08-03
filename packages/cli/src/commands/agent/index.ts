import chalk from 'chalk';

import type { CommandDef } from '../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'agent',
  aliases: ['persona'],
  description: 'List & inspect agents (personas)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex agent list                  ${DIM('# all agents + their @agent: handle')}
  ${DIM('$')} fleex agent show builder          ${DIM('# detail of one agent')}
  ${DIM('$')} fleex trigger 42 --agent builder  ${DIM('# make an agent work on a ticket')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
