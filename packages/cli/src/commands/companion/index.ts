import chalk from 'chalk';

import type { CommandDef } from '../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'companion',
  description: 'Manage the side-panel companion that backs the Chrome extension',
  isParent: true,
  extraHelp: `\n${SECTION('What this is:')}
  The local backend the Chrome side-panel extension talks to over
  ${GREEN('ws://localhost:4399')}. It holds the Anthropic key, runs the tool-use loop,
  and executes fleex tools. It is a ${chalk.bold('machine-wide singleton')}: one process
  serves every workspace (each conversation carries its own --workspace).

${SECTION('Source & key:')}
  Runs from ${GREEN('~/.fleex/repo')} (canonical install), not the current worktree, so the
  shared singleton isn't pinned to one branch. Override with FLEEX_COMPANION_REPO.
  The Anthropic key is read from ${GREEN('~/.fleex/config')} (ANTHROPIC_API_KEY=sk-ant-…).

${SECTION('Lifecycle:')}
  ${DIM('$')} fleex companion start     ${DIM('# idempotent — reused if already healthy')}
  ${DIM('$')} fleex companion status
  ${DIM('$')} fleex companion stop
  ${DIM('Started automatically by `fleex start`; left running by `fleex stop` unless')}
  ${DIM('it was the last instance (or `fleex stop --all`).')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
