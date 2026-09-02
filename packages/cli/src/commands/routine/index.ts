import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'routine',
  aliases: ['rt'],
  description: 'Manage routines — scheduled workflow runs with no ticket (create, edit, list, show, run, enable, disable, suggest)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex routine list                 ${DIM('# every routine, its schedule and next run')}
  ${DIM('$')} fleex routine show daily-recap     ${DIM('# detail: subject, trigger, last/next run')}
  ${DIM('$')} fleex routine create "Daily recap" --workflow recap --cron "0 9 * * *"
  ${DIM('$')} fleex routine edit daily-recap --overlap queue --brief "Focus on PRs"
  ${DIM('$')} fleex routine run daily-recap      ${DIM('# launch now, out of schedule')}
  ${DIM('$')} fleex routine disable daily-recap  ${DIM('# pause it without deleting it')}
  ${DIM('$')} fleex routine enable daily-recap   ${DIM('# resume — re-armed from now, not from the missed slot')}
  ${DIM('$')} fleex routine suggest              ${DIM('# work you repeat on a schedulable cadence')}
  ${DIM('$')} fleex routine suggest --all        ${DIM('# also the repeated work too irregular to schedule')}

${SECTION('Notes:')}
  ${DIM('suggest')} reads the execution log — local and free, no network, no model. It
  only proposes what a ${DIM('cron')} would have fired on: work you already wrapped in a
  skill or an agent. It does not propose what to wrap.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
