import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'skill',
  description: 'List & inspect skills',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex skill list                       ${DIM('# all skills + their @skill: handle')}
  ${DIM('$')} fleex skill list --enabled             ${DIM('# only enabled skills')}
  ${DIM('$')} fleex skill list --origin cc           ${DIM('# only Claude Code skills (cc:user|project|plugin|synced)')}
  ${DIM('$')} fleex skill list --all --origin cc:plugin ${DIM('# incl. disabled / missing ones')}
  ${DIM('$')} fleex skill scan                       ${DIM("# re-scan the server machine's SKILL.md")}
  ${DIM('$')} fleex skill show ship                  ${DIM('# detail of one skill')}
  ${DIM('$')} fleex trigger 42 --skill security-review

${SECTION('Claude Code skills:')}
  Fleex mirrors the SKILL.md found on the machine running the server: ~/.claude/skills,
  claude.ai synced skills, enabled user-scope plugins, and .claude/skills of known repos.
  They are mentioned as ${DIM('@skill:cc-<name>')} (${DIM(':')} and ${DIM('/')} become ${DIM('--')}), arrive disabled,
  and run by default as the system persona "Claude Code" through Claude Code's Skill tool.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
