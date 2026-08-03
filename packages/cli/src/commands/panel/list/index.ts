import {
  fetchPanels,
  handle,
  panelHandleName,
  printJson,
  renderTable,
  trunc,
} from '../../../core/agentic.ts';
import { info } from '../../../core/colors.ts';

import type { CommandDef } from '../../../core/types.ts';

interface ListOptions {
  json?: boolean;
  enabled?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List panels with their @panel: handle and description',
  setup(cmd) {
    cmd.option('--enabled', 'Only show enabled panels');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: ListOptions) => {
    const panels = await fetchPanels(Boolean(opts.enabled));
    if (opts.json) {
      printJson(panels);
      return;
    }
    if (panels.length === 0) {
      info('No panels found.');
      return;
    }
    panels.sort((a, b) => panelHandleName(a).localeCompare(panelHandleName(b)));
    const rows = panels.map((p) => [
      handle('panel', panelHandleName(p)),
      trunc(p.displayName ?? p.name ?? '', 24),
      trunc(p.description ?? '', 40),
      String(p.members?.length ?? 0),
      p.enabled ? 'yes' : 'no',
    ]);
    renderTable(['HANDLE', 'NAME', 'DESCRIPTION', 'MEMBERS', 'ENABLED'], rows);
    info(`${panels.length} panel(s)`);
  },
};

export default def;
