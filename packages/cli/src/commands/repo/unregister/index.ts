import readline from 'node:readline/promises';
import type { CommandDef } from '../../../core/types.ts';
import { c, info, ok, warn } from '../../../core/colors.ts';
import { getConfig, parseRepo, putConfig } from '../_shared.ts';

interface Options { force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'unregister',
  aliases: ['rm'],
  description: 'Unregister a repository from the workspace config (deletes its local clone)',
  setup(cmd) {
    cmd.argument('<org/name>', 'Repository reference to unregister');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (repoArg: string, opts: Options) => {
    const { slug } = parseRepo(repoArg);
    const config = await getConfig();
    const repos = Array.isArray(config.repositories) ? [...config.repositories] : [];

    if (!repos.includes(slug)) {
      warn(`${slug} is not registered.`);
      return;
    }

    if (!opts.force) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(
        `${c.yellow('[fleex]')} Unregister ${slug} and delete its local clone? [y/N] `,
      );
      rl.close();
      if (!/^[yY]/.test(ans.trim())) {
        info('Cancelled.');
        return;
      }
    }

    const next = repos.filter((r) => r !== slug);
    await putConfig({ repositories: next });
    ok(`Unregistered ${slug}. The server is removing its local clone.`);
  },
};

export default def;
