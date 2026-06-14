import type { CommandDef } from '../../../core/types.ts';
import { info, ok, warn } from '../../../core/colors.ts';
import { getConfig, parseRepo, putConfig } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'register',
  aliases: ['add'],
  description: 'Register a repository in the workspace config (the server clones it)',
  setup(cmd) {
    cmd.argument('<org/name>', 'Repository reference to register');
  },
  action: async (repoArg: string) => {
    const { slug } = parseRepo(repoArg);
    const config = await getConfig();
    const repos = Array.isArray(config.repositories) ? [...config.repositories] : [];

    if (repos.includes(slug)) {
      warn(`${slug} is already registered.`);
      return;
    }
    repos.push(slug);
    await putConfig({ repositories: repos });
    ok(`Registered ${slug} in the workspace config.`);
    info('The server is resolving & cloning it in the background.');
  },
};

export default def;
