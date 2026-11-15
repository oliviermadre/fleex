/**
 * Reading the floor: where tickets stand right now, and what each machine cost
 * or took over a period. Pure functions over the snapshot and the stats, so the
 * renderer only has to paint what it is given.
 */
import { money, since, span } from './format';
import type { FactoryLayout, FactoryStats, FactoryTicket, Lens, MachineSpec } from './types';

/** A machine where tickets stand, and for how long. */
export interface Standing {
  machineId: string;
  name: string;
  count: number;
  /** How long the oldest ticket has been here. */
  oldestMs: number;
  /** Ticket-time accumulated here: the sum of every ticket's wait. What bottlenecks are ranked by. */
  totalMs: number;
  /** In plain words, what most of them wait for. */
  why: string;
  /** True when what they wait for is a human. */
  human: boolean;
}

const nameOf = (m: MachineSpec): string => m.name || (m.kind === 'station' ? (m.exec === 'human_gate' ? 'Gate' : 'Station') : 'Zone');

function reason(m: MachineSpec, inside: FactoryTicket[]): { why: string; human: boolean } {
  const n = (f: (t: FactoryTicket) => boolean) => inside.filter(f).length;
  if (m.kind === 'zone') {
    const held = n((t) => !t.released);
    return held >= inside.length - held ? { why: m.release === 'auto' ? 'waiting for their turn' : 'waiting to be released', human: m.release !== 'auto' } : { why: 'released, but no arm takes them', human: false };
  }
  const counts: [number, string, boolean][] = [
    [n((t) => t.phase === 'review'), 'waiting for your decision', true],
    [n((t) => t.phase === 'question'), 'the agent asked a question', true],
    [n((t) => t.phase === 'failed'), 'the run failed', true],
    [n((t) => t.phase === 'wait'), 'queueing to run', false],
    [n((t) => t.phase === 'out'), 'done, but nothing takes them out', false],
    [n((t) => t.phase === 'running'), 'running', false],
  ];
  const top = counts.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { why: top[1], human: top[2] };
}

/**
 * Stations and zones that hold tickets, the worst first. The Inbound zone is
 * left out: tickets waiting to be started are a backlog, not a jam.
 */
export function standing(layout: FactoryLayout, tickets: FactoryTicket[], now: string): Standing[] {
  const inside = new Map<string, FactoryTicket[]>();
  for (const t of tickets) if (t.machineId) { const a = inside.get(t.machineId); if (a) a.push(t); else inside.set(t.machineId, [t]); }
  const out: Standing[] = [];
  for (const m of layout.machines) {
    if (m.kind !== 'station' && m.kind !== 'zone') continue;
    if (m.kind === 'zone' && m.inbound) continue;
    const here = inside.get(m.id);
    if (!here?.length) continue;
    const waits = here.map((t) => since(t.since, now));
    out.push({ machineId: m.id, name: nameOf(m), count: here.length, oldestMs: Math.max(...waits), totalMs: waits.reduce((a, b) => a + b, 0), ...reason(m, here) });
  }
  return out.sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);
}

/** What a lens paints: a value and a caption per machine, and the scale they are read against. */
export interface LensLayer {
  kind: Exclude<Lens, 'none'>;
  values: Map<string, number>;
  text: Map<string, string>;
  max: number;
  /** One line saying what is shown, for the legend. */
  legend: string;
}

export const LENS_LABEL: Record<Exclude<Lens, 'none'>, string> = { cost: 'Cost', time: 'Run time', human: 'Human wait', load: 'Standing now' };

export function lensLayer(kind: Lens, layout: FactoryLayout, tickets: FactoryTicket[], stats: FactoryStats | null, now: string): LensLayer | null {
  if (kind === 'none') return null;
  const values = new Map<string, number>(), text = new Map<string, string>();
  let legend: string;
  if (kind === 'load') {
    const rows = standing(layout, tickets, now);
    for (const r of rows) { values.set(r.machineId, r.totalMs); text.set(r.machineId, `${r.count} · ${span(r.oldestMs)}`); }
    legend = rows.length ? 'Tickets standing in each machine, and how long the oldest has been there' : 'Nothing stands anywhere right now';
  } else {
    const period = stats ? `last ${stats.days === 1 ? '24 hours' : `${stats.days} days`}` : 'loading…';
    for (const m of stats?.machines ?? []) {
      if (!m.onFloor) continue;
      if (kind === 'cost' && m.costUsd > 0) { values.set(m.machineId, m.costUsd); text.set(m.machineId, money(m.costUsd)); }
      if (kind === 'time' && m.avgRunMs) { values.set(m.machineId, m.avgRunMs); text.set(m.machineId, span(m.avgRunMs)); }
      if (kind === 'human' && m.humanMs > 0) { values.set(m.machineId, m.humanMs); text.set(m.machineId, m.humanWaits > 1 ? `${span(m.humanMs)} · ${m.humanWaits}×` : span(m.humanMs)); }
    }
    legend = kind === 'cost' ? `What each station spent on agent runs, ${period}${stats ? ` · ${money(stats.totals.costUsd)} in all` : ''}`
      : kind === 'time' ? `How long a run takes in each station on average, ${period}`
      : `Time tickets spent waiting for a human in each machine, ${period}${stats ? ` · ${span(stats.totals.humanMs)} in all` : ''}`;
  }
  let max = 0;
  for (const v of values.values()) if (v > max) max = v;
  return { kind, values, text, max, legend };
}
