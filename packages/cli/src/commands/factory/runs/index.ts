import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiGet } from '../../../core/api.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';
import { enc, fx, parseInteger, resolveMachine, since } from '../_shared.ts';

export interface RunRow {
  id: string; ticketId: string; machineId: string; machineName: string; executor: string; status: string; outcome: string | null;
  executionId: string | null; error: string | null; startedAt: string; finishedAt: string | null;
  reply?: string | null; deliverableId?: string | null; item?: { title: string; source: string } | null;
}

const tint = (status: string): string => (status === 'failed' ? c.red(status) : status === 'completed' ? c.green(status) : status === 'question' || status === 'needs_review' ? c.yellow(status) : status);

/** A table of station visits, the latest first as the routes give them. */
export function renderRuns(runs: readonly RunRow[]): void {
  renderTable(['STARTED', 'MACHINE', 'WHAT', 'STATUS', 'OUTCOME', 'ON', 'ERROR'], runs.map((r) => [
    `${since(r.startedAt)} ago`, trunc(r.machineName, 22), r.executor, tint(r.status), r.outcome ?? '-',
    r.item ? trunc(`${r.item.source}: ${r.item.title}`, 30) : r.ticketId.slice(0, 8), r.error ? trunc(r.error.replace(/\s+/g, ' '), 50) : '-',
  ]));
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'runs',
  access: 'read',
  description: 'The latest station runs of the floor, or of one machine — status, outcome, what failed',
  setup(cmd) {
    cmd.option('--machine <machine>', 'Only the runs of this machine (name, id or id prefix)');
    cmd.option('--limit <n>', 'How many runs (1 to 200, default 20)');
  },
  action: async (opts: { machine?: string; limit?: string }) => {
    const limit = opts.limit !== undefined ? parseInteger(opts.limit, '--limit') : 20;
    const machineId = opts.machine !== undefined ? (await resolveMachine(opts.machine)).id : null;
    const runs = await apiGet<RunRow[]>(fx(`/runs?limit=${limit}${machineId ? `&machineId=${enc(machineId)}` : ''}`));
    present(runs, () => {
      if (runs.length === 0) { info('No run yet.'); return; }
      renderRuns(runs);
    });
  },
};

export default def;
