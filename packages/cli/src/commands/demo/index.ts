import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'demo',
  description: 'Demo workspace for screenshots and release notes (reset)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex demo reset --workspace demo                              ${DIM('# fresh « Atelier Nova » backlog')}
  ${DIM('$')} fleex demo reset --scenario timeline-annotations --workspace demo

${SECTION('Notes:')}
  Only on the ${DIM('demo')} workspace (FLEEX_DEMO_MODE=1, one SQLite file per instance).
  The seed lives in ${DIM('demo/seed/*.yaml')}, scenarios in ${DIM('demo/scenarios/')}. See docs/releases.md.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
