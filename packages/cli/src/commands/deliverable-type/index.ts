import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'deliverable-type',
  aliases: ['deliverable-types', 'dtype'],
  description: 'Manage configured deliverable types (list, create, update, rename, delete, reassign)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex deliverable-type list                              ${DIM('# configured types + usage counts')}
  ${DIM('$')} fleex deliverable-type create --id diagram --label Diagram --renderer html --color violet
  ${DIM('$')} fleex deliverable-type update diagram --label "Architecture Diagram"
  ${DIM('$')} fleex deliverable-type rename diagram architecture-diagram   ${DIM('# migrates existing deliverables')}
  ${DIM('$')} fleex deliverable-type reassign old-type report            ${DIM('# move all deliverables to another type')}
  ${DIM('$')} fleex deliverable-type delete diagram -f                   ${DIM('# only when unused')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
