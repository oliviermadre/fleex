import type { Command } from 'commander';
import type { CommandDef } from '../../core/types.ts';

const def: CommandDef = {
  name: 'file',
  description: 'Files stored by Fleex (upload) — embed them in deliverables and comments',
  isParent: true,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
