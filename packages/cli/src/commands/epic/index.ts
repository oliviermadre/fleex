import type { Command } from 'commander';
import type { CommandDef } from '../../core/types.ts';

const def: CommandDef = {
  name: 'epic',
  aliases: ['e'],
  description: 'Manage epics (list, show)',
  isParent: true,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
