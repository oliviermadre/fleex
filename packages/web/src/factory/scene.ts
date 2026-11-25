/**
 * What the floor shows at this frame, and where, without any paint: the scene a skin paints.
 *
 * Built once a frame from what the page holds (`ViewState`) and from what was shown at the frame before: tickets ease
 * towards where the server says they are, ride the belts at their pace, are carried by the cups of arms that keep
 * turning between two snapshots, slide to the quay of the arm that will take them, leave by an exit and jump between
 * teleporters. That memory is here, so that whatever paints the scene keeps none: a skin is paint only.
 *
 * What it does not decide: sizes in pixels, colours, fonts, and what is left out because the view is too far. Those
 * are the painter's (see `renderer.ts`), since they change with the camera and the skin and not with the floor.
 */
import { armTag, isConditional, shortCondition } from './armRules';
import { armDue, armShown, easeSwing } from './armMotion';
import { bridgeFlow } from './bridges';
import { follow, type Track, type TrackPos } from './ticketMotion';
import { kindOf, lampOf, machineParts, sortInto, type Lamp, type MachineParts, type Rect, type RunKind, type Sorted } from './machineArt';
import { dispatch, entryOf, QUAY_ROOM, quayRect, quaySpot, reachOf, type Dispatch, type EdgePoint } from './quays';
import { arrivalOf, departuresOf, isArrival, isDeparture, isPort, portBad, portColor, portLine, portName, portState, type PortState } from './teleport';
import { opText, plateLines } from './setOps';
import { scriptPlate, scriptSummary } from './script';
import { PULLED_SOURCES } from './itemSources';
import { DX, DY, humanCall, type AreaSpec, type ArmSpec, type BeltSpec, type DeskSpec, type FactoryLayout, type IntakeSpec, type FactoryTicket, type HumanCall, type MachineSpec, type StationSpec, type TeleporterSpec, type ZoneSpec } from './types';
import type { DragState, ViewState } from './renderer';

/** What is left of a ticket's way after a second: when it is moved (it must not jump), and when it slides to its quay (it must be seen going). */
const SNAP = 0.0005, SLIDE = 0.03;
/** Seconds a ticket takes to fade once it is past an exit's frame. */
const FADE_S = 0.75;
/** Seconds a ticket is drawn jumping from a departure to its arrival. The engine moves it at once; this is for the eye. */
export const JUMP_S = 0.6;

