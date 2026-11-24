/**
 * A floor as a file: what Export writes and Import reads (picked on `docs/factory/floor-import.html`).
 *
 * The file holds the machines and their settings, nothing that happened on them (tickets, items, runs, an intake's last
 * pull). What a machine names on its instance is read back by name: a persona, a skill (its command), a panel, a
 * model, a board (the file carries the name of each board it uses, since a board's id is the instance's own). What
 * this instance does not have is taken off the machine, never the machine itself, and said in the report.
 */
import { copyOf, newId } from './layoutOps';
import { relink } from './teleport';
import type { ArmCondition, FactoryLayout, MachineSpec } from './types';

export const FLOOR_FILE = 1;
export interface FloorFile {
  fleexFloor: number;
  layoutVersion: number;
  exportedAt: string;
  /** The boards the machines name, by id: the name is what is matched on import. */
  boards: Record<string, string>;
  layout: { w: number; h: number; machines: MachineSpec[] };
}
interface Board { id: string; name: string }

/** The boards a machine names: a desk's, those an arm or a toll tests, those a gantry sets. */
function boardsOf(m: MachineSpec): string[] {
  const conds = (c: ArmCondition[] | undefined) => (c ?? []).filter((q) => q.field === 'board').flatMap((q) => q.values);
  if (m.kind === 'desk') return m.defaults?.boardId ? [m.defaults.boardId] : [];
  if (m.kind === 'arm') return conds(m.when);
  if (m.kind === 'belt') return [...conds(m.toll?.when), ...(m.set ?? []).filter((o) => o.field === 'board').map((o) => o.value)];
  return [];
}

/** The floor, or only the machines selected (then placed from the top-left corner of what is selected). */
export function exportFloor(layout: FactoryLayout, boards: readonly Board[], selected: ReadonlySet<string> | null, now = new Date()): FloorFile {
  const clip = selected?.size ? copyOf(layout, selected) : null;
  const machines = clip ? clip.machines : layout.machines.map((m) => structuredClone(m));
  const names = new Map(boards.map((b) => [b.id, b.name])), used: Record<string, string> = {};
  for (const m of machines) for (const id of boardsOf(m)) if (names.has(id)) used[id] = names.get(id)!;
  return { fleexFloor: FLOOR_FILE, layoutVersion: layout.version ?? 1, exportedAt: now.toISOString(), boards: used, layout: { w: clip?.w ?? layout.w, h: clip?.h ?? layout.h, machines } };
}

export const floorFileName = (now = new Date()): string => `fleex-floor-${now.toISOString().slice(0, 10)}.json`;

/** What this instance has, by name. `models` null: the list is not known for sure, and a model is kept. */
export interface Known { personas: readonly string[]; skills: readonly string[]; panels: readonly string[]; models: readonly string[] | null; boards: readonly Board[] }
/** One thing taken off a machine on import. `nothing`: an arm or a toll whose condition was left with no board, which now takes nothing. */
export interface Dropped { machineId: string; name: string; what: string; nothing?: boolean }
export type ReadFloor = { ok: true; machines: MachineSpec[]; w: number; h: number; dropped: Dropped[] } | { ok: false; error: string };

const label = (m: MachineSpec): string => ('name' in m && m.name) || (m.kind === 'station' ? `${m.exec === 'agent' ? 'Agent' : m.exec === 'skill' ? 'Skill' : m.exec === 'panel' ? 'Panel' : 'A'} station` : m.kind === 'arm' ? 'An arm' : m.kind === 'belt' ? 'A gantry' : m.kind === 'desk' ? 'A desk' : m.kind);

/**
 * Read a file: refused when it is not a floor, or one this Fleex cannot read (a newer layout, or one too old to carry
 * over). The machines come back with new ids (teleporters still paired), at the positions of the file.
 */
