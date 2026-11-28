import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'layout',
  description: 'The floor as a file — export every machine and its settings, import a floor back',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex factory layout export > floor.json       ${DIM('# the same file the page\'s Export downloads')}
  ${DIM('$')} fleex factory layout import floor.json -f       ${DIM('# replace the floor with it')}

${SECTION('Notes:')}
  The file holds the machines and their settings: no ticket, item or run. ${DIM('import')}
  replaces the whole floor and keeps the ids of the file, so a floor exported here
  comes back as it was; the tickets of machines that are gone are left lying on the
  floor. To change one machine, ${DIM('fleex factory machine edit')} is safer. A floor from
  another instance is better imported from the page (Build › Import), which matches
  personas, skills and boards by name.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
