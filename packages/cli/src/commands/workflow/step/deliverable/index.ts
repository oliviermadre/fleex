import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'deliverable',
  aliases: ['deliverables'],
  description: 'Attach or list deliverables on a step run (add, list)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow step deliverable add <runId> <stepRunId> --title "Transcript" --file ./t.md
  ${DIM('$')} fleex workflow step deliverable list <runId> <stepRunId>

${SECTION('Why:')}
  A step that returns a long deliverable through its structured output has to
  re-serialize the whole content as output tokens — slow, and it can blow past
  the output limit. ${DIM('--file')} sends the content straight from disk instead.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
