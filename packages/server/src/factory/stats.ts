import type { FactoryLayout, FactoryRunRow, RunExecutor } from './types.js';

/** What the stats need from an agent execution: enough to price a station run. */
export interface ExecutionCost { id: string; ticketId: string | null; startedAt: string; costUsd: number | null }

export interface MachineStats {
  machineId: string;
  name: string;
  executor: RunExecutor;
  /** False when the machine has been removed from the floor since it ran. */
  onFloor: boolean;
  /** Visits: one per ticket that entered and started a run (or reached the gate). */
  runs: number;
  completed: number;
  failed: number;
  /** Runs where the agent asked a question instead of answering. */
  questions: number;
  /** Mean wall time of a finished agent, skill or panel run. Null when none finished. */
  avgRunMs: number | null;
  /** Mean time a human took here: to decide at a gate, or to answer a question. Null when it never happened. */
  avgHumanMs: number | null;
  /** How many times a human was waited for here. */
  humanWaits: number;
  /** Total time tickets spent here waiting for a human. */
  humanMs: number;
  costUsd: number;
  /** How many tickets left by each outcome. */
  outcomes: Record<string, number>;
}

export interface FactoryStats {
  since: string;
  until: string;
  days: number;
  machines: MachineStats[];
  totals: {
    runs: number; failed: number; questions: number; costUsd: number;
    /** Tickets that reached an exit. */
    shipped: number;
    /** Mean time from hand-over to exit. Null when nothing shipped. */
    avgLeadMs: number | null;
    humanMs: number;
  };
  /** How many left by each exit, by machine id (the tickets it shipped and the items archived there): what an exit shows on the floor. */
  exits: Record<string, number>;
}

const ms = (a: string, b: string): number => Math.max(0, new Date(b).getTime() - new Date(a).getTime());

/**
 * What happened on the floor over a period, machine by machine, from the run
 * rows alone (plus what each agent execution cost). Pure: the same rows always
 * give the same numbers.
 *
 * - A gate's human time is how long the ticket waited for its decision.
 * - A question's human time runs from the moment the agent asked to the next
 *   run of that ticket (the answer and "run again"), or to `until` when it is
 *   still unanswered.
 * - A run costs what its execution cost. A panel starts one execution per
 *   persona and only its synthesis is linked to the run, so a panel run also
 *   takes the ticket's other executions started while it ran.
 */
export function computeStats(input: { runs: FactoryRunRow[]; executions: ExecutionCost[]; layout: FactoryLayout; since: string; until: string; days: number; /** Items archived at an exit over the period. */ exitItems?: { machineId: string | null }[] }): FactoryStats {
  const { runs, executions, layout, since, until, days } = input;
  const onFloor = new Map(layout.machines.map((m) => [m.id, m]));
  const execById = new Map(executions.map((e) => [e.id, e]));
  const execByTicket = new Map<string, ExecutionCost[]>();
  for (const e of executions) if (e.ticketId) { const a = execByTicket.get(e.ticketId); if (a) a.push(e); else execByTicket.set(e.ticketId, [e]); }
  const byTicket = new Map<string, FactoryRunRow[]>();
  for (const r of runs) { const a = byTicket.get(r.ticketId); if (a) a.push(r); else byTicket.set(r.ticketId, [r]); }
  for (const a of byTicket.values()) a.sort((p, q) => p.startedAt.localeCompare(q.startedAt));

  const machines = new Map<string, MachineStats & { runMs: number; finished: number }>();
  const totals = { runs: 0, failed: 0, questions: 0, costUsd: 0, shipped: 0, avgLeadMs: null as number | null, humanMs: 0 };
  let leadMs = 0;
  const priced = new Set<string>();
  const price = (id: string): number => {
    if (priced.has(id)) return 0;
    priced.add(id);
    return execById.get(id)?.costUsd ?? 0;
  };

  const exits: Record<string, number> = {};
  for (const i of input.exitItems ?? []) if (i.machineId) exits[i.machineId] = (exits[i.machineId] ?? 0) + 1;
  for (const r of runs) {
    if (r.executor === 'exit') { totals.shipped++; exits[r.machineId] = (exits[r.machineId] ?? 0) + 1; if (r.finishedAt) leadMs += ms(r.startedAt, r.finishedAt); continue; }
    let m = machines.get(r.machineId);
    if (!m) {
      const spec = onFloor.get(r.machineId);
      m = { machineId: r.machineId, name: spec?.name || r.machineName, executor: r.executor, onFloor: !!spec, runs: 0, completed: 0, failed: 0, questions: 0, avgRunMs: null, avgHumanMs: null, humanWaits: 0, humanMs: 0, costUsd: 0, outcomes: {}, runMs: 0, finished: 0 };
      machines.set(r.machineId, m);
    }
    m.runs++; totals.runs++;
    if (r.status === 'completed') m.completed++;
    if (r.status === 'failed' || r.status === 'interrupted') { m.failed++; totals.failed++; }
    if (r.status === 'question') { m.questions++; totals.questions++; }
    if (r.outcome) m.outcomes[r.outcome] = (m.outcomes[r.outcome] ?? 0) + 1;

    if (r.executor === 'human_gate') {
      m.humanWaits++; m.humanMs += ms(r.startedAt, r.finishedAt ?? until);
      continue;
    }
    if (r.finishedAt && r.status !== 'interrupted') { m.runMs += ms(r.startedAt, r.finishedAt); m.finished++; }
    if (r.status === 'question' && r.finishedAt) {
      const next = byTicket.get(r.ticketId)?.find((o) => o.id !== r.id && o.startedAt >= r.finishedAt!);
      m.humanWaits++; m.humanMs += ms(r.finishedAt, next?.startedAt ?? until);
    }
    if (r.executionId) m.costUsd += price(r.executionId);
    if (r.executor === 'panel') {
      const end = r.finishedAt ?? until;
      for (const e of execByTicket.get(r.ticketId) ?? []) if (e.startedAt >= r.startedAt && e.startedAt <= end) m.costUsd += price(e.id);
    }
  }

  const out: MachineStats[] = [];
  for (const { runMs, finished, ...m } of machines.values()) {
    m.avgRunMs = finished ? Math.round(runMs / finished) : null;
    m.avgHumanMs = m.humanWaits ? Math.round(m.humanMs / m.humanWaits) : null;
    m.costUsd = Math.round(m.costUsd * 10_000) / 10_000;
    totals.costUsd += m.costUsd; totals.humanMs += m.humanMs;
    out.push(m);
  }
  totals.costUsd = Math.round(totals.costUsd * 10_000) / 10_000;
  totals.avgLeadMs = totals.shipped ? Math.round(leadMs / totals.shipped) : null;
  out.sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);
  return { since, until, days, machines: out, totals, exits };
}
