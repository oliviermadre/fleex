import type { CommandDef } from '../../../../core/types.ts';
import { present } from '../../../../core/colors.ts';
import { apiGet } from '../../../../core/api.ts';
import { fetchBoards } from '../../../board/_shared.ts';
import { fx } from '../../_shared.ts';

interface Layout { version?: number; w: number; h: number; machines: unknown[] }

const def: CommandDef = {
  workspaceAware: true,
  name: 'export',
  access: 'read',
  description: 'Print the floor — every machine and its settings, no ticket or run — in the format the page\'s Export and Import use; redirect it to keep it',
  action: async () => {
    const { layout } = await apiGet<{ layout: Layout }>(fx('/layout'));
    // The page's floor file (`floorFile.ts`): it names the boards by id so that its Import can match them by name.
    const boards = Object.fromEntries((await fetchBoards()).map((b) => [b.id, b.name]));
    const file = { fleexFloor: 1, layoutVersion: layout.version ?? 1, exportedAt: new Date().toISOString(), boards, layout: { w: layout.w, h: layout.h, machines: layout.machines } };
    // No `--file`: this command is also a tool an agent calls, and it writes nowhere on the host. A shell redirects.
    present(file, () => process.stdout.write(JSON.stringify(file, null, 2) + '\n'));
  },
};

export default def;
