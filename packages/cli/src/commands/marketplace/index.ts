import chalk from 'chalk';

import type { CommandDef } from '../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'marketplace',
  aliases: ['mp'],
  description: 'Register and manage primitive marketplaces (add, list, update, remove)',
  isParent: true,
  extraHelp: `\n${SECTION('What is a marketplace:')}
  A plain git repo that shares agentic primitives (personas, skills, panels,
  workflows). Register any number of them — yours, your team's, another org's.

${SECTION('Examples:')}
  ${DIM('$')} fleex marketplace add ${GREEN('git@github.com:oliviermadre/fleex-marketplace.git')}
  ${DIM('$')} fleex marketplace list
  ${DIM('$')} fleex marketplace update                ${DIM('# pull all')}
  ${DIM('$')} fleex marketplace update evaneos-fleex-marketplace
  ${DIM('$')} fleex marketplace remove oliviermadre-fleex-marketplace
  ${DIM('$')} fleex import                            ${DIM('# install primitives from one')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
