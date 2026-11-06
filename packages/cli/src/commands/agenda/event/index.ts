import type { Command } from 'commander';
import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  name: 'event',
  description: 'Free events of the agenda (stored in Fleex, not in Google): create, update, delete',
  isParent: true,
  action: (...args: unknown[]) => {
    (args[args.length - 1] as Command).outputHelp();
  },
};

export default def;
