import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiGet } from '../../../core/api.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';
import { ago, enc, fx, parseInteger, resolveMachine, since } from '../_shared.ts';

interface ExitLog {
  machineId: string | null; days: number; since: string;
  exits: { machineId: string; name: string; onFloor: boolean }[];
  tickets: { machineId: string; ticketId: string; displayId: number | null; title: string; status: string | null; handedAt: string; shippedAt: string; outcome: 'shipped' | 'cancelled' }[];
  items: { machineId: string; itemId: string; source: string; title: string; author: string; handedAt: string; shippedAt: string }[];
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'exits',
  access: 'read',
  description: 'What left the floor by its exits over the last days — tickets shipped (with lead time) and items archived there; one exit, or all',
  setup(cmd) {
    cmd.argument('[exit]', 'Only this exit (name, id or id prefix); every exit when omitted');
    cmd.option('--days <n>', 'How many days back (1 to 90, default 7)');
  },
  action: async (exitArg: string | undefined, opts: { days?: string }) => {
    const days = opts.days !== undefined ? parseInteger(opts.days, '--days') : 7;
    const exit = exitArg ? await resolveMachine(exitArg, ['exit']) : null;
    const log = await apiGet<ExitLog>(fx(`/exits/${exit ? `${enc(exit.id)}/` : ''}log?days=${days}`));
    present(log, () => {
      const name = new Map(log.exits.map((e) => [e.machineId, e.name]));
      const rows = [
        ...log.tickets.map((t) => ({ at: t.shippedAt, row: [t.displayId != null ? `#${t.displayId}` : t.ticketId.slice(0, 8), trunc(t.title, 44), name.get(t.machineId) ?? 'Exit', t.outcome === 'cancelled' ? c.red('cancelled') : c.green('shipped'), ago(Date.parse(t.shippedAt) - Date.parse(t.handedAt)), `${since(t.shippedAt)} ago`, t.status ?? '-'] })),
        ...log.items.map((i) => ({ at: i.shippedAt, row: [i.itemId.slice(0, 8), trunc(i.title, 44), name.get(i.machineId) ?? 'Exit', c.dim(`archived (${i.source})`), ago(Date.parse(i.shippedAt) - Date.parse(i.handedAt)), `${since(i.shippedAt)} ago`, '-'] })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      if (rows.length === 0) { info(`Nothing left by ${exit ? exit.name : 'an exit'} in the last ${log.days} day(s).`); return; }
      renderTable(['REF', 'TITLE', 'EXIT', 'LEFT AS', 'LEAD TIME', 'LEFT', 'NOW'], rows.map((r) => r.row));
      info(`${log.tickets.length} ticket(s), ${log.items.length} item(s) over ${log.days} day(s)`);
    });
  },
};

export default def;
