import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiGet } from '../../../core/api.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';
import { ago, fx, parseInteger } from '../_shared.ts';

interface MachineStats {
  machineId: string; name: string; executor: string; onFloor: boolean; runs: number; completed: number; failed: number; questions: number;
  avgRunMs: number | null; avgHumanMs: number | null; humanWaits: number; humanMs: number; costUsd: number; outcomes: Record<string, number>;
}
interface Stats {
  since: string; until: string; days: number; machines: MachineStats[];
  totals: { runs: number; failed: number; questions: number; costUsd: number; shipped: number; avgLeadMs: number | null; humanMs: number };
  exits: Record<string, number>;
}

const dur = (ms: number | null): string => (ms == null ? '-' : ago(ms));

const def: CommandDef = {
  workspaceAware: true,
  name: 'stats',
  access: 'read',
  description: 'What the floor did over the last days, machine by machine — runs, failures, questions, run time, time waiting for a human, cost',
  setup(cmd) {
    cmd.option('--days <n>', 'How many days back (1 to 90, default 7)');
  },
  action: async (opts: { days?: string }) => {
    const days = opts.days !== undefined ? parseInteger(opts.days, '--days') : 7;
    const s = await apiGet<Stats>(fx(`/stats?days=${days}`));
    present(s, () => {
      const t = s.totals;
      process.stdout.write(`${c.bold(`Last ${s.days} day(s)`)}  ${t.runs} run(s), ${t.failed} failed, ${t.questions} question(s) · ${t.shipped} shipped`
        + `${t.avgLeadMs != null ? ` (lead time ${ago(t.avgLeadMs)})` : ''} · $${t.costUsd.toFixed(2)} · ${ago(t.humanMs)} waiting for a human\n`);
      const rows = s.machines.filter((m) => m.executor !== 'exit');
      if (rows.length === 0) { info('No station ran in that period.'); return; }
      renderTable(['MACHINE', 'RUNS', 'FAILED', 'ASKED', 'AVG RUN', 'HUMAN WAIT', 'COST', 'OUTCOMES'], rows.map((m) => [
        `${trunc(m.name, 26)}${m.onFloor ? '' : c.dim(' (removed)')}`, String(m.runs), m.failed ? c.red(String(m.failed)) : '0', String(m.questions),
        dur(m.avgRunMs), m.humanWaits ? `${dur(m.avgHumanMs)} ×${m.humanWaits}` : '-', `$${m.costUsd.toFixed(2)}`,
        Object.entries(m.outcomes).map(([o, n]) => `${o} ${n}`).join(', ') || '-',
      ]));
    });
  },
};

export default def;
