import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'item',
  description: 'Items of the Factory — conversations that came in from Slack, Gmail, GitHub or by hand: list, read, create, edit, archive, bring back',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex factory item list                    ${DIM('# the items on the floor')}
  ${DIM('$')} fleex factory item show 3f2a9c1e --body    ${DIM('# an item, with its whole latest message')}
  ${DIM('$')} fleex factory item create --title "Call the supplier" --text "They asked for a quote"
  ${DIM('$')} fleex factory item edit 3f2a9c1e --tag urgent --tag type:quote
  ${DIM('$')} fleex factory item archive 3f2a9c1e        ${DIM('# junk, or done with')}
  ${DIM('$')} fleex factory item archived --days 30      ${DIM('# what left: by hand, by an exit, dropped by a rule')}
  ${DIM('$')} fleex factory item bring-back 3f2a9c1e     ${DIM('# back to the intake it came in by')}

${SECTION('Notes:')}
  An item is not a ticket: it has no number and no thread. It is named by its id, or
  the start of it. On the floor it travels as a ticket does, so it is moved, released,
  decided on and run again with ${DIM('fleex factory ticket move|release|decide|retry|put-back')}.
  An item needs an intake of its source on the floor to come in by
  (${DIM('fleex factory machine add intake --x 10 --y 10 --spec \'{"source":"manual"}\'')}).
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
