import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'panel',
  description: 'List & inspect panels',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex panel list                   ${DIM('# all panels + their @panel: handle')}
  ${DIM('$')} fleex panel list --enabled         ${DIM('# only enabled panels')}
  ${DIM('$')} fleex panel show chapeaux          ${DIM('# detail of one panel')}
  ${DIM('$')} fleex trigger 42 --panel chapeaux
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
