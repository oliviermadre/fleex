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
  ${DIM('$')} fleex ticket update 42 --type fix --due 2026-07-01
  ${DIM('$')} fleex ticket update 42 --favorite --blocked ${DIM('# toggle flags (use --no-* to clear)')}
  ${DIM('$')} fleex ticket update 42 --add-tag urgent --rm-tag wip
  ${DIM('$')} fleex ticket update 42 --to-board ${GREEN('<board-id>')}    ${DIM('# move to another board')}
  ${DIM('$')} fleex ticket update 42 --add-epic abc12345  ${DIM('# add/remove from an epic')}
  ${DIM('$')} fleex ticket move 42 done                  ${DIM('# mark as done')}
  ${DIM('$')} fleex ticket archive 42                    ${DIM('# archive (unarchive to restore)')}
  ${DIM('$')} fleex ticket comment 42 "Looks good"       ${DIM('# add a comment')}
  ${DIM('$')} fleex ticket comments 42                   ${DIM('# list comments (with ids)')}
  ${DIM('$')} fleex ticket comment-delete 42 a1b2c3d4    ${DIM('# delete a comment by id')}
  ${DIM('$')} fleex ticket mentions 42                   ${DIM('# list mentions + their ids')}
  ${DIM('$')} fleex ticket mention resolve 42 a1b2c3d4   ${DIM('# resolve/ack/wait/run/delete a mention')}
  ${DIM('$')} fleex ticket link 42 --repo github/fleex    ${DIM('# link a repo (auto-creates worktree)')}
  ${DIM('$')} fleex ticket link 42 --pr https://github.com/org/name/pull/123  ${DIM('# attach a PR (URL or org/name#N)')}
  ${DIM('$')} fleex ticket link 42 --issue org/name#45    ${DIM('# attach an issue (URL or org/name#N)')}
  ${DIM('$')} fleex ticket unlink 42 --repo github/fleex  ${DIM('# unlink a repo / --pr / --issue')}
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
