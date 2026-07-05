import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'board',
  aliases: ['b'],
  description: 'Manage boards (create, update, delete)',
  isParent: true,
  extraHelp: `\n${SECTION('Board ID:')}
  Use a board name, a full UUID, or the 8-char id prefix shown by ${GREEN('fleex ticket boards')}.

${SECTION('Listing:')} boards are listed with ${GREEN('fleex ticket boards')} (with per-status ticket counts).

${SECTION('Examples:')}
  ${DIM('$')} fleex board create --name "Roadmap" --emoji 🗺️
  ${DIM('$')} fleex board update Roadmap --name "Product Roadmap"   ${DIM('# rename')}
  ${DIM('$')} fleex board update Roadmap --emoji 🚀                  ${DIM('# change emoji')}
  ${DIM('$')} fleex board delete Roadmap -f                          ${DIM('# also deletes its tickets!')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
