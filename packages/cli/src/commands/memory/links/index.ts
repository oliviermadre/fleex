import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { die, info, present } from '../../../core/colors.ts';

interface NoteLinks {
  backlinks: Array<{ key: string; label: string }>;
  related: Array<{ key: string; label: string; score: number }>;
}

/**
 * The graph around one note: what links to it, and what resembles it.
 *
 * `global` is accepted as a spelling of the global note's key, because that is
 * what a `[[global]]` link says and nobody types `__global__` by choice.
 */
const def: CommandDef = {
  workspaceAware: true,
  name: 'links',
  description: 'Show which notes link to a note, and which ones resemble it',
  setup(cmd) {
    cmd.argument('<note>', 'Note key: "global" or "owner/name"');
  },
  action: async (note: string) => {
    const key = note.trim().toLowerCase() === 'global' ? '__global__' : note.trim();
    if (!key) die('A note key is required.');

    const params = new URLSearchParams({ key, target: key });
    const res = await apiGet<NoteLinks>(`${apiBase()}/api/scratchpads/links?${params.toString()}`);

    present(res, () => {
      if (res.backlinks.length === 0 && res.related.length === 0) {
        info(`Nothing links to ${key}, and nothing indexed resembles it.`);
        return;
      }
      if (res.backlinks.length > 0) {
        process.stdout.write(`${chalk.bold('Linked from')}\n`);
        for (const link of res.backlinks) process.stdout.write(`  ${link.label}\n`);
        process.stdout.write('\n');
      }
      if (res.related.length > 0) {
        process.stdout.write(`${chalk.bold('Related')}\n`);
        for (const link of res.related) {
          process.stdout.write(`  ${link.label} ${chalk.dim(`(${link.score.toFixed(2)})`)}\n`);
        }
        process.stdout.write('\n');
      }
    });
  },
};

export default def;
