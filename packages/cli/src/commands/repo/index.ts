import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'repo',
  aliases: ['repository'],
  description: 'Manage repositories & worktrees (list, show, register, ...)',
  isParent: true,
  extraHelp: `\n${SECTION('Repository ref:')}  ${GREEN('org/name')} (e.g. ${GREEN('oliviermadre/fleex')})

${SECTION('Examples:')}
  ${DIM('$')} fleex repo list                              ${DIM('# configured repos + summaries')}
  ${DIM('$')} fleex repo show oliviermadre/fleex           ${DIM('# dashboard: PRs, issues, worktrees')}
  ${DIM('$')} fleex repo worktrees oliviermadre/fleex      ${DIM('# branch ↔ path pairs')}
  ${DIM('$')} fleex repo branches oliviermadre/fleex
  ${DIM('$')} fleex repo pr --repo oliviermadre/fleex --state open
  ${DIM('$')} fleex repo issues --repo oliviermadre/fleex
  ${DIM('$')} fleex repo register oliviermadre/fleex       ${DIM('# add to workspace config (auto-clones)')}
  ${DIM('$')} fleex repo unregister oliviermadre/fleex     ${DIM('# remove from config (deletes clone)')}
  ${DIM('$')} fleex repo refresh --all                     ${DIM('# refresh GitHub data in background')}

${SECTION('Worktree commands')} ${DIM('(the WORKTREES buttons of the Work view; worktree = current dir or --worktree):')}
  ${DIM('$')} fleex repo actions                           ${DIM('# commands: actions, launch.json, npm, make, composer')}
  ${DIM('$')} fleex repo run start                         ${DIM('# start | stop | restart | status | open | logs')}
  ${DIM('$')} fleex repo run npm:test                      ${DIM('# any id listed by actions')}
  ${DIM('$')} fleex repo pin npm:test                      ${DIM('# ★ in the menu (unpin to undo)')}
  ${DIM('$')} fleex repo share action:lint                 ${DIM('# Partager → .fleex/worktree.json (unshare = Garder pour moi)')}
  ${DIM('$')} fleex repo hooks show | run setup | open     ${DIM('# Setup / Teardown hooks')}

${SECTION('Attach a PR/issue to a ticket:')}  that's a ${GREEN('ticket')} command, not ${GREEN('repo')}.
  ${DIM('$')} fleex ticket link 42 --pr <pr-url>           ${DIM('# ATTACH a PR to ticket #42 (URL or org/name#N)')}
  ${DIM('$')} fleex ticket link 42 --issue <issue-url>     ${DIM('# ATTACH an issue (use unlink to remove)')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
