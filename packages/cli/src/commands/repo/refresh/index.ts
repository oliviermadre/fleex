import { apiBase, apiPost } from '../../../core/api.ts';
import { die, ok } from '../../../core/colors.ts';
import { parseRepo } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface Options {
  all?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'refresh',
  description: 'Trigger a background refresh of GitHub data (one repo or --all)',
  setup(cmd) {
    cmd.argument('[org/name]', 'Repository reference to refresh');
    cmd.option('--all', 'Refresh all configured repositories');
  },
  action: async (positional: string | undefined, opts: Options) => {
    const base = apiBase();
    if (opts.all) {
      await apiPost(`${base}/api/repositories/refresh`, { scope: 'all' });
      ok('Refreshing all repositories in the background.');
      return;
    }
    if (!positional) {
      die('Specify a repository (org/name) or pass --all.');
    }
    const { org, name, slug } = parseRepo(positional);
    await apiPost(`${base}/api/repositories/refresh`, { scope: 'repo', org, name });
    ok(`Refreshing ${slug} in the background.`);
  },
};

export default def;
