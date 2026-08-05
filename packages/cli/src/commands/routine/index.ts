import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'routine',
  aliases: ['rt'],
  description: 'Manage routines — scheduled workflow runs with no ticket (create, edit, list, show, run, enable, disable)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex routine list                 ${DIM('# every routine, its schedule and next run')}
  ${DIM('$')} fleex routine show daily-recap     ${DIM('# detail: subject, trigger, last/next run')}
  ${DIM('$')} fleex routine create "Daily recap" --workflow recap --cron "0 9 * * *"
  ${DIM('$')} fleex routine edit daily-recap --overlap queue --brief "Focus on PRs"
  ${DIM('$')} fleex routine run daily-recap      ${DIM('# launch now, out of schedule')}
  ${DIM('$')} fleex routine disable daily-recap  ${DIM('# pause it without deleting it')}
  ${DIM('$')} fleex routine enable daily-recap   ${DIM('# resume — re-armed from now, not from the missed slot')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
