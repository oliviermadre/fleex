import type { CommandDef } from '../../../core/types.ts';
import { info } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { printJson, renderTable, trunc } from '../../../core/agentic.ts';
import { resolveTicketId } from '../_shared.ts';

interface Mention {
  id: string;
  targetAgent: string;
  sourceAgent: string;
  targetType: string;
  executionMode: string;
  status: string;
  createdAt: string;
}

interface MentionsOptions { board?: string; status?: string; json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'mentions',
  description: 'List the mentions on a ticket (mentions <id> [--status])',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--status <status>', 'Filter by status (pending, acknowledged, waiting_for_info, resolved)');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (idArg: string, opts: MentionsOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    let mentions = await apiGet<Mention[]>(`${apiBase()}/api/tickets/${uuid}/mentions`);
    if (opts.status) {
      mentions = mentions.filter((m) => m.status === opts.status);
    }
    if (opts.json) {
      printJson(mentions);
      return;
    }
    if (mentions.length === 0) {
      info('No mentions found.');
      return;
    }
    mentions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const rows = mentions.map((m) => [
      `@${m.targetType}:${m.targetAgent}`,
      m.status,
      m.executionMode ?? '-',
      trunc(m.sourceAgent ?? '-', 20),
      m.id.slice(0, 8),
    ]);
    renderTable(['TARGET', 'STATUS', 'MODE', 'FROM', 'ID'], rows);
    info(`${mentions.length} mention(s)`);
  },
};

export default def;
