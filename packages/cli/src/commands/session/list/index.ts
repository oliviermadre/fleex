import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import type { Session } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List live tmux sessions',
  action: async () => {
    const sessions = await apiGet<Session[]>(`${apiBase()}/api/sessions`);
    present(sessions, () => {
      if (sessions.length === 0) {
        info('No sessions found.');
        return;
      }
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('ID         TYPE    STATUS   NAME                      CWD')}\n`);
      process.stdout.write('  ──────────  ──────  ───────  ────────────────────────  ──────────────────\n');
      for (const s of sessions) {
        const id = s.id.slice(0, 8).padEnd(10);
        const type = (s.type ?? '-').padEnd(6);
        const status = (s.status ?? '-').padEnd(7);
        const name = (s.displayName ?? '-').slice(0, 24).padEnd(24);
        process.stdout.write(`  ${id} ${type} ${status} ${name} ${s.cwd ?? '-'}\n`);
      }
      process.stdout.write('\n');
      info(`${sessions.length} session(s)`);
    });
  },
};

export default def;
