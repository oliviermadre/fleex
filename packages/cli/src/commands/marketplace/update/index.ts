import fs from 'node:fs';

import { c, ok, info, warn, die } from '../../../core/colors.ts';
import {
  readRegistry,
  getMarketplace,
  git,
  type RegisteredMarketplace,
} from '../../../core/registry.ts';

import type { CommandDef } from '../../../core/types.ts';
import type { Command } from 'commander';

function pull(mp: RegisteredMarketplace): boolean {
  // Fast-forward only; the cache is read-only from fleex's perspective.
  const ff = git(['pull', '--ff-only'], mp.path);
  if (ff.ok) return true;
  // Diverged or dirty cache — re-clone from scratch.
  warn(`${mp.name}: fast-forward failed, re-cloning…`);
  fs.rmSync(mp.path, { recursive: true, force: true });
  const cloned = git(['clone', '--depth', '1', mp.url, mp.path]);
  if (!cloned.ok) {
    warn(`${mp.name}: re-clone failed:\n${cloned.output}`);
    return false;
  }
  return true;
}

const def: CommandDef = {
  name: 'update',
  description: 'Pull the latest version of a marketplace (or all of them)',
  setup(cmd: Command) {
    cmd.argument('[name]', 'marketplace to update (default: all)');
  },
  action(name: string | undefined) {
    const targets = name
      ? (() => {
          const mp = getMarketplace(name);
          if (!mp) die(`Marketplace "${name}" is not registered.`);
          return [mp];
        })()
      : readRegistry();

    if (targets.length === 0) {
      info('No marketplaces registered.');
      return;
    }
    let updated = 0;
    for (const mp of targets) {
      info(`Updating ${c.cyan(mp.name)} …`);
      if (pull(mp)) updated++;
    }
    ok(`Updated ${updated}/${targets.length} marketplace(s).`);
  },
};

export default def;
