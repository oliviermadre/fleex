import type { Command } from 'commander';
import type { CommandDef } from '../../core/types.ts';

const def: CommandDef = {
  name: 'ticket',
  aliases: ['t'],
  description: 'Manage tickets (list, show, create, update, move, delete, ...)',
  isParent: true,
  action: (...args: unknown[]) => {
    // Commander passes the Command instance as the last argument. When invoked
    // without a subcommand, print the subcommand help.
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
