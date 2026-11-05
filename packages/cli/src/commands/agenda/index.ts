import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'agenda',
  description: 'Agenda — link deliverables to Google Calendar meetings (link, unlink, links)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex agenda link --deliverable <uuid> --google-event <event-id>            ${DIM('# by Google event id (primary calendar)')}
  ${DIM('$')} fleex agenda link --deliverable <uuid> --match-title "Daily" --date 2026-11-05  ${DIM('# by title on a day')}
  ${DIM('$')} fleex agenda link --deliverable <uuid> --google-event <id> --calendar team@group.calendar.google.com
  ${DIM('$')} fleex agenda links --deliverable <uuid>                                     ${DIM('# meetings a deliverable is linked to')}
  ${DIM('$')} fleex agenda unlink <link-id>

${SECTION('Notes:')}
  Google Calendar must be connected first, from the /agenda page. The link only
  lives in Fleex: nothing is written to Google. Linking twice is a no-op.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
