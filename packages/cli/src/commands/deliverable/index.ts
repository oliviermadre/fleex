import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'deliverable',
  description: 'Deliverables across every ticket and routine run — search, show (ticket-scoped writes: `fleex ticket deliverable`)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex deliverable search --q "Wispr" --type transcript       ${DIM('# newest first')}
  ${DIM('$')} fleex deliverable search --origin routine --limit 5
  ${DIM('$')} fleex deliverable show <uuid> --content-only
`,
  action: (...args: unknown[]) => {
    (args[args.length - 1] as Command).outputHelp();
  },
};

export default def;
