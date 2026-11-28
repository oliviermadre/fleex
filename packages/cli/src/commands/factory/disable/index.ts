import type { CommandDef } from '../../../core/types.ts';
import { die, ok, present } from '../../../core/colors.ts';
import { apiBase, apiGet, apiPut } from '../../../core/api.ts';
import { fx } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'disable',
  access: 'write',
  description: 'Switch the Factory off for this workspace: its machines stop; what they already wrote on tickets stays',
  action: async () => {
    const flag = await apiGet<{ supported: boolean }>(fx('/status'));
    if (!flag.supported) die('The Factory is not available on this storage driver (SQLite and Supabase only).');
    // The switch is the workspace's `factoryEnabled` setting, the one Settings › General flips.
    await apiPut(`${apiBase()}/api/config`, { factoryEnabled: false });
    const after = await apiGet<{ supported: boolean; enabled: boolean }>(fx('/status'));
    present(after, () => ok(after.enabled ? 'The Factory is on.' : 'The Factory is off.'));
  },
};

export default def;
