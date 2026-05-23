import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'ticket',
  aliases: ['t'],
  description: 'Manage tickets (list, show, create, update, move, delete, ...)',
  isParent: true,
  extraHelp: `\n${SECTION('Ticket ID:')}
  Use a display ID (e.g. ${GREEN('42')} or ${GREEN('#42')}) or a full UUID.
  If multiple boards share the same display ID, disambiguate with ${chalk.cyan('--board <id>')}.

${SECTION('Statuses:')}  backlog, todo, doing, reviewing, done, cancelled
${SECTION('Priorities:')} none, low, medium, high

${SECTION('Examples:')}
  ${DIM('$')} fleex ticket list                          ${DIM('# all tickets')}
  ${DIM('$')} fleex ticket list --status doing           ${DIM('# in-progress tickets')}
  ${DIM('$')} fleex ticket list --epic abc12345          ${DIM('# tickets in an epic')}
  ${DIM('$')} fleex ticket show 42                       ${DIM('# show ticket #42')}
  ${DIM('$')} fleex ticket show 42 --full                ${DIM('# include comments + deliverables')}
  ${DIM('$')} fleex ticket create --title "Fix bug"      ${DIM('# create a new ticket')}
  ${DIM('$')} fleex ticket update 42 --priority high     ${DIM('# set priority')}
  ${DIM('$')} fleex ticket move 42 done                  ${DIM('# mark as done')}
  ${DIM('$')} fleex ticket comment 42 "Looks good"       ${DIM('# add a comment')}
  ${DIM('$')} fleex ticket deliverable list 42           ${DIM('# list deliverables')}
  ${DIM('$')} fleex ticket deliverable add 42 --title T --type prd --file ./prd.md
  ${DIM('$')} fleex ticket delete 42 -f                  ${DIM('# delete without confirm')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
