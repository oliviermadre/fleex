import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import type { Token } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List agent API tokens (prefix only — the secret is never stored)',
  action: async () => {
    const tokens = await apiGet<Token[]>(`${apiBase()}/api/agent-tokens`);
    present(tokens, () => {
      if (tokens.length === 0) {
        info('No agent tokens. Create one with `fleex token create --name <name>`.');
        return;
      }
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('ID         NAME                      PREFIX        LAST USED')}\n`);
      process.stdout.write('  ──────────  ────────────────────────  ────────────  ────────────────────\n');
      for (const t of tokens) {
        const id = t.id.slice(0, 8).padEnd(10);
        const name = (t.name ?? '-').slice(0, 24).padEnd(24);
        const prefix = (t.prefix ?? '-').padEnd(12);
        const used = t.lastUsedAt ?? c.dim('never');
        process.stdout.write(`  ${id} ${name} ${prefix} ${used}\n`);
      }
      process.stdout.write('\n');
      info(`${tokens.length} token(s)`);
    });
  },
};

export default def;
