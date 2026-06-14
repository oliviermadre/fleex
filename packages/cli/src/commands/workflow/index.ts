import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'workflow',
  aliases: ['wf'],
  description: 'List & inspect workflow templates',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow list                ${DIM('# all workflow templates + @workflow: handle')}
  ${DIM('$')} fleex workflow list --enabled      ${DIM('# only enabled workflows')}
  ${DIM('$')} fleex workflow show spec-dev-pr    ${DIM('# detail + steps of one workflow')}
  ${DIM('$')} fleex trigger 42 --workflow spec-dev-pr
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
