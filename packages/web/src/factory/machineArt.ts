/**
 * A station, drawn as a machine: a head plate with what it is, a light, as many places as it works on tickets at
 * once, and a bay for what was set aside. This file says where each part goes and which ticket goes in which, in
 * tiles; the renderer paints, and the same geometry answers "is the pointer on the light".
 *
 * What is done has no tray of its own: it goes to the quay of the arm that will take it, on the machine's edge (see
 * `quays.ts`). Only what no arm takes is kept in a tray, which is there only then.
 *
 * Nothing queues in a machine: what cannot enter waits on the belt that feeds it.
 *
 * The four kinds that run something are told apart at a glance, as a gate is by its dashed edge: each has a hue, its
 * word on the head plate, and a body of its own (`KIND_LOOK`, `bodyOf`).
 */
import { RUNS, SET_ASIDE, type FactoryTicket, type StationSpec } from './types';
import { MAX_PLACES } from './layoutOps';

export interface Rect { x: number; y: number; w: number; h: number }
export interface MachineParts {
  badge: Rect;
  /** Where the name starts: to the right of the badge, on its upper half. */
  name: { x: number; y: number };
  lamp: Rect;
  /** Red, amber, green, top to bottom. */
  lights: { x: number; y: number; r: number }[];
  /** What the places share (a gate has no places: this is where what it decides on stands). */
  work: Rect;
  places: Rect[];
  /** The tray of what is done and that no arm takes; null while there is nothing of the kind. */
  out: Rect | null;
  /** Machines that run something only: a gate has nothing to set aside. */
  aside: Rect | null;
}

const EDGE = 0.22, HEAD = 1.14;

/** A station that runs something. */
export type RunKind = 'agent' | 'skill' | 'panel' | 'script';
export const kindOf = (m: StationSpec): RunKind | null => (RUNS.includes(m.exec) ? (m.exec as RunKind) : null);

/**
 * What tells the kinds apart: a hue (none of them the gate's amber, the green of "it works", the pink of a Set gantry
 * or the cyan of a teleporter), the word written over the name, and a body:
 * an agent has round shoulders and an antenna, a skill cut corners (a tool), a panel is a stack of plates (several
 * personas), a script a terminal window with its title bar.
 */
export const KIND_LOOK: Record<RunKind, { hue: string; word: string }> = {
  agent: { hue: '#a78bfa', word: 'AGENT' },
  skill: { hue: '#38bdf8', word: 'SKILL' },
  panel: { hue: '#fb923c', word: 'PANEL' },
  script: { hue: '#a3e635', word: 'SCRIPT' },
};

/** How far a panel's plates step back from one another, and how tall a script's title bar is. */
export const STACK = 0.24, BAR = 0.24;
/** How round an agent's shoulders are, and how much is cut off a skill's corners; any other body has `ROUND`. */
export const SHOULDER = 0.52, CUT = 0.34, ROUND = 0.34;

/**
 * The plate the machine's parts stand on, in its tile box: the whole box, except for a panel, whose front plate
 * leaves room at the top and on the right for the two behind it.
 */
export function bodyOf(m: StationSpec): Rect {
  const s = m.exec === 'panel' ? STACK : 0;
  return { x: m.x, y: m.y + s, w: m.w - s, h: m.h - s };
}

/** Room kept between the light and the machine's right edge: a quay there, on the top row, does not cover it. */
const LAMP_IN = 0.56;

/** The parts of a machine; `tray` when it holds something done that no arm takes, which then gets a tray on the right. */
export function machineParts(m: StationSpec, tray = false): MachineParts {
  /* a script's parts start under its title bar */
  const b = bodyOf(m), bar = m.exec === 'script' ? BAR : 0, x = b.x, y = b.y + bar, w = b.w, h = b.h - bar, runs = RUNS.includes(m.exec);
  const lamp: Rect = { x: x + w - LAMP_IN - 0.44, y: y + 0.2, w: 0.44, h: 0.9 };
  const top = y + HEAD, asideH = runs ? Math.min(0.78, (h - HEAD) * 0.36) : 0;
  const aside = runs ? { x: x + EDGE, y: y + h - EDGE - asideH, w: w - EDGE * 2, h: asideH } : null;
  const bottom = aside ? aside.y - 0.1 : y + h - EDGE;
  const outW = Math.min(0.86, w * 0.2);
  const out: Rect | null = tray ? { x: x + w - EDGE - outW, y: top, w: outW, h: bottom - top } : null;
  const work: Rect = { x: x + EDGE, y: top, w: (out ? out.x - 0.1 : x + w - EDGE) - (x + EDGE), h: bottom - top };
  const places: Rect[] = [];
  if (runs) {
    const n = placesOf(m), rows = n > 3 ? 2 : 1, cols = Math.ceil(n / rows), gap = 0.08;
    const cw = (work.w - (cols - 1) * gap) / cols, ch = (work.h - (rows - 1) * gap) / rows;
    for (let i = 0; i < n; i++) places.push({ x: work.x + (i % cols) * (cw + gap), y: work.y + Math.floor(i / cols) * (ch + gap), w: cw, h: ch });
  }
  return {
    badge: { x: x + EDGE + 0.02, y: y + 0.22, w: 0.72, h: 0.72 }, name: { x: x + EDGE + 0.9, y: y + 0.44 },
    lamp, lights: [0, 1, 2].map((i) => ({ x: lamp.x + lamp.w / 2, y: lamp.y + 0.19 + i * 0.26, r: 0.095 })),
    work, places, out, aside,
  };
}