export function readFloor(text: string, layoutVersion: number, known: Known): ReadFloor {
  let file: Partial<FloorFile>;
  try { file = JSON.parse(text) as Partial<FloorFile>; } catch { return { ok: false, error: 'This file is not JSON' }; }
  if (!file || typeof file !== 'object' || typeof file.fleexFloor !== 'number' || !Array.isArray(file.layout?.machines)) return { ok: false, error: 'This file is not a Fleex floor' };
  if (file.fleexFloor > FLOOR_FILE || (file.layoutVersion ?? 1) > layoutVersion) return { ok: false, error: 'This floor comes from a newer Fleex: update this one to import it' };
  if ((file.layoutVersion ?? 1) < layoutVersion) return { ok: false, error: `This floor was saved with machines of another size (layout v${file.layoutVersion ?? 1}, this Fleex reads v${layoutVersion}): it cannot be carried over` };
  const fileBoards = file.boards ?? {}, dropped: Dropped[] = [];
  const byName = new Map(known.boards.map((b) => [b.name.trim().toLowerCase(), b.id])), ids = new Set(known.boards.map((b) => b.id));
  /* a board of the file, as this instance knows it: by name, or by id when the file was made here; null when it has none */
  const board = (id: string): string | null => byName.get((fileBoards[id] ?? '').trim().toLowerCase()) ?? (ids.has(id) ? id : null);
  const boardName = (id: string) => `board "${fileBoards[id] ?? id}"`;

  const machines = file.layout.machines.filter((m) => m && typeof m === 'object' && typeof m.kind === 'string').map((raw) => {
    const m = structuredClone(raw) as MachineSpec, off = (what: string, nothing?: boolean) => dropped.push({ machineId: m.id, name: label(m), what, ...(nothing ? { nothing } : {}) });
    const conds = (when: ArmCondition[] | undefined): ArmCondition[] | undefined => when?.map((c) => {
      if (c.field !== 'board') return c;
      const values = c.values.map((v) => { const b = board(v); if (!b) off(boardName(v)); return b; }).filter((v): v is string => !!v);
      /* left with no board, "board is" would be dropped as empty and let everything through: it keeps the boards it
         named, which no ticket here is on, so it takes nothing (and says so) until a board of this instance is chosen */
      if (!values.length && c.values.length && c.op === 'is') { off('its condition on a board is left with none: it takes nothing', true); return c; }
      return { ...c, values };
    });
    if (m.kind === 'station') {
      const list = m.exec === 'agent' ? known.personas : m.exec === 'skill' ? known.skills : m.exec === 'panel' ? known.panels : null;
      if (list && m.ref && !list.includes(m.ref)) { off(`${m.exec === 'agent' ? 'persona' : m.exec} "${m.ref}"`); m.ref = ''; }
      if (m.model && known.models && !known.models.includes(m.model)) { off(`model "${m.model}": its persona's own is used`); delete m.model; }
    }
    if (m.kind === 'desk' && m.defaults?.boardId) {
      const b = board(m.defaults.boardId);
      if (!b) { off(boardName(m.defaults.boardId)); const { boardId: _, ...rest } = m.defaults; m.defaults = rest; } else m.defaults = { ...m.defaults, boardId: b };
    }
    if (m.kind === 'arm' && m.when) m.when = conds(m.when);
    if (m.kind === 'belt') {
      if (m.toll) m.toll = { ...m.toll, when: conds(m.toll.when) ?? [] };
      if (m.set) m.set = m.set.flatMap((o) => { if (o.field !== 'board') return [o]; const b = board(o.value); if (!b) { off(`sets ${boardName(o.value)}`); return []; } return [{ ...o, value: b }]; });
    }
    return m;
  });
  const fresh = new Map<string, string>();
  const out = relink(machines.map((m) => { const id = newId(); fresh.set(m.id, id); return { ...m, id } as MachineSpec; }), fresh);
  for (const d of dropped) d.machineId = fresh.get(d.machineId) ?? d.machineId;
  return { ok: true, machines: out, w: Number(file.layout.w) || 0, h: Number(file.layout.h) || 0, dropped };
}

/**
 * What a station lacks to run, in a few words; null when it has it all (or never runs anything: a gate, a status
 * station). With the lists of what the instance has, one naming a persona, a skill or a panel it does not have lacks it too.
 */
export function setupGap(m: MachineSpec, known?: Pick<Known, 'personas' | 'skills' | 'panels'> | null): string | null {
  if (m.kind !== 'station') return null;
  const what = m.exec === 'agent' ? 'persona' : m.exec === 'skill' ? 'skill' : m.exec === 'panel' ? 'panel' : null;
  if (what) {
    if (!m.ref) return `no ${what}`;
    const list = known ? (m.exec === 'agent' ? known.personas : m.exec === 'skill' ? known.skills : known.panels) : [];
    return list.length && !list.includes(m.ref) ? `no ${what} "${m.ref}" here` : null;
  }
  if (m.exec === 'script') return m.script && (m.script.lines.some((l) => l.value.trim()) || m.script.action) ? null : 'nothing to run';
  return null;
}
