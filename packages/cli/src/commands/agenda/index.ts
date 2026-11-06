import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'agenda',
  description: 'Agenda — read it (list, search, show, status), free events (event create|update|delete), deliverable links (link, links, unlink), invitations (respond)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex agenda list tomorrow                                   ${DIM('# every item, each with its ref (ag_…)')}
  ${DIM('$')} fleex agenda list week --type external,event
  ${DIM('$')} fleex agenda search --attendee "jean-baptiste" --since 2026-10-26 --until 2026-11-01
  ${DIM('$')} fleex agenda show <ref>                                      ${DIM('# guests, notes, linked deliverables')}
  ${DIM('$')} fleex agenda event create --title "Offsite" --start 2026-11-07T14:00 --duration 1h30
  ${DIM('$')} fleex agenda event update <event-id> --start 2026-11-07T16:00  ${DIM('# moved, same length')}
  ${DIM('$')} fleex agenda link --deliverable <uuid> --item <ref>
  ${DIM('$')} fleex agenda link --deliverable <uuid> --match-title "Daily" --date 2026-11-05
  ${DIM('$')} fleex agenda links --item <ref>
  ${DIM('$')} fleex agenda respond <ref> yes

${SECTION('Notes:')}
  Google Calendar is read through gogcli (gog) on the Fleex server: https://gogcli.sh/quickstart.html.
  The calendars read are the ones picked in the agenda preferences (--calendar overrides).
  Display preferences (hidden labels, sidebar filters) never apply here: pass the filters you want.
  Links only live in Fleex; the only write to Google is \`respond\`.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