export const isBox = (m: MachineSpec | null | undefined): boolean => !!m && (m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit' || m.kind === 'desk' || m.kind === 'intake');

/** How a ticket is marked where it stands: at work, waiting for someone, failed, on its way out, held. */
export type Mark = 'run' | 'human' | 'fail' | 'out' | 'wait' | '';
/** A ticket where it is drawn at this frame (eased), at its size, with what is said of it. */
export interface Placed {
  t: FactoryTicket; x: number; y: number; s: number; mark: Mark;
  dragging: boolean; picked: boolean; selected: boolean; found: boolean;
  /** Left out by a filter: drawn faded, without its marks. */
  dim: boolean;
  call: HumanCall | null;
}
/** The quay of an arm on the edge of a box, and the tickets in line there, the last first (the one that leaves next is drawn on top). */
export interface Quay { a: ArmSpec; q: Rect; line: Placed[]; more: number; moreAt: { x: number; y: number } | null }

export interface BeltView {
  m: BeltSpec;
  /** The direction its feeder travels in when it is a bend, else -1. */
  bend: number;
  /** The sides of a straight belt that have a rail: those where nothing comes in or goes on. */
  rails: number[];
  /** It leads nowhere and no arm takes from it. */
  dead: boolean;
  /** Something comes in from behind: its chevrons may start before the tile. */
  fed: boolean;
  riders: Placed[];
  gantry: GantryView | null;
  toll: TollView | null;
}
export interface GantryView {
  across: boolean; under: boolean; failed: boolean; asked: boolean;
  /** Its plate: what it sets, then what it rejects; `set` lines are the first ones. */
  lines: string[]; set: number; side: PlateSide;
}
export interface TollView { ex: number; ey: number; hx: number; hy: number; carried: Placed | null }
export type PlateSide = 'above' | 'below' | 'right' | 'left';
export interface BridgeView { m: MachineSpec; flow: ReturnType<typeof bridgeFlow>; riders: (Placed & { fx: number })[] }

export interface LabelView { kind: 'label'; m: Extract<MachineSpec, { kind: 'label' }> }
export interface ZoneView { kind: 'zone'; m: ZoneSpec; held: Placed[]; more: number; stock: number; quays: Quay[] }
export interface StationView {
  kind: 'station'; m: StationSpec; run: RunKind | null; gate: boolean; parts: MachineParts; sorted: Sorted; lamp: Lamp;
  /** What it runs, in words (under its name). */
  what: string;
  deciding: Placed[]; decidingMore: number;
  places: { c: Rect; t: Placed | null; size: number; cx: number; cy: number }[];
  extra: number;
  stuck: Placed[]; stuckCount: number; stuckMore: number;
  aside: Placed[]; asideCount: number; asideMore: number;
  quays: Quay[];
  model: string | null;
  /** What a script station runs, one line a command: only while it is selected or pointed at. */
  plate: string[] | null;
}
export interface StatusView {
  kind: 'status'; m: StationSpec; big: boolean; busy: boolean; full: boolean;
  slots: { x: number; y: number; size: number; t: Placed | null }[]; more: number; moreAt: { x: number; y: number };
  out: Placed[]; outBox: Rect | null; quays: Quay[];
}
/** How many tickets left by it over the last `days` days (and since the page last asked); null when that is not known. */
export interface ExitView { kind: 'exit'; m: MachineSpec; count: number | null; days: number }
export interface PortView {
  kind: 'port'; m: TeleporterSpec; dep: boolean; state: PortState; bad: boolean; waiting: boolean; color: string;
  /** 0 to 1: the light of a ticket that leaves or arrives. */
  burst: number;
  held: Placed | null;
  /** The ticket that has just left, shrinking where it stood. */
  gone: { type: string; k: number } | null;
  name: string; line: string; asked: boolean; plate: 'below' | 'above' | 'right';
}
/**
 * A dock of 3 by 2: a desk, where a ticket is born, or an intake, where items of a source come in. What no arm has
 * taken yet stands in it (`held`, two at most, then `more`); what is
 * let out waits at the quays of its arms. An intake counts what waits (`waiting`) and what its rules dropped over 24 h;
 * a pulled one (Gmail) has no rules, and says instead when its last pull failed.
 */
export interface DockView { kind: 'dock'; m: DeskSpec | IntakeSpec; held: Placed[]; more: number; quays: Quay[]; noArm: boolean; waiting: number; dropped: number; /** A pulled intake (Gmail): whether its last pull failed; null for one that is not pulled. */ pullFailed: boolean | null }
export type BoxView = LabelView | ZoneView | StationView | StatusView | ExitView | PortView | DockView;

export interface ArmView {
  m: ArmSpec; bx: number; by: number; dx: number; dy: number; hx: number; hy: number;
  filtered: boolean; carried: Placed | null; tag: string | null; asked: boolean;
  /** What stands where it drops and where it takes, when a tag must keep clear of it. */
  solidSrc: boolean; solidDst: boolean;
}
export type LeavingView = { type: string; travel: true; x: number; y: number } | { type: string; travel: false; k: number; x: number; y: number; m: MachineSpec; edge: EdgePoint; a0: number; a1: number };
export interface LinkView { x1: number; y1: number; x2: number; y2: number; qx: number; qy: number; trim: number; color: string; hot: boolean; packet: number | null }
/** In build mode, where an arm takes from and drops on. */
export interface ArmWay { x: number; y: number; dir: number; turn: boolean; idle: boolean; shut: boolean; takes: string; drops: string }

export interface Scene {
  layout: FactoryLayout;
  /** The areas of the floor, in the order they were laid: decor under everything. */
  areas: AreaSpec[];
  /** The floor's own clock, in seconds: it stands still while the floor is stopped. */
  clock: number;
  /** The stations that light the floor round them: one that needs someone, one that is off. Not in build mode, nor under a lens. */
  lit: [StationSpec, Lamp][];
  belts: BeltView[];
  bridges: BridgeView[];
  boxes: BoxView[];
  loose: Placed[];
  arms: ArmView[];
  leaving: LeavingView[];
  links: LinkView[];
  noEntry: { x: number; y: number }[];
  /** Tickets on the floor being worked on or reviewed: what a zone's limit is about. */
  wip: number;
  /** What the selection is fed by and emptied by. */
  feeders: MachineSpec[]; emptiers: ArmSpec[];
  ways: ArmWay[];
  /** Where a dragged ticket would land. */
  dropBox: { x: number; y: number; w: number; h: number } | null;
  /** The tickets that carry their name, and the box they stand in. */
  named: { t: FactoryTicket; x: number; y: number; box: MachineSpec | null }[];
}

/** A ticket drawn on a belt or a bridge, and where on it. */
interface Riding { t: FactoryTicket; pos: TrackPos }
interface Jump { id: string; type: string; from: TeleporterSpec; to: TeleporterSpec; age: number }
interface Leaving { type: string; from: { x: number; y: number }; edge: EdgePoint; exit: MachineSpec; age: number; travel: number }

export class FloorScene {
  clock = 0;
  private gridFor: FactoryLayout | null = null;
  private grid = new Map<string, MachineSpec>();
  private byId = new Map<string, MachineSpec>();
  /** Where each ticket is drawn; eased towards where the server says it is. */
  readonly shown = new Map<string, { x: number; y: number }>();
  private armShown = new Map<string, number>();
  private drawnOn = new Map<string, TrackPos>();
  private quayFor = new Map<string, string>();
  private lastOn = new Map<string, { m: string | null; fx: number; fy: number; type: string }>();
  private handAt = new Map<string, { x: number; y: number }>();
  private leavingList: Leaving[] = [];
  private jumps: Jump[] = [];
  private inside = new Map<string, FactoryTicket[]>();
  private passed = new Map<string, number>();
  private countsFrom: unknown = null;
  /* for the frame being built */
  private st!: ViewState;
  private dt = 0;

  // ---------- the floor as a grid ----------
  index(layout: FactoryLayout): void {
    if (this.gridFor === layout) return;
    this.gridFor = layout; this.grid = new Map(); this.byId = new Map();
    for (const m of layout.machines) {
      this.byId.set(m.id, m);
      /* a label and an area take no tile: machines stand on them */
      if (m.kind === 'label' || m.kind === 'area') continue;
      for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) this.grid.set(`${i},${j}`, m);
    }
  }
  at(x: number, y: number): MachineSpec | null { return this.grid.get(`${x},${y}`) ?? null; }
  machine(id: string | null): MachineSpec | null { return id ? this.byId.get(id) ?? null : null; }
  /** Does this neighbour push tickets onto the tile at (x, y)? A bridge does, unless that tile is a belt pointing back at it. */
  private feeds(n: MachineSpec | null, x: number, y: number): boolean {
    if (!n) return false;
    if (n.kind === 'belt') return n.x + DX[n.dir] === x && n.y + DY[n.dir] === y;
    if (n.kind !== 'bridge') return false;
    const me = this.at(x, y);
    return !(me && me.kind === 'belt' && me.x + DX[me.dir] === n.x && me.y + DY[me.dir] === n.y);
  }
  /** A belt fed from one side only, and not from behind, is a bend: the direction its feeder travels in, or -1. */
  private bendOf(b: BeltSpec): number {
    let f = -1, n = 0;
    for (let s = 0; s < 4; s++) if (s !== b.dir && this.feeds(this.at(b.x + DX[s as 0], b.y + DY[s as 0]), b.x, b.y)) { n++; f = (s + 2) % 4; }
    return n === 1 && f !== b.dir ? f : -1;
  }
  takersOf(m: MachineSpec): ArmSpec[] {
    const out: ArmSpec[] = [];
    for (let x = m.x - 1; x <= m.x + m.w; x++) for (let y = m.y - 1; y <= m.y + m.h; y++) {
      const n = this.at(x, y);
      /* by id, never by object: the machine asked about may come from another copy of the same layout */
      if (n && n.kind === 'arm' && this.at(n.x - DX[n.dir], n.y - DY[n.dir])?.id === m.id && !out.some((q) => q.id === n.id)) out.push(n);
    }
    return out;
  }
  /** The first machine a belt leads to, following the belts as they point. */
  leadsTo(m: MachineSpec | null, dir = 0): MachineSpec | null {
    let guard = 0;
    while (m && (m.kind === 'belt' || m.kind === 'bridge') && guard++ < 5000) {
      if (m.kind === 'belt') dir = m.dir;
      m = this.at(m.x + DX[dir as 0], m.y + DY[dir as 0]);
    }
    return m && m.kind !== 'belt' && m.kind !== 'bridge' ? m : null;
  }
  /** The belts and bridges as a track a ticket is drawn along: which tile follows which, and how fast each carries. */
  private track(st: ViewState): Track {
    const base = st.beltSpeed || 1.2, times = st.fastBelt || 2;
    return {
      next: (at) => {
        const m = this.byId.get(at.id);
        if (!m) return null;
        const dx = m.kind === 'belt' ? DX[m.dir] : at.fx, dy = m.kind === 'belt' ? DY[m.dir] : at.fy, n = this.at(m.x + dx, m.y + dy);
        return n && (n.kind === 'belt' || n.kind === 'bridge') ? { id: n.id, fx: dx, fy: dy } : null;
      },
      pace: (at) => {
        const m = this.byId.get(at.id);
        if (m?.kind === 'belt') return base * (m.fast ? times : 1);
        if (m?.kind === 'bridge') { const f = bridgeFlow((px, py) => this.at(px, py), m); return base * ((at.fx !== 0 ? f.overFast : f.underFast) ? times : 1); }
        return base;
      },
    };
  }

  // ---------- tickets ----------
  /** A ticket drawn at (x, y): eased from where it was drawn, so a poll does not make it jump. */
  private place(t: FactoryTicket, x: number, y: number, s: number, mark: Mark, rate = SNAP): Placed {
    const st = this.st, cur = this.shown.get(t.ticketId), k = cur ? 1 - Math.pow(rate, this.dt) : 1;
    const px = cur ? cur.x + (x - cur.x) * k : x, py = cur ? cur.y + (y - cur.y) * k : y;
    this.shown.set(t.ticketId, { x: px, y: py });
    const dragging = st.drag?.ticketId === t.ticketId, picked = !!st.pickTickets?.has(t.ticketId), selected = st.selTicket === t.ticketId || !!st.selTickets?.has(t.ticketId);
    return { t, x: px, y: py, s, mark, dragging, picked, selected, found: !!st.found?.has(t.ticketId), dim: !!st.dim?.has(t.ticketId) && !selected && !picked && !dragging, call: dragging ? null : humanCall(t) };
  }
  /** Which arm takes each ticket that is ready to leave a box; a ticket keeps the quay it was sent to. */
  private leavers(m: MachineSpec, takers: ArmSpec[], tickets: FactoryTicket[]): Dispatch {
    const st = this.st, D = dispatch(m, takers, tickets, { keep: this.quayFor, busy: (id) => { const a = st.arms.get(id); return !!a && a.state !== 'rest'; } });
    for (const [ticketId, armId] of D.quay) this.quayFor.set(ticketId, armId);
    return D;
  }
  private quays(takers: ArmSpec[], D: Dispatch): Quay[] {
    return takers.map((a) => {
      const line = D.byArm.get(a.id) ?? [], drawn: Placed[] = [];
      for (let i = line.length - 1; i >= 0; i--) {
        const at = quaySpot(a, i);
        if (i < QUAY_ROOM) drawn.push(this.place(line[i]!, at.x, at.y, i ? 0.34 : 0.4, '', SLIDE)); else this.shown.set(line[i]!.ticketId, at);
      }
      const last = line.length > QUAY_ROOM ? quaySpot(a, QUAY_ROOM - 1) : null;
      return { a, q: quayRect(a), line: drawn, more: line.length - QUAY_ROOM, moreAt: last && { x: last.x, y: last.y + 0.3 } };
    });
  }

  /** The scene at this frame. `dt` is the time since the last one; `halted` stops the floor's clock and what rides the belts. */
  build(st: ViewState, dt: number): Scene {
    const L = st.layout, moving = st.halted ? 0 : dt;
    this.st = st; this.dt = dt;
    this.index(L); this.clock += moving;
    const inside = new Map<string, FactoryTicket[]>();
    for (const t of st.tickets) if (t.machineId) { const a = inside.get(t.machineId); if (a) a.push(t); else inside.set(t.machineId, [t]); }
    for (const a of inside.values()) a.sort((p, q) => p.since.localeCompare(q.since));
    this.inside = inside;
    const noEntry: { x: number; y: number }[] = [];

    const lit: [StationSpec, Lamp][] = [];
    if (!st.edit && !st.lens) for (const m of L.machines) if (m.kind === 'station' && m.exec !== 'native') { const s = lampOf(m, inside.get(m.id) ?? []); if (s !== 'on') lit.push([m, s]); }

    const live = new Set(st.tickets.map((t) => t.ticketId));
    if (st.exits !== this.countsFrom) { this.countsFrom = st.exits; this.passed.clear(); }
    for (const id of this.shown.keys()) if (!live.has(id)) { this.left(id, st); this.shown.delete(id); }
    for (const id of this.lastOn.keys()) if (!live.has(id)) { this.lastOn.delete(id); this.quayFor.delete(id); }
    let wip = 0;
    this.jumps = this.jumps.filter((j) => { j.age += dt; return j.age < JUMP_S && live.has(j.id); });
    for (const t of st.tickets) {
      const was = this.lastOn.get(t.ticketId);
      if (was && was.m !== t.machineId) this.jumped(t, was.m);
      this.lastOn.set(t.ticketId, { m: t.machineId, fx: t.fx, fy: t.fy, type: t.info?.type ?? '' });
      if (t.info && (t.info.status === 'doing' || t.info.status === 'reviewing')) wip++;
    }

    const beltSpecs = L.machines.filter((m): m is BeltSpec => m.kind === 'belt');
    /*
     * Tickets on belts and bridges are drawn moving along them at the belts' pace, towards where the server last had
     * them: told as it is, twice a second, a ticket would stand, jump and stand again. So a ticket may be drawn on the
     * tile before the one the server has it on.
     */
    const track = this.track(st), onTrack = new Map<string, Riding[]>(), riding = new Set<string>(), tollCarry = new Map<string, FactoryTicket>();
    for (const t of st.tickets) {
      const m = t.machineId ? this.byId.get(t.machineId) : null;
      if (!m || (m.kind !== 'belt' && m.kind !== 'bridge')) continue;
      /* what a toll rejected is in its arm, no longer on its belt */
      if (t.phase === 'arm') { tollCarry.set(m.id, t); continue; }
      const told: TrackPos = { id: m.id, p: t.p, fx: t.fx, fy: t.fy };
      let pos = follow(track, this.drawnOn.get(t.ticketId), told, moving);
      const tile = this.byId.get(pos.id);
      if (!tile || (tile.kind !== 'belt' && tile.kind !== 'bridge')) pos = told;
      this.drawnOn.set(t.ticketId, pos); riding.add(t.ticketId);
      const list = onTrack.get(pos.id); if (list) list.push({ t, pos }); else onTrack.set(pos.id, [{ t, pos }]);
    }
    for (const id of this.drawnOn.keys()) if (!riding.has(id)) this.drawnOn.delete(id);

    const bridges: BridgeView[] = [];
    for (const m of L.machines) if (m.kind === 'bridge') {
      const { x, y } = m;
      bridges.push({ m, flow: bridgeFlow((px, py) => this.at(px, py), m), riders: (onTrack.get(m.id) ?? []).map(({ t, pos }) => ({ ...this.place(t, x + 0.5 + pos.fx * (pos.p - 0.5), y + 0.5 + pos.fy * (pos.p - 0.5), 0.46, ''), fx: pos.fx })) });
    }
    const boxes: BoxView[] = [];
    for (const m of L.machines) {
      if (m.kind === 'label') boxes.push({ kind: 'label', m });
      else if (m.kind === 'zone') boxes.push(this.zone(m, inside.get(m.id) ?? []));
      else if (m.kind === 'station') boxes.push(m.exec === 'native' ? this.statusStation(m, inside.get(m.id) ?? []) : this.station(m, inside.get(m.id) ?? []));
      else if (m.kind === 'exit') boxes.push({ kind: 'exit', m, count: st.exits ? (st.exits[m.id] ?? 0) + (this.passed.get(m.id) ?? 0) : null, days: st.exitDays ?? 7 });
      else if (m.kind === 'teleporter') boxes.push(this.port(m, inside.get(m.id)?.[0] ?? null, noEntry));
      else if (m.kind === 'desk' || m.kind === 'intake') boxes.push(this.dock(m, inside.get(m.id) ?? []));
    }
    const belts: BeltView[] = beltSpecs.map((b) => this.belt(b, onTrack.get(b.id) ?? []));
    const loose: Placed[] = [];
    for (const t of st.tickets) if (!t.machineId || !this.byId.has(t.machineId)) loose.push(this.place(t, t.x + 0.5, t.y + 0.5, 0.5, ''));
    const arms: ArmView[] = [];
    for (const m of L.machines) if (m.kind === 'arm') arms.push(this.arm(m, inside.get(m.id)?.[0] ?? null));
    for (const b of belts) if (b.m.toll) b.toll = this.tollArm(b.m, tollCarry.get(b.m.id) ?? null);
    const leaving = this.departures(dt);
    const links = this.links(st);

    /* the selection: what feeds it and what empties it; in build mode, where an arm takes and drops */
    const sel = this.machine(st.selMachine), feeders: MachineSpec[] = [], emptiers: ArmSpec[] = [];
    if (sel && isBox(sel)) {
      for (let x = sel.x - 1; x <= sel.x + sel.w; x++) for (let y = sel.y - 1; y <= sel.y + sel.h; y++) {
        const n = this.at(x, y);
        if (!n || n.id === sel.id) continue;
        if ((n.kind === 'belt' || n.kind === 'arm') && this.at(n.x + DX[n.dir], n.y + DY[n.dir])?.id === sel.id) feeders.push(n);
      }
      emptiers.push(...this.takersOf(sel));
    }
    const ways: ArmWay[] = [];
    if (st.edit && sel?.kind === 'arm' && !st.selMany.length) ways.push(this.armWay(sel.x, sel.y, sel.dir, true));
    const g = st.ghost;
    if (g && !g.erase) for (const c of g.cells) if (c.arm && c.dir != null) ways.push(this.armWay(c.x, c.y, c.dir, g.cells.length === 1));

    return {
      layout: L, areas: L.machines.filter((m): m is AreaSpec => m.kind === 'area'), clock: this.clock, lit, belts, bridges, boxes, loose, arms, leaving, links, noEntry, wip,
      feeders, emptiers, ways, dropBox: this.dropBox(st.drag), named: this.named(st),
    };
  }

  // ---------- what moves along the belts ----------
  private belt(b: BeltSpec, riding: Riding[]): BeltView {
    const { x, y } = b, dx = DX[b.dir], dy = DY[b.dir], f = this.bendOf(b), rails: number[] = [];
    if (f < 0) for (let s = 0; s < 4; s++) {
      const n = this.at(x + DX[s as 0], y + DY[s as 0]);
      if (s === b.dir ? !!n && (n.kind === 'belt' || n.kind === 'bridge' || isBox(n) || isDeparture(n)) : this.feeds(n, x, y)) continue;
      rails.push(s);
    }
    const n = this.at(x + dx, y + dy);
    const dead = !(n && (n.kind === 'belt' || n.kind === 'bridge' || isBox(n) || isDeparture(n))) && !this.takersOf(b).length;
    const fed = f >= 0 || (() => { const k = this.at(b.x - dx, b.y - dy); return !!k && (k.kind === 'bridge' || this.feeds(k, b.x, b.y)); })();
    const riders = riding.map(({ t, pos }) => {
      const cx = b.x + 0.5, cy = b.y + 0.5;
      let px: number, py: number;
      if (f >= 0 && pos.fx === DX[f as 0] && pos.fy === DY[f as 0]) {
        const ca = Math.cos(pos.p * Math.PI / 2), sa = Math.sin(pos.p * Math.PI / 2);
        px = cx - DX[f as 0] * 0.5 + DX[b.dir] * 0.5 + 0.5 * (DX[f as 0] * sa - DX[b.dir] * ca); py = cy - DY[f as 0] * 0.5 + DY[b.dir] * 0.5 + 0.5 * (DY[f as 0] * sa - DY[b.dir] * ca);
      } else if (pos.p < 0.5) { px = cx - pos.fx * (0.5 - pos.p); py = cy - pos.fy * (0.5 - pos.p); }
      else { px = cx + DX[b.dir] * (pos.p - 0.5); py = cy + DY[b.dir] * (pos.p - 0.5); }
      return this.place(t, px, py, 0.46, '');
    });
    return { m: b, bend: f, rails, dead, fed, riders, gantry: b.set !== undefined ? this.gantry(b, riding) : null, toll: null };
  }
  /** The side of a tile a plate can stand on without covering what is next to it: the sides across the belt first. */
  private freeSide(x: number, y: number, across: boolean): PlateSide {
    const order: PlateSide[] = across ? ['above', 'below', 'right', 'left'] : ['right', 'left', 'above', 'below'];
    const free = (s: PlateSide) => !this.at(x + (s === 'right' ? 1 : s === 'left' ? -1 : 0), y + (s === 'below' ? 1 : s === 'above' ? -1 : 0));
    return order.find(free) ?? order[0]!;
  }
  /** A Set gantry, and what its plate says: one operation a line, then what a toll rejects. */
  private gantry(b: BeltSpec, riding: Riding[]): GantryView {
    const st = this.st, across = b.dir % 2 === 0;
    const under = riding.some((r) => Math.abs(r.pos.p - 0.5) < 0.18), failed = riding.some((r) => !!r.t.note);
    const asked = st.selMachine === b.id || st.hoverMachine === b.id;
    const ops = b.set ?? [], rejects = (b.toll?.when ?? []).map((c) => `reject: ${shortCondition(c, st.boardName)}`);
    const set = ops.length ? plateLines(ops.map((o) => opText(o, st.boardName)), asked ? 12 : 4) : b.toll ? [] : ['nothing set yet'];
    const lines = [...set, ...(b.toll ? (rejects.length ? plateLines(rejects, asked ? 8 : 3) : ['rejects nothing yet']) : [])];
    /* the plate keeps clear of the side the toll's arm works on */
    let side = this.freeSide(b.x, b.y, across);
    if (b.toll && side === (['right', 'below', 'left', 'above'] as const)[b.toll.out]) side = (['left', 'above', 'right', 'below'] as const)[b.toll.out];
    return { across, under, failed, asked, lines, set: set.length, side };
  }
  /** The arm of a toll: it takes what the toll rejects from the middle of the belt to the middle of the next tile. */
  private tollArm(b: BeltSpec, carried: FactoryTicket | null): TollView {
    const st = this.st, out = b.toll!.out, ox = DX[out], oy = DY[out], ex = b.x + 0.5 + ox * 0.5, ey = b.y + 0.5 + oy * 0.5;
    const swing = (st.armSwing || 1.1) * 0.6, p = armShown(this.armShown.get(b.id), armDue(st.arms.get(b.id), st.armAge ?? 0, swing), this.dt, swing);
    this.armShown.set(b.id, p);
    const way = oy === DX[b.dir] && -ox === DY[b.dir] ? 1 : -1, th = Math.atan2(-oy, -ox) + way * Math.PI * easeSwing(p), hx = ex + Math.cos(th) * 0.5, hy = ey + Math.sin(th) * 0.5;
    return { ex, ey, hx, hy, carried: this.hold(b.id, hx, hy, carried, 0.4) };
  }
  /** What a cup carries moves with it: only what was between the two when it was lifted is closed in on. */
  private hold(id: string, hx: number, hy: number, carried: FactoryTicket | null, s: number): Placed | null {
    const hand = this.handAt.get(id);
    this.handAt.set(id, { x: hx, y: hy });
    if (!carried) return null;
    const cur = this.shown.get(carried.ticketId);
    if (cur && hand) this.shown.set(carried.ticketId, { x: cur.x + hx - hand.x, y: cur.y + hy - hand.y });
    return this.place(carried, hx, hy, s, '');
  }

  // ---------- arms ----------
  private arm(a: ArmSpec, carried: FactoryTicket | null): ArmView {
    const st = this.st, bx = a.x + 0.5, by = a.y + 0.5, dx = DX[a.dir], dy = DY[a.dir];
    /* the half turn is drawn here, not sampled from the server: see `armMotion.ts` */
    /* a fast arm swings twice as fast, as the engine has it */
    const swing = (st.armSwing || 1.1) / (a.fast ? 2 : 1), p = armShown(this.armShown.get(a.id), armDue(st.arms.get(a.id), st.armAge ?? 0, swing), this.dt, swing);
    this.armShown.set(a.id, p);
    const e = easeSwing(p), src = this.at(a.x - dx, a.y - dy), dst = this.at(a.x + dx, a.y + dy), R = reachOf(src, dst);
    /* the cup goes where the ticket is: over the middle of a belt's tile, over its quay on the edge of a box */
    const th = Math.atan2(dy, dx) + Math.PI * (1 - e), reach = R.from + (R.to - R.from) * e, hx = bx + Math.cos(th) * reach, hy = by + Math.sin(th) * reach;
    const solid = (m: MachineSpec | null) => isBox(m) || isPort(m);
    return {
      m: a, bx, by, dx, dy, hx, hy, filtered: isConditional(a), carried: this.hold(a.id, hx, hy, carried, 0.42),
      tag: armTag(a, src ? this.takersOf(src) : [], st.boardName), asked: st.selMachine === a.id || st.hoverMachine === a.id,
      solidSrc: solid(src), solidDst: solid(dst),
    };
  }

  // ---------- boxes ----------
  private station(m: StationSpec, tickets: FactoryTicket[]): StationView {
    const st = this.st, gate = m.exec === 'human_gate', takers = this.takersOf(m), D = this.leavers(m, takers, tickets);
    const P = machineParts(m, D.stuck.length > 0), S = sortInto(m, tickets), run = kindOf(m);
    /* a question an arm takes is on its way out: it stands at that arm's quay, not in the bay */
    const asideT = S.aside.filter((t) => !D.quay.has(t.ticketId));
    const v: StationView = {
      kind: 'station', m, run, gate, parts: P, sorted: S, lamp: lampOf(m, tickets),
      what: gate ? 'you decide' : m.exec === 'script' ? scriptSummary(m.script) : m.ref || 'nothing chosen',
      deciding: [], decidingMore: 0, places: [], extra: 0, stuck: [], stuckCount: D.stuck.length, stuckMore: 0, aside: [], asideCount: asideT.length, asideMore: 0,
      quays: [], model: null, plate: null,
    };
    if (gate) {
      const pitch = 0.8, cols = Math.max(1, Math.floor((P.work.w - 0.2) / pitch)), rows = Math.max(1, Math.floor((P.work.h - 0.36) / pitch)), n = cols * rows;
      S.deciding.forEach((t, i) => {
        if (i < n) v.deciding.push(this.place(t, P.work.x + 0.1 + pitch / 2 + (i % cols) * pitch, P.work.y + 0.34 + pitch / 2 + Math.floor(i / cols) * pitch, 0.44, 'human'));
        else this.shown.set(t.ticketId, { x: P.work.x + P.work.w - 0.3, y: P.work.y + P.work.h - 0.3 });
      });
      v.decidingMore = S.deciding.length - n;
    } else {
      P.places.forEach((c, i) => {
        const t = S.places[i], size = Math.min(c.w, c.h - 0.2) * 0.52, cx = c.x + c.w / 2, cy = c.y + c.h / 2 + 0.08;
        v.places.push({ c, size, cx, cy, t: t ? this.place(t, cx, cy, size, t.phase === 'running' ? 'run' : 'wait') : null });
      });
      S.extra.forEach((t) => this.shown.set(t.ticketId, { x: P.work.x + P.work.w - 0.3, y: P.work.y + 0.3 }));
      v.extra = S.extra.length;
    }
    if (P.out) {
      const o = P.out, os = Math.min(0.42, o.w * 0.56), room = Math.max(1, Math.floor((o.h - 0.36) / (os + 0.12)));
      D.stuck.forEach((t, i) => { if (i < room) v.stuck.push(this.place(t, o.x + o.w / 2, o.y + 0.36 + os / 2 + i * (os + 0.12), os, 'fail')); else this.shown.set(t.ticketId, { x: o.x + o.w / 2, y: o.y + o.h - 0.2 }); });
      v.stuckMore = D.stuck.length - room;
    }
    if (P.aside) {
      const a = P.aside, band = 0.42;
      /* the tickets stand to the right of the bay's name, apart enough for their signs not to cover one another */
      const as = Math.min(0.44, a.h * 0.56), step = as + 0.4, x0 = a.x + band + 1.2, fit = Math.max(1, Math.floor((a.x + a.w - 0.1 - x0) / step));
      asideT.forEach((t, i) => { if (i < fit) v.aside.push(this.place(t, x0 + as / 2 + i * step, a.y + a.h / 2, as, t.phase === 'failed' ? 'fail' : 'human')); else this.shown.set(t.ticketId, { x: a.x + a.w - 0.3, y: a.y + a.h / 2 }); });
      v.asideMore = asideT.length - fit;
    }
    v.quays = this.quays(takers, D);
    v.model = st.modelOf?.(m) ?? null;
    if (m.exec === 'script' && (st.selMachine === m.id || st.hoverMachine === m.id)) v.plate = plateLines(scriptPlate(m.script), 9);
    return v;
  }

  private statusStation(m: StationSpec, tickets: FactoryTicket[]): StatusView {
    const { x, y, w, h } = m, big = w >= 3;
    const takers = this.takersOf(m), D = this.leavers(m, takers, tickets);
    const waiting = tickets.filter((t) => t.phase !== 'out'), out = D.stuck;
    const cols = big ? 4 : 3, rows = big ? 2 : 1, size = big ? 0.5 : 0.4, gap = big ? 0.1 : 0.09, n = cols * rows;
    const x0 = x + (w - cols * size - (cols - 1) * gap) / 2, y0 = y + (big ? 0.92 : 0.8);
    const slots: StatusView['slots'] = [];
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i % cols) * (size + gap), cy = y0 + Math.floor(i / cols) * (size + gap), t = waiting[i];
      slots.push({ x: cx, y: cy, size, t: t ? this.place(t, cx + size / 2, cy + size / 2, size * 0.86, t.phase === 'running' ? 'run' : t.phase === 'failed' ? 'fail' : t.phase === 'wait' ? 'wait' : 'human') : null });
    }
    for (let i = n; i < waiting.length; i++) this.shown.set(waiting[i]!.ticketId, { x: x + w / 2, y: y + h / 2 });
    const ty = y + h - (big ? 0.86 : 0.64), th = big ? 0.56 : 0.44, ts = big ? 0.38 : 0.3, max = Math.floor((w - 0.7) / (ts + 0.08));
    /* what no arm takes stays here, in red; the rest is at the quay of its arm */
    const outPlaced: Placed[] = [];
    out.forEach((t, i) => { if (i < max) outPlaced.push(this.place(t, x + 0.4 + ts / 2 + i * (ts + 0.08), ty + th / 2, ts, 'fail')); else this.shown.set(t.ticketId, { x: x + w - 0.5, y: ty + th / 2 }); });
    return {
      kind: 'status', m, big, busy: tickets.length > 0, full: tickets.length >= m.cap, slots, more: waiting.length - n, moreAt: { x: x + w - 0.3, y: y0 - 0.12 },
      out: outPlaced, outBox: out.length ? { x: x + 0.28, y: ty, w: w - 0.56, h: th } : null, quays: this.quays(takers, D),
    };
  }

  private zone(m: ZoneSpec, tickets: FactoryTicket[]): ZoneView {
    const { x, y, w, h } = m;
    const takers = this.takersOf(m), D = this.leavers(m, takers, tickets), held = tickets.filter((t) => !D.quay.has(t.ticketId)), stock = tickets.filter((t) => !t.released).length;
    const pitch = 0.5, cols = Math.max(1, Math.floor((w - 0.5) / pitch)), rows = Math.max(1, Math.floor((h - 1.05) / pitch)), n = cols * rows;
    const ox = x + (w - cols * pitch) / 2 + pitch / 2, oy = y + 0.85 + pitch / 2, placed: Placed[] = [];
    held.forEach((t, i) => {
      /* released and no arm takes it: it is marked as on its way out, and stays */
      if (i < n) placed.push(this.place(t, ox + (i % cols) * pitch, oy + Math.floor(i / cols) * pitch, 0.38, t.released ? 'out' : ''));
      else this.shown.set(t.ticketId, { x: x + w - 0.5, y: y + h - 0.4 });
    });
    return { kind: 'zone', m, held: placed, more: held.length - n, stock, quays: this.quays(takers, D) };
  }

  private dock(m: DeskSpec | IntakeSpec, tickets: FactoryTicket[]): DockView {
    const { x, y, h } = m, intake = m.kind === 'intake', takers = this.takersOf(m), D = this.leavers(m, takers, tickets);
    /* two at most, far enough apart for a pixel skin's icon (eleven pixels of sixteen to the tile); the rest is a count */
    const inDock = tickets.filter((t) => !D.quay.has(t.ticketId)), x0 = x + (intake ? 1.55 : 1.15);
    /* not faded while it waits: what stands in the dock waits by definition (what is let out goes to a quay), HELD says so, and a faded pixel icon loses its outline */
    const held = inDock.slice(0, 2).map((t, i) => this.place(t, x0 + i * 0.72, y + h - 0.52, intake ? 0.3 : 0.34, ''));
    for (const t of inDock.slice(2)) this.shown.set(t.ticketId, { x: x0 + 0.72, y: y + h - 0.52 });
    return {
      kind: 'dock', m, held, more: Math.max(0, inDock.length - 2), quays: this.quays(takers, D), noArm: !takers.length,
      waiting: tickets.filter((t) => !t.released).length, dropped: intake ? this.st.intakes?.[m.id]?.dropped ?? 0 : 0,
      pullFailed: intake && PULLED_SOURCES[m.source] ? !!this.st.intakes?.[m.id]?.pullError : null,
    };
  }

  private port(m: TeleporterSpec, held: FactoryTicket | null, noEntry: { x: number; y: number }[]): PortView {
    const st = this.st, { x, y } = m, cx = x + 0.5, cy = y + 0.5, find = (id: string) => this.byId.get(id), dep = m.role === 'departure';
    const arrival = arrivalOf(m, find), state = portState(m, { arrival, arrivalHolds: !!arrival && !!this.inside.get(arrival.id)?.length, holds: held, takers: dep ? [] : this.takersOf(m) });
    /* a ticket on its way out of here, or into here: see `jumped` */
    const out = this.jumps.find((j) => j.from.id === m.id), into = this.jumps.find((j) => j.to.id === m.id), w = (j: Jump) => j.age / JUMP_S;
    const burst = out && w(out) < 0.5 ? w(out) / 0.5 : into && w(into) > 0.5 ? 1 - (w(into) - 0.5) / 0.5 : 0;
    let placed: Placed | null = null;
    if (held) {
      /* one that is still crossing is not here yet; it is kept in place, so it does not come sliding over the floor */
      if (into && into.id === held.ticketId && w(into) < 0.6) this.shown.set(held.ticketId, { x: cx, y: cy });
      else placed = this.place(held, cx, cy, 0.32, '');
    }
    /* an arm that points into an arrival will never drop there: a no-entry sign on the side it comes from */
    if (!dep) for (let s = 0; s < 4; s++) {
      const n = this.at(m.x - DX[s as 0], m.y - DY[s as 0]);
      if (n && n.kind === 'arm' && n.dir === s) noEntry.push({ x: cx - DX[s as 0] * 0.5, y: cy - DY[s as 0] * 0.5 });
    }
    const bad = portBad(state);
    return {
      kind: 'port', m, dep, state, bad, waiting: state === 'waiting', color: portColor(m, find), burst, held: placed,
      gone: out && w(out) < 0.4 ? { type: out.type, k: 1 - w(out) / 0.4 } : null,
      name: portName(m), line: portLine(m, state, arrival, dep ? 0 : departuresOf(m, st.layout.machines).length),
      asked: st.selMachine === m.id || st.hoverMachine === m.id,
      plate: !this.at(m.x, m.y + 1) ? 'below' : !this.at(m.x, m.y - 1) ? 'above' : 'right',
    };
  }

  // ---------- what leaves and what jumps ----------
  /** A ticket now in an arrival that was, a frame ago, in a departure that leads to it (or in what fed it): it jumped. */
  private jumped(t: FactoryTicket, before: string | null): void {
    const to = t.machineId ? this.byId.get(t.machineId) : null;
    if (!isArrival(to)) return;
    const was = before ? this.byId.get(before) : null;
    const from = was && (was.kind === 'arm' || was.kind === 'belt') ? this.at(was.x + DX[was.dir], was.y + DY[was.dir]) : was;
    if (!isDeparture(from) || from.to !== to.id) return;
    this.jumps.push({ id: t.ticketId, type: t.info?.type ?? '', from, to, age: 0 });
    this.shown.set(t.ticketId, { x: to.x + 0.5, y: to.y + 0.5 });
  }
  /** A ticket that was on its way into an exit when it left the floor: it is seen crossing the frame. Anything else that goes was taken back. */
  private left(ticketId: string, st: ViewState): void {
    const was = this.lastOn.get(ticketId), from = this.shown.get(ticketId), m = was?.m ? this.byId.get(was.m) : null;
    if (!was || !from || !m) return;
    const to = m.kind === 'arm' || m.kind === 'belt' ? this.at(m.x + DX[m.dir], m.y + DY[m.dir]) : m.kind === 'bridge' ? this.at(m.x + was.fx, m.y + was.fy) : null;
    if (!to || to.kind !== 'exit') return;
    const edge = entryOf(to, from);
    this.leavingList.push({ type: was.type, from: { ...from }, edge, exit: to, age: 0, travel: Math.min(0.5, Math.hypot(edge.x - from.x, edge.y - from.y) / (st.beltSpeed || 1.2)) });
    this.passed.set(to.id, (this.passed.get(to.id) ?? 0) + 1);
  }
  /** What leaves by an exit: on to the frame as it was, then an outline that fades towards the middle while the side it came in by lights up. */
  private departures(dt: number): LeavingView[] {
    this.leavingList = this.leavingList.filter((l) => { l.age += dt; return l.age < l.travel + FADE_S && this.byId.has(l.exit.id); });
    return this.leavingList.map((l): LeavingView => {
      const { exit: m, edge, from } = l;
      if (l.age < l.travel) { const k = l.age / l.travel; return { type: l.type, travel: true, x: from.x + (edge.x - from.x) * k, y: from.y + (edge.y - from.y) * k }; }
      const k = (l.age - l.travel) / FADE_S, e = k * k * (3 - 2 * k);
      /* the side lights up where it passed, no further than the side goes */
      const a0 = Math.max(-0.45, edge.ax ? m.x + 0.2 - edge.x : m.y + 0.2 - edge.y), a1 = Math.min(0.45, edge.ax ? m.x + m.w - 0.2 - edge.x : m.y + m.h - 0.2 - edge.y);
      return { type: l.type, travel: false, k, x: edge.x + (m.x + m.w / 2 - edge.x) * e, y: edge.y + (m.y + m.h / 2 - edge.y) * e, m, edge, a0, a1 };
    });
  }
  /** The links between departures and arrivals that show: for the teleporter selected or pointed at, and while a ticket crosses. */
  private links(st: ViewState): LinkView[] {
    const find = (id: string) => this.byId.get(id), arcs = new Map<string, { from: TeleporterSpec; to: TeleporterSpec; packet: number | null }>();
    for (const id of [st.selMachine, st.hoverMachine]) {
      const m = id ? this.byId.get(id) : null;
      if (!isPort(m)) continue;
      const a = arrivalOf(m, find);
      if (a) arcs.set(m.id, { from: m, to: a, packet: null });
      else if (m.role === 'arrival') for (const d of departuresOf(m, st.layout.machines)) arcs.set(d.id, { from: d, to: m, packet: null });
    }
    for (const j of this.jumps) { const w = j.age / JUMP_S; arcs.set(j.from.id, { from: j.from, to: j.to, packet: w > 0.15 && w < 0.85 ? (w - 0.15) / 0.7 : null }); }
    /* arcs that end on the same arrival bend one way then the other, so they do not lie on each other */
    const seen = new Map<string, number>(), out: LinkView[] = [];
    for (const { from, to, packet } of arcs.values()) {
      const n = seen.get(to.id) ?? 0; seen.set(to.id, n + 1);
      const x1 = from.x + 0.5, y1 = from.y + 0.5, x2 = to.x + 0.5, y2 = to.y + 0.5, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
      if (L < 0.01) continue;
      const bend = (n % 2 ? -1 : 1) * 0.2 * (1 + Math.floor(n / 2) * 0.5);
      out.push({ x1, y1, x2, y2, qx: (x1 + x2) / 2 + dy * bend, qy: (y1 + y2) / 2 - dx * bend, trim: Math.min(0.3, 0.6 / L), color: portColor(from, find), hot: packet != null || this.jumps.some((j) => j.from.id === from.id), packet });
    }
    return out;
  }

  // ---------- build mode, and what is carried by hand ----------
  private armWay(x: number, y: number, dir: number, turn: boolean): ArmWay {
    const dx = DX[dir as 0], dy = DY[dir as 0];
    const nameOf = (m: MachineSpec | null): string => (!m ? 'the floor' : m.kind === 'belt' ? 'a belt' : m.kind === 'bridge' ? 'a bridge' : m.kind === 'arm' ? 'an arm' : m.kind === 'label' ? 'the floor' : m.kind === 'teleporter' ? portName(m) : m.name || (m.kind === 'exit' ? 'Exit' : m.kind === 'zone' ? 'Zone' : m.kind === 'desk' ? 'Desk' : m.kind === 'intake' ? 'Intake' : 'Station'));
    const src = this.at(x - dx, y - dy), dst = this.at(x + dx, y + dy);
    /* a teleporter only goes one way: nothing is taken out of a departure, nothing is put into an arrival */
    const idle = isDeparture(src), shut = isArrival(dst);
    return {
      x, y, dir, turn, idle, shut,
      takes: idle ? `TAKES NOTHING · ${nameOf(src)} is a departure` : `TAKES FROM · ${nameOf(src)}`,
      drops: shut ? `NO ENTRY · ${nameOf(dst)} is an arrival` : `DROPS ON · ${nameOf(dst)}`,
    };
  }
  private dropBox(dr: DragState | null): Scene['dropBox'] {
    if (!dr) return null;
    const tx = Math.floor(dr.x), ty = Math.floor(dr.y), m = this.at(tx, ty);
    return m && m.kind !== 'belt' ? { x: m.x, y: m.y, w: m.w, h: m.h } : { x: tx, y: ty, w: 1, h: 1 };
  }
  /** The tickets that carry their name: the ones followed (favourites, the selected one, what a search names), or every one. */
  private named(st: ViewState): Scene['named'] {
    const all = st.allNames === true, out: Scene['named'] = [];
    for (const t of st.tickets) {
      const info = t.info;
      if (!info || st.drag?.ticketId === t.ticketId || st.dim?.has(t.ticketId)) continue;
      if (!all && !info.favorite && st.selTicket !== t.ticketId && !st.named?.has(t.ticketId)) continue;
      const m = this.machine(t.machineId), p = this.shown.get(t.ticketId) ?? { x: t.x + 0.5, y: t.y + 0.5 };
      out.push({ t, x: p.x, y: p.y, box: m && (m.kind === 'station' || m.kind === 'zone' || m.kind === 'desk' || m.kind === 'intake') ? m : null });
    }
    return out;
  }
}
