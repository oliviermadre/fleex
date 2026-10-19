import type { Command } from 'commander';
import type { CommandDef } from '../../core/types.ts';

const def: CommandDef = {
  name: 'release',
  description: 'Release notes stored in releases/ (validate) — see docs/releases.md',
  isParent: true,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
