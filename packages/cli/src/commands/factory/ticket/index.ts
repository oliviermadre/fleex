import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'ticket',
  description: 'Tickets on the Factory floor — hand one over, move it, release it, decide at a gate, run its station again, take it back',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM("$")} fleex factory ticket list --needs          ${DIM("# only those that wait for someone")}
  ${DIM("$")} fleex factory ticket send 42               ${DIM("# hand #42 over: it lands in Inbound")}
  ${DIM("$")} fleex factory ticket send 42 --to Triage   ${DIM("# or straight onto a machine")}
  ${DIM("$")} fleex factory ticket show 42               ${DIM("# where it stands, what it waits for, what can be done")}
  ${DIM("$")} fleex factory ticket release 42            ${DIM("# let it leave its zone")}
  ${DIM("$")} fleex factory ticket decide 42 approved --reason "ship it"
  ${DIM("$")} fleex factory ticket retry 42              ${DIM("# after a failed run, or once a question is answered")}
  ${DIM("$")} fleex factory ticket aside 42              ${DIM("# stop its run, keep it in its station")}
  ${DIM("$")} fleex factory ticket put-back 42 --as ok   ${DIM("# send it out as if the station had concluded")}
  ${DIM("$")} fleex factory ticket take-back 42          ${DIM("# off the floor: an ordinary ticket again")}

${SECTION("Notes:")}
  A ticket is named by its number (${DIM("42")}, ${DIM("#42")}) or its id. An item is not a ticket but
  travels the floor the same way: every command here but ${DIM("send")} also takes an item's id
  (or the start of it), and ${DIM("fleex factory item")} has what only an item has.
  ${DIM("show")} lists what can be done with a ticket where it stands; anything else is refused
  by the floor, with the reason.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
