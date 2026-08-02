import { printJson } from '../../../core/agentic.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { info } from '../../../core/colors.ts';
import { parseRepo } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface Options {
  json?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'branches',
  description: 'List the branches of a repository',
  setup(cmd) {
    cmd.argument('<org/name>', 'Repository reference');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (repoArg: string, opts: Options) => {
    const { org, name } = parseRepo(repoArg);
    const branches = await apiGet<string[]>(
      `${apiBase()}/api/repositories/${org}/${name}/branches`,
    );
    if (opts.json) {
      printJson(branches);
      return;
    }
    if (branches.length === 0) {
      info('No branches found (is the repo cloned locally?).');
      return;
    }
    process.stdout.write('\n');
    for (const b of branches) process.stdout.write(`  ${b}\n`);
    process.stdout.write('\n');
    info(`${branches.length} branch(es)`);
  },
};

export default def;
