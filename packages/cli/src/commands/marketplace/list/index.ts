import type { CommandDef } from '../../../core/types.ts';
import { c, info } from '../../../core/colors.ts';
import { readRegistry, loadManifest } from '../../../core/registry.ts';

const def: CommandDef = {
  name: 'list',
  aliases: ['ls'],
  description: 'List registered marketplaces',
  action() {
    const registry = readRegistry();
    if (registry.length === 0) {
      info('No marketplaces registered. Add one with: fleex marketplace add <git-url>');
      return;
    }
    for (const mp of registry) {
      let summary = c.dim('(unreadable)');
      try {
        const manifest = loadManifest(mp.path);
        const counts = manifest.primitives.reduce<Record<string, number>>((acc, p) => {
          acc[p.kind] = (acc[p.kind] ?? 0) + 1;
          return acc;
        }, {});
        summary = Object.entries(counts)
          .map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`)
          .join(' · ') || c.dim('(empty)');
      } catch {
        // keep "(unreadable)"
      }
      process.stdout.write(`${c.bold(c.cyan(mp.name))}  ${summary}\n`);
      process.stdout.write(`  ${c.dim(mp.url)}\n`);
    }
  },
};

export default def;
