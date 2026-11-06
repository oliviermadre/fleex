import type { CommandDef } from '../../../core/types.ts';
import { c, die, info, present } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { deliverableSummary, type ListedDeliverable } from '../_shared.ts';

interface SearchOptions { q?: string; type?: string; origin?: string; agent?: string; ticket?: string; limit?: string; offset?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'search',
  aliases: ['list', 'ls'],
  description:
    'Find deliverables across every ticket and routine run (transcripts, PRDs, notes…), newest first, by name (deliverable title, ticket title or routine name), type, origin or agent. ' +
    'Prints ids only — read one with `fleex deliverable show <id>`.',
  setup(cmd) {
    cmd.option('--q <text>', 'Text in the deliverable title, its ticket title or its routine name');
    cmd.option('--type <types>', 'Deliverable types, comma-separated (see `fleex deliverable-type list`)');
    cmd.option('--origin <kinds>', 'ticket | routine (comma-separated)');
    cmd.option('--agent <names>', 'Producing agent names, comma-separated');
    cmd.option('--ticket <ref>', 'Only the deliverables of this ticket (display id or UUID)');
    cmd.option('--limit <n>', 'Max results (default 20)');
    cmd.option('--offset <n>', 'Skip this many results (paging)');
  },
  action: async (opts: SearchOptions) => {
    const qs = new URLSearchParams();
    const many = (key: string, v?: string) => v?.split(',').map((s) => s.trim()).filter(Boolean).forEach((x) => qs.append(key, x));
    if (opts.q) qs.set('q', opts.q);
    many('type', opts.type);
    many('origin', opts.origin);
    many('agent_name', opts.agent);
    if (opts.ticket) {
      const { resolveAnyTicketUuid } = await import('../../ticket/_shared.ts');
      qs.set('ticket_id', await resolveAnyTicketUuid(opts.ticket));
    }
    const limit = opts.limit ? Number(opts.limit) : 20;
    if (!Number.isInteger(limit) || limit < 1) die(`Invalid --limit "${opts.limit}".`);
    qs.set('limit', String(limit));
    if (opts.offset) qs.set('offset', opts.offset);
    const res = await apiGet<{ items: ListedDeliverable[]; total: number }>(`${apiBase()}/api/deliverables?${qs}`);
    const items = res.items.map(deliverableSummary);
    present({ ok: true, total: res.total, count: items.length, items }, () => {
      if (items.length === 0) {
        info('No deliverables match.');
        return;
      }
      for (const d of items) {
        const from = d.origin ? `${d.origin.kind}: ${d.origin.label}` : '—';
        process.stdout.write(`${d.id}  ${d.createdAt.slice(0, 10)}  ${c.dim(`[${d.type}]`)} ${c.bold(d.title)}  ${c.dim(from)}\n`);
      }
      if (res.total > items.length) info(`${items.length} of ${res.total} — page with --offset.`);
    });
  },
};

export default def;
