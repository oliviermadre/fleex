import {
  fetchPersonas,
  fetchPersonaStatuses,
  handle,
  personaHandleName,
  printJson,
  renderTable,
} from '../../../core/agentic.ts';
import { info } from '../../../core/colors.ts';

import type { CommandDef } from '../../../core/types.ts';

interface ListOptions {
  json?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List agents with their @agent: handle, model and live status',
  setup(cmd) {
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: ListOptions) => {
    const personas = await fetchPersonas();
    if (opts.json) {
      printJson(personas);
      return;
    }
    if (personas.length === 0) {
      info('No agents found.');
      return;
    }
    // Status is best-effort: don't fail the listing if it's unavailable.
    const statuses = await fetchPersonaStatuses().catch(
      () => ({}) as Record<string, { running: boolean; pendingMentionCount: number }>,
    );
    personas.sort((a, b) => a.name.localeCompare(b.name));

    const rows = personas.map((p) => {
      const st = statuses[p.id];
      return [
        handle('agent', personaHandleName(p)),
        p.displayName ?? p.name,
        p.model ?? '-',
        p.executionMode ?? '-',
        st?.running ? 'yes' : 'no',
        String(st?.pendingMentionCount ?? 0),
      ];
    });
    renderTable(['HANDLE', 'DISPLAY', 'MODEL', 'MODE', 'RUNNING', 'PENDING'], rows);
    info(`${personas.length} agent(s)`);
  },
};

export default def;
