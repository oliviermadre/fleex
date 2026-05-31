import type { Command } from 'commander';
import fs from 'node:fs';
import type { CommandDef } from '../../../core/types.ts';
import { c, ok, die } from '../../../core/colors.ts';
import { getMarketplace, removeMarketplace } from '../../../core/registry.ts';

const def: CommandDef = {
  name: 'remove',
  aliases: ['rm'],
  description: 'Unregister a marketplace and delete its local cache',
  setup(cmd: Command) {
    cmd.argument('<name>', 'registered marketplace name');
  },
  action(name: string) {
    const mp = getMarketplace(name);
    if (!mp) die(`Marketplace "${name}" is not registered.`);
    fs.rmSync(mp.path, { recursive: true, force: true });
    removeMarketplace(name);
    ok(`Removed marketplace "${c.cyan(name)}".`);
  },
};

export default def;
