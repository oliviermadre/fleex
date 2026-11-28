import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'factory',
  description: 'Operate the Factory floor — what waits for you, tickets and items on it, its machines, its layout, the emergency stop',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex factory status                       ${DIM('# on or off, stopped or not, how full, what waits')}
  ${DIM('$')} fleex factory needs                        ${DIM('# what waits for someone, longest wait first')}
  ${DIM('$')} fleex factory ticket send 42               ${DIM('# hand ticket #42 over: it lands in Inbound')}
  ${DIM('$')} fleex factory ticket move 42 --to Triage   ${DIM('# put it on a machine, by name or id')}
  ${DIM('$')} fleex factory ticket decide 42 approved --reason "looks right"
  ${DIM('$')} fleex factory ticket retry 42              ${DIM('# run its station again after a failure or a question')}
  ${DIM('$')} fleex factory machine list                 ${DIM('# stations, zones, exits… and what each holds')}
  ${DIM('$')} fleex factory machine power Builder off    ${DIM('# a station takes tickets in but starts nothing')}
  ${DIM('$')} fleex factory halt                         ${DIM('# the emergency stop; `resume` lifts it')}
  ${DIM('$')} fleex factory layout export > floor.json

${SECTION('Notes:')}
  The Factory is experimental and off by default: ${DIM('fleex factory enable')} switches it on
  for the workspace. A ${DIM('ticket')} command also takes an item's id: both travel the floor
  the same way. Tiles are counted from the left (x) and from the top (y); a direction
  is ${DIM('east')}, ${DIM('south')}, ${DIM('west')} or ${DIM('north')}.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
