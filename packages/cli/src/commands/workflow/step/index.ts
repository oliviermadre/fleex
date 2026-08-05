import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'step',
  description: 'Control individual step runs in a workflow run (retry, deliverable)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow step retry <runId> <stepRunId>   ${DIM('# re-run a failed step')}
  ${DIM('$')} fleex workflow step deliverable add <runId> <stepRunId> --title "…" --file ./out.md
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
