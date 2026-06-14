import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'skill',
  description: 'List & inspect skills',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex skill list                       ${DIM('# all skills + their @skill: handle')}
  ${DIM('$')} fleex skill list --enabled             ${DIM('# only enabled skills')}
  ${DIM('$')} fleex skill show ship                  ${DIM('# detail of one skill')}
  ${DIM('$')} fleex trigger 42 --skill security-review
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
