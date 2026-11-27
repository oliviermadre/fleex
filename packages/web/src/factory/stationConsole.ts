/**
 * What the console popup of a station, a gate or a zone decides before drawing: its colour, its lamp, its tabs and
 * their badges, the tab it opens on, where each outcome leaves, the names an outcome can be given, and the bars of
 * its latest runs. No React here: the popup reads these, the tests pin them down.
 */
import { acceptsOutcome, isConditional } from './armRules';
import { humanCall, QUESTION_OUTCOME, RUNS, type ArmSpec, type FactoryRun, type FactoryTicket, type MachineSpec, type StationSpec } from './types';
import { incompleteLine, scriptOf } from './script';

/** A machine's own colour in its popup (`--mc`): the one it was given, else one per kind. */
const KIND_COLOUR: Record<string, string> = {
  agent: '#5a5ad8', skill: '#5a5ad8', panel: '#5a5ad8', script: '#2f8f9d', human_gate: '#c07a12',
  zone: '#1f9a78', intake: '#a252c9', arm: '#c98a1a', teleporter: '#17a3c4', exit: '#2e9d5b', desk: '#c07a12',
};
export function machineColour(m: MachineSpec): string {
  if ((m.kind === 'arm' || m.kind === 'teleporter' || m.kind === 'area' || m.kind === 'label') && m.color) return m.color;
  if (m.kind === 'station') return KIND_COLOUR[m.exec] ?? 'var(--theme-accent)';
  return KIND_COLOUR[m.kind] ?? 'var(--theme-accent)';
}

/** The machines whose popup is the console: the stations that run or decide, and the zones. The others keep theirs (lot B). */
export const isConsole = (m: MachineSpec): boolean => m.kind === 'zone' || (m.kind === 'station' && m.exec !== 'native');

/** A station is unset while it has nothing to run: an agent, a skill or a panel with none chosen, a script with no complete line. */
export function isUnset(m: MachineSpec): boolean {
  if (m.kind !== 'station' || !RUNS.includes(m.exec)) return false;
  if (m.exec === 'script') return !scriptOf(m.script).lines.some((l) => !incompleteLine(l));
  return !m.ref;
}

export type Lamp = 'running' | 'stopped' | 'unset' | 'halted';
/** The lamp of a station that runs (none for anything else). Halted over unset over stopped over running. */
export function lampOf(m: MachineSpec, halted: boolean): Lamp | null {
  if (m.kind !== 'station' || !RUNS.includes(m.exec)) return null;
  if (halted) return 'halted';
  if (isUnset(m)) return 'unset';
  return m.off ? 'stopped' : 'running';
}

export type TabId = 'inside' | 'setup' | 'routing' | 'activity';
export type Family = 'station' | 'gate' | 'zone';
export const familyOf = (m: MachineSpec): Family => (m.kind === 'zone' ? 'zone' : m.kind === 'station' && m.exec === 'human_gate' ? 'gate' : 'station');
export const TABS: Record<Family, TabId[]> = { station: ['inside', 'setup', 'routing', 'activity'], gate: ['inside', 'setup', 'activity'], zone: ['inside', 'setup'] };

/** The arm an outcome leaves through: one that asks for it, else one with no condition. */
export const armFor = (takers: ArmSpec[], outcome: string): ArmSpec | null =>
  takers.find((a) => acceptsOutcome(a, outcome)) ?? takers.find((a) => !isConditional(a)) ?? null;
/** Some outcome no arm takes, or no arm at all: the routing needs a look. */
export const routingGap = (m: StationSpec, takers: ArmSpec[]): boolean => takers.length === 0 || m.outcomes.some((o) => !armFor(takers, o));

/** How many tickets a machine holds wait for a human (a decision, a question, a failed run). */
export const waitingOnYou = (tickets: FactoryTicket[]): number => tickets.filter((t) => humanCall(t) !== null).length;

export type Badges = Partial<Record<TabId, string>>;
export function badgesOf(m: MachineSpec, tickets: FactoryTicket[], takers: ArmSpec[]): Badges {
  const out: Badges = {}, you = waitingOnYou(tickets);
  if (you) out.inside = String(you);
  if (m.kind !== 'station') return out;
  if (isUnset(m)) out.setup = '!';
  if (m.exec === 'human_gate') { if (takers.length === 0) out.setup = '!'; }
  else if (routingGap(m, takers)) out.routing = '!';
  return out;
}

const TAB_KEY = (f: Family) => `factory.popup.tab.${f}`;
export function rememberedTab(f: Family): TabId | null {
  try { const v = window.localStorage.getItem(TAB_KEY(f)); return v && (TABS[f] as string[]).includes(v) ? (v as TabId) : null; } catch { return null; }
}
export function rememberTab(f: Family, tab: TabId): void {
  try { window.localStorage.setItem(TAB_KEY(f), tab); } catch { /* nothing kept: the next popup opens on Setup */ }
}
/** The tab a popup opens on: a ticket waiting on you, else Setup while unset, else the family's last, else Setup. */
export function openingTab(m: MachineSpec, tickets: FactoryTicket[]): TabId {
  if (waitingOnYou(tickets)) return 'inside';
  if (isUnset(m)) return 'setup';
  return rememberedTab(familyOf(m)) ?? 'setup';
}

/** A typed outcome name, as outcomes are written: lower case, dashes, nothing else. */
export const normalizeOutcome = (v: string): string => v.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');

/** The outcomes other stations of the floor use and this one does not: most used first, then by name; filtered by what is typed. */
export function outcomeSuggestions(m: StationSpec, machines: MachineSpec[], typed: string): { name: string; stations: number }[] {
  const count = new Map<string, number>();
  for (const q of machines) {
    if (q.id === m.id || q.kind !== 'station') continue;
    for (const o of new Set(q.outcomes)) if (o !== QUESTION_OUTCOME && !m.outcomes.includes(o)) count.set(o, (count.get(o) ?? 0) + 1);
  }
  const needle = normalizeOutcome(typed);
  return [...count].filter(([o]) => !needle || o.includes(needle)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, stations]) => ({ name, stations }));
}

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** The run histogram: bars over the period (by hour over a day, by day up to a month, by week beyond), from the runs loaded. */
export function runBars(runs: FactoryRun[], days: number, now: string, loadedMax = 60): { bars: number[]; truncated: boolean } {
  const end = Date.parse(now), step = days <= 1 ? HOUR : days <= 30 ? DAY : 7 * DAY;
  let start = end - days * DAY;
  const times = runs.map((r) => Date.parse(r.startedAt)).filter((t) => Number.isFinite(t));
  /* the latest runs only: when as many as are loaded, the oldest may still be inside the period, and what came before is not known */
  const truncated = runs.length >= loadedMax && times.length > 0 && Math.min(...times) > start;
  if (truncated) start = Math.min(...times);
  const n = Math.max(1, Math.ceil((end - start) / step)), bars = new Array<number>(n).fill(0);
  for (const t of times) if (t >= start && t <= end) bars[Math.min(n - 1, Math.floor((t - start) / step))]! += 1;
  return { bars, truncated };
}
