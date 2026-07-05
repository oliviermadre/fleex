import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'mention',
  description: 'Manage a single mention (run, resolve, ack, wait, delete)',
  isParent: true,
  extraHelp: `\n${SECTION('Mention ID:')}
  List a ticket's mentions with ${GREEN('fleex ticket mentions <ticket>')}; use the
  8-char id shown there (or a full UUID) as the ${GREEN('<mention>')} argument.

${SECTION('Examples:')}
  ${DIM('$')} fleex ticket mentions 42                  ${DIM('# list mentions + their ids')}
  ${DIM('$')} fleex ticket mention run 42 a1b2c3d4        ${DIM('# (re)run this mention')}
  ${DIM('$')} fleex ticket mention resolve 42 a1b2c3d4    ${DIM('# mark resolved')}
  ${DIM('$')} fleex ticket mention ack 42 a1b2c3d4        ${DIM('# acknowledge')}
  ${DIM('$')} fleex ticket mention wait 42 a1b2c3d4       ${DIM('# set waiting-for-info')}
  ${DIM('$')} fleex ticket mention delete 42 a1b2c3d4 -f  ${DIM('# remove the mention')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
