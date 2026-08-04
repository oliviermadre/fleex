import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'workflow',
  aliases: ['wf'],
  description: 'Manage workflow templates & runs (list, show, run, gate, route, step)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow list                ${DIM('# all workflow templates + @workflow: handle')}
  ${DIM('$')} fleex workflow show spec-dev-pr    ${DIM('# detail + steps of one workflow')}
  ${DIM('$')} fleex trigger 42 --workflow spec-dev-pr
  ${DIM('$')} fleex workflow run list 42         ${DIM('# runs for ticket #42')}
  ${DIM('$')} fleex workflow run cancel <runId> -f
  ${DIM('$')} fleex workflow gate resolve <runId> <stepRunId> --outcome approved
  ${DIM('$')} fleex workflow route <runId> <stepRunId>            ${DIM('# list the branches that matched')}
  ${DIM('$')} fleex workflow route <runId> <stepRunId> --edge <id>
  ${DIM('$')} fleex workflow step retry <runId> <stepRunId>
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