/** How many places the machine shows: what it was asked for, as far as it can show. */
export const placesOf = (m: StationSpec): number => Math.max(1, Math.min(MAX_PLACES, Math.floor(m.cap) || 1));

/**
 * What the light says. On a machine that runs something it is also the switch:
 * `off` (red) it takes tickets in and starts nothing, `on` (green) it works, `call` (amber) it works and at least one
 * ticket in it is set aside and waits for someone. A gate has no switch: amber while something is to decide.
 */
export type Lamp = 'off' | 'call' | 'on';
export function lampOf(m: StationSpec, tickets: readonly FactoryTicket[]): Lamp {
  if (RUNS.includes(m.exec)) return m.off ? 'off' : tickets.some((t) => SET_ASIDE.includes(t.phase)) ? 'call' : 'on';
  return tickets.some((t) => t.phase === 'review') ? 'call' : 'on';
}

/** Which ticket goes where in the machine. `extra` are tickets the places cannot show (put back while it was full). */
export interface Sorted { places: (FactoryTicket | null)[]; extra: FactoryTicket[]; deciding: FactoryTicket[]; out: FactoryTicket[]; aside: FactoryTicket[] }
export function sortInto(m: StationSpec, tickets: readonly FactoryTicket[]): Sorted {
  const by = (...p: FactoryTicket['phase'][]) => tickets.filter((t) => p.includes(t.phase));
  /* what runs first, then what is held, so a place never looks free while a run is hidden behind a held ticket */
  const busy = [...by('running'), ...by('wait')], n = RUNS.includes(m.exec) ? placesOf(m) : 0;
  return {
    places: Array.from({ length: n }, (_, i) => busy[i] ?? null), extra: busy.slice(n),
    deciding: by('review'), out: by('out'), aside: by(...SET_ASIDE),
  };
}

/** What the light says in words, for the card shown when it is pointed at. First line is the headline. */
export function lampLines(m: StationSpec, tickets: readonly FactoryTicket[]): string[] {
  const s = sortInto(m, tickets), out = s.out.length ? `${s.out.length} done, waiting for an arm` : '';
  if (!RUNS.includes(m.exec)) {
    if (m.exec === 'native') return ['Sets a status and lets the ticket through'];
    return [s.deciding.length ? `${s.deciding.length} to decide` : 'Nothing to decide', ...(out ? [out] : []), 'A gate has no switch: it only waits for you.'];
  }
  const n = (p: FactoryTicket['phase']) => tickets.filter((t) => t.phase === p).length;
  const aside = [[n('question'), 'question'], [n('failed'), 'failed'], [n('aside'), 'by you']].filter(([c]) => c).map(([c, w]) => `${c} ${w}`).join(', ');
  return [
    m.off ? 'Off' : aside ? 'On, and it needs you' : 'On',
    `${n('running')} running of ${placesOf(m)}${n('wait') ? `, ${n('wait')} held` : ''}`,
    ...(aside ? [`set aside: ${aside}`] : []),
    out ? `exit: ${out}` : 'exit clear',
    m.off ? 'Click to switch it on: what it holds starts.' : 'Click to switch it off: nothing new starts here.',
  ];
}

export const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** What a machine is, as strokes in a 24 by 24 box: drawn on its head plate. */
export const MACHINE_ICONS: Record<'agent' | 'skill' | 'panel' | 'script' | 'human_gate', string[]> = {
  script: ['M4.500 5h15a1.500 1.500 0 0 1 1.500 1.500v11a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 17.500v-11A1.500 1.500 0 0 1 4.500 5z', 'M7.500 9.500l3 2.500-3 2.500', 'M12.500 15h4'],
  agent: ['M7.5 8h9a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.500v-6A2.5 2.5 0 0 1 7.500 8z', 'M12 8V4.600', 'M11 3.600a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M8.400 13a.9.9 0 1 0 1.800 0a.9.9 0 1 0-1.800 0', 'M13.800 13a.9.9 0 1 0 1.800 0a.9.9 0 1 0-1.800 0', 'M9.500 16.200h5', 'M2.500 12v3', 'M21.500 12v3'],
  skill: ['M14.700 6.300a4 4 0 0 0-5.200 5.200L4 17v3h3l5.500-5.500a4 4 0 0 0 5.200-5.200l-2.600 2.600-2.300-.7-.7-2.300z'],
  panel: ['M5 9a2.400 2.400 0 1 0 4.800 0A2.400 2.400 0 1 0 5 9', 'M14.200 9a2.400 2.400 0 1 0 4.800 0a2.400 2.400 0 1 0-4.800 0', 'M9.600 16a2.400 2.400 0 1 0 4.800 0a2.400 2.400 0 1 0-4.800 0'],
  human_gate: ['M12 3l7 3v5.200c0 4.300-2.900 7.300-7 8.800-4.100-1.500-7-4.500-7-8.800V6z', 'M8.800 12l2.300 2.300 4.200-4.400'],
};
