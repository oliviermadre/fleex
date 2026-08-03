import chalk from 'chalk';

import type { CommandDef } from '../../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'deliverable',
  aliases: ['deliv'],
  description: 'Manage deliverables on a ticket (list, show, add, update, delete)',
  isParent: true,
  extraHelp: `\n${SECTION('Deliverable types:')}
  Configured per workspace (Settings → Deliverable Types). Default preset:
  prd, spec, plan, code, report, url, html, ticket-summary

${SECTION('Status values:')}  draft, final

${SECTION('Content format:')}
  --content writes the value as-is. --file reads a local file (Markdown or HTML)
  and ships it as-is — the server stores raw content and does no conversion.

${SECTION('Examples:')}
  ${DIM('$')} fleex ticket deliverable list 42
  ${DIM('$')} fleex ticket deliverable show 42 ${GREEN('<deliverable-uuid>')}
  ${DIM('$')} fleex ticket deliverable add 42 --title "PRD X" --type prd --file ./prd.md
  ${DIM('$')} fleex ticket deliverable add 42 --title T --type report --content "..."
  ${DIM('$')} fleex ticket deliverable update 42 ${GREEN('<deliverable-uuid>')} --status final
  ${DIM('$')} fleex ticket deliverable delete 42 ${GREEN('<deliverable-uuid>')} -f
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
