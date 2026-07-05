import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'session',
  aliases: ['sess'],
  description: 'Manage tmux sessions (list, show, create, rename, kill)',
  isParent: true,
  extraHelp: `\n${SECTION('Session ID:')}
  Use a full UUID, the 8-char prefix shown by ${GREEN('fleex session list')}, or an exact display name.

${SECTION('Examples:')}
  ${DIM('$')} fleex session list                        ${DIM('# all live sessions')}
  ${DIM('$')} fleex session create --type shell         ${DIM('# shell session in the current dir')}
  ${DIM('$')} fleex session create --type claude --cwd /path --prompt "fix the bug"
  ${DIM('$')} fleex session rename abc12345 "review"    ${DIM('# rename a session')}
  ${DIM('$')} fleex session kill abc12345 -f            ${DIM('# terminate a session')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
