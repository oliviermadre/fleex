import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'annotation',
  aliases: ['annot'],
  description: 'Manage Timeline annotations on a ticket (list, add, update, delete)',
  isParent: true,
  extraHelp: `\n${SECTION('What it is:')}
  A highlighted fact pinned to an instant of the ticket's Timeline ("we dropped
  Redis here", "validated in the client demo"). Always visible on the frieze.

${SECTION('Tones:')}  info (default), highlight, warning, success
${SECTION('Instant:')} --at takes an ISO date or "now" (default). Before the ticket's
  creation is refused; a future instant is clamped to now.

${SECTION('Examples:')}
  ${DIM('$')} fleex ticket annotation list 42
  ${DIM('$')} fleex ticket annotation add 42 --title "Pivot: on lâche Redis" --tone highlight
  ${DIM('$')} fleex ticket annotation add 42 --title "CI cassée" --at 2026-10-15T10:00:00Z --body-file notes.md
  ${DIM('$')} fleex ticket annotation update 42 ${GREEN('<annotation-uuid>')} --tone warning
  ${DIM('$')} fleex ticket annotation delete 42 ${GREEN('<annotation-uuid>')} -f
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
