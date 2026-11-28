import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { SPEC_NOTES } from './_shared.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'machine',
  description: 'Machines of the Factory floor — list them, read one, switch a station off or on, add, change or remove one at a time',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex factory machine list                       ${DIM('# stations, zones, exits, intakes… and what each holds')}
  ${DIM('$')} fleex factory machine list --kind belt           ${DIM('# belts, bridges and arms are hidden unless asked for')}
  ${DIM('$')} fleex factory machine show Triage                ${DIM('# its settings, its prompt, the tickets in it')}
  ${DIM('$')} fleex factory machine power Triage off           ${DIM('# takes tickets in, starts nothing')}
  ${DIM('$')} fleex factory machine add station --x 20 --y 10 --name Triage --exec agent --ref builder --outcomes ok,rework
  ${DIM('$')} fleex factory machine add belt --x 14 --y 12 --dir east --length 6   ${DIM('# a line of six belts')}
  ${DIM('$')} fleex factory machine add arm --x 25 --y 12 --dir east --spec '{"when":[{"field":"outcome","op":"is","values":["rework"]}]}'
  ${DIM('$')} fleex factory machine edit Triage --prompt "Sort by urgency" --cap 2
  ${DIM('$')} fleex factory machine edit Triage --spec '{"model":null}'            ${DIM('# null takes a setting off')}
  ${DIM('$')} fleex factory machine remove Triage -f

${SECTION('Notes:')}
  A machine is named by its name (case does not matter), its id, or the start of its id.
  Tiles are counted from the left (x) and from the top (y): east is +x, south is +y.
  An arm takes from the tile behind it and drops on the tile in front. A station is
  5 by 5 tiles; what feeds it and what leaves it line up on its middle row.
  The floor refuses what cannot be built (two machines on one tile…), with the reason.
  The page edits the same floor: a change made here shows there within a second.

${SPEC_NOTES}`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
