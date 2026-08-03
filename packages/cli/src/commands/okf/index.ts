import chalk from 'chalk';

import type { CommandDef } from '../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'okf',
  description: 'Export Fleex knowledge as an OKF (Open Knowledge Format) bundle',
  isParent: true,
  extraHelp: `\n${SECTION('What it does:')}
  Renders the whole knowledge base of a workspace (boards, epics, tickets,
  public discussions, deliverables, agents, workflows) into a deterministic
  OKF v0.1 markdown bundle — diffable, git-friendly, LLM-queryable.

${SECTION('Examples:')}
  ${DIM('$')} fleex okf generate                              ${DIM('# default workspace → ~/.fleex/okf')}
  ${DIM('$')} fleex okf generate --workspace tada --out ./okf
  ${DIM('$')} fleex okf generate --dry-run                    ${DIM('# list planned files, write nothing')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
