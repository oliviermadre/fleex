import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'todo',
  aliases: ['todos'],
  description: "Manage the ticket's shared todo list (list, add, assign, edit, done, cancel, reopen, move, delete, history)",
  isParent: true,
  extraHelp: `\n${SECTION('What it is:')}
  A checklist attached to one ticket, shared by the human and the agents.
  Use it for multi-step work: lay out the plan, check items as you go, let the
  next agent (or the human in QA) see what is left. Optional — most tickets
  never need one.

${SECTION('Items:')}  each has a per-ticket ref (#1, #2…) that is never reused.
  States: open (alias: todo), done, cancelled. Every change is recorded with
  who, when and from where — see \`history\`.

${SECTION('Assignee:')} who an item is for — the human (user), any agent, one persona
  (builder…), or anyone (none). What the human adds is theirs by default; what
  an agent adds is for anyone. \`me\` is you (for an agent run: its persona).

${SECTION('Etiquette for agents:')}
  - add the steps you plan (\`add --file plan.txt\` for several at once);
  - work on your items and unassigned ones (\`list --mine\`); mark them done
    as you complete them;
  - NEVER act on an item assigned to the human (done, cancel, edit, delete
    are refused). Take it over (\`assign … me --reason "…"\`) only when the
    human explicitly asked you to — never just to complete it;
  - hand to the human (\`--to user\`) what only they can do: manual QA,
    decisions, credentials;
  - never delete an item you did not create — cancel it with --reason.

${SECTION('Attribution:')} an agent run exports FLEEX_ACTOR_NAME and FLEEX_ACTOR_PERSONA;
  \`--as <name>\` forces it.

${SECTION('Examples:')}
  ${DIM('$')} fleex ticket todo list 42
  ${DIM('$')} fleex ticket todo add 42 "Write migration 042" --note "follow 040"
  ${DIM('$')} fleex ticket todo add 42 --file plan.txt
  ${DIM('$')} fleex ticket todo add 42 "Test pg for real" --to user
  ${DIM('$')} fleex ticket todo list 42 --mine
  ${DIM('$')} fleex ticket todo assign 42 4 5 builder
  ${DIM('$')} fleex ticket todo done 42 1 2
  ${DIM('$')} fleex ticket todo cancel 42 3 --reason "covered by #2"
  ${DIM('$')} fleex ticket todo reopen 42 3
  ${DIM('$')} fleex ticket todo move 42 5 --first
  ${DIM('$')} fleex ticket todo history 42 3
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
