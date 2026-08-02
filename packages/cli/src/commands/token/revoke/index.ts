import { apiBase, apiDelete } from '../../../core/api.ts';
import { ok, warn, info, die, c } from '../../../core/colors.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { resolveToken } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface RevokeOptions {
  force?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'revoke',
  aliases: ['rm', 'delete'],
  description: 'Revoke an agent API token (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<id>', 'Token UUID, 8-char prefix, or name');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (idArg: string, opts: RevokeOptions) => {
    const token = await resolveToken(idArg);

    if (!opts.force) {
      // Revoking immediately breaks any integration still using this token.
      if (!canPrompt()) {
        die(
          `Refusing to revoke token "${token.name}" without confirmation. Re-run with -f to force.`,
        );
      }
      warn(
        `Revoking token "${token.name}" immediately breaks anything still authenticating with it.`,
      );
      const confirmed = await promptYesNo(`Revoke token "${token.name}"?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${apiBase()}/api/agent-tokens/${token.id}`);
    ok(`Revoked token ${c.bold(token.name)}`);
  },
};

export default def;
