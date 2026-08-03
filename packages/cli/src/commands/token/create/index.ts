import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, warn, die, present, c } from '../../../core/colors.ts';

import type { CommandDef } from '../../../core/types.ts';
import type { Token } from '../_shared.ts';

interface CreateOptions {
  name?: string;
}
interface CreatedToken extends Token {
  secret: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  aliases: ['new'],
  description: 'Create an agent API token (the secret is shown only once)',
  setup(cmd) {
    cmd.requiredOption('--name <name>', 'Human-friendly token name (e.g. ci-bot)');
  },
  action: async (opts: CreateOptions) => {
    const name = opts.name?.trim();
    if (!name) die('Token name cannot be empty.');
    const token = await apiPost<CreatedToken>(`${apiBase()}/api/agent-tokens`, { name });
    present(token, () => {
      ok(`Created token ${c.bold(token.name)} (${token.id.slice(0, 8)})`);
      // The secret is returned exactly once by the API and never stored in clear.
      process.stdout.write(`\n  ${c.bold('Secret (copy it now — it will not be shown again):')}\n`);
      process.stdout.write(`  ${c.green(token.secret)}\n\n`);
      warn('Store this secret securely. If you lose it, revoke the token and create a new one.');
    });
  },
};

export default def;
