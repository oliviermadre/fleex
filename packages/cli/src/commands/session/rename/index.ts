import type { CommandDef } from '../../../core/types.ts';
import { ok, die, present } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { resolveSession, type Session } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'rename',
  description: 'Rename a session (rename <id> <new name>)',
  setup(cmd) {
    cmd.argument('<id>', 'Session UUID, 8-char prefix, or display name');
    cmd.argument('<name>', 'New display name');
  },
  action: async (idArg: string, name: string) => {
    const displayName = name?.trim();
    if (!displayName) die('New session name cannot be empty.');
    const session = await resolveSession(idArg);
    const updated = await apiPatch<Session>(
      `${apiBase()}/api/sessions/${session.id}/rename`,
      { displayName },
    );
    present(updated ?? { ...session, displayName }, () => ok(`Renamed session ${session.id.slice(0, 8)} to "${displayName}"`));
  },
};

export default def;
