/**
 * A workflow, as a plan to put down on the floor: one station per step, one
 * arm per way out, and the belts between them. The plan is a starting point,
 * laid out to be correct rather than pretty: once on the floor it is ordinary
 * machines, to move and rewire like any others.
 *
 * How it is laid out
 * - Steps go in columns, left to right, by how far they are from the entry
 *   (loops back are ignored for that); steps of one column are stacked.
 * - A step feeding the step right next to it, on the same line, gets a straight
 *   belt.
 * - Every other way out goes down its own column to its own row under the
 *   stations, along that row to the column of the step it leads to, and up into
 *   it. Belts that lead to the same step merge; where two belts cross, a bridge
 *   carries each straight across. A loop back is just a row that runs west.
 * - Tickets come in by a zone before the entry step and gather in a zone after
 *   the last ones.
 *
 * What a station concludes is one word, its outcome. A step that branches on one
 * field of its own output (`path` is `fast`, `decision` is not `reject`…) keeps
 * those values as outcomes. Any other condition cannot be evaluated here: the
 * outcomes are then named after the ways out, and the plan says so.
 */
import { TICKET_STATUSES, type EdgeConditionClause, type TicketStatus, type WorkflowEdge, type WorkflowStep, type WorkflowTemplate } from '@fleex/shared';
import type { Clip } from './layoutOps';
import type { ArmCondition, Dir, MachineSpec, StationSpec } from './types';

export interface WorkflowPlan {
  clip: Clip;
  /** What could not be carried over as it was, in plain words: shown before the plan is placed. */
  warnings: string[];
  counts: { stations: number; arms: number; belts: number; bridges: number };
}

/** A machine before it is given its place. Distributes over the kinds, so each keeps its own fields. */
type Unplaced<T = MachineSpec> = T extends unknown ? Omit<T, 'x' | 'y'> : never;

const EAST: Dir = 0, SOUTH: Dir = 1, WEST: Dir = 2, NORTH: Dir = 3;
/** The room every step is given: wide and high enough for a station, which is a machine of 5 by 4 tiles. */
const SLOT_W = 5, SLOT_H = 4;
/** Vertical distance between two stations of one column, and room under the last one before the rows of belts. */
const PITCH = SLOT_H + 2, UNDER = 2;

let seq = 0;
const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p${Date.now().toString(36)}${(seq++).toString(36)}`);

interface Node {
  key: string;
  step: WorkflowStep | null;
  layer: number; row: number;
  /** Top-left of its slot; the machine sits in it, flush with the slot's east side. */
  sx: number; sy: number;
  machine: MachineSpec;
  /** Rows of its east side an arm can stand against, from the top of the slot. */
  armRows: number[];
  /** Column of the belt that climbs into it, when ways in other than a straight one exist. */
  trunk: number | null;
  /** The column its arms drop on. */
  land: number;
}
interface Link {
  from: Node; to: Node; when: ArmCondition[];
  armRow: number; direct: boolean;
  /** Routed links: the column it goes down, and the row it travels along. */
  down: number; bus: number;
}

const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/** The comparisons an edge carries: its group's clauses, or its older single condition. Empty for a default edge. */
function clausesOf(e: WorkflowEdge): { match: 'all' | 'any'; clauses: EdgeConditionClause[] } {
  if (e.conditionGroup?.clauses.length) return { match: e.conditionGroup.match, clauses: e.conditionGroup.clauses };
  if (e.condition) return { match: 'all', clauses: [{ field: e.condition.field, operator: e.condition.operator, value: e.condition.value }] };
  return { match: 'all', clauses: [] };
}
const valuesOf = (c: EdgeConditionClause): string[] => (Array.isArray(c.value) ? c.value : c.value == null ? [] : [c.value]).map(String);

/**
 * An edge's condition as a condition on the outcome, when the step branches on one field of its own output with
 * "is" / "is not" comparisons only. Null when it says more than that.
 */
function onOutcome(e: WorkflowEdge, stepId: string, field: string): ArmCondition | null {
  const { match, clauses } = clausesOf(e);
  if (!clauses.length || clauses.some((c) => (c.stepId && c.stepId !== stepId) || c.field !== field || c.caseInsensitive)) return null;
  const positive = clauses.every((c) => c.operator === 'eq' || c.operator === 'in'), negative = clauses.every((c) => c.operator === 'neq' || c.operator === 'not_in');
  const values = [...new Set(clauses.flatMap(valuesOf))];
  if (!values.length) return null;
  /* "a or b" is one "is a, b"; "not a and not b" is one "is not a, b"; anything else needs more than one word */
  if (positive && (match === 'any' || clauses.length === 1)) return { field: 'outcome', op: 'is', values };
  if (negative && (match === 'all' || clauses.length === 1)) return { field: 'outcome', op: 'is_not', values };
  return null;
}

interface Routing { outcomes: string[]; when: Map<string, ArmCondition[]>; warning?: string }

/** What a step's station concludes, and what each of its ways out asks of that conclusion. */
function routingOf(step: WorkflowStep, outs: WorkflowEdge[], nameOf: (id: string) => string): Routing {
  const gate = step.executorType === 'human_gate';
  const base = gate ? (step.humanGateOutcomes?.length ? step.humanGateOutcomes : ['approve', 'reject']) : ['ok'];
  const when = new Map<string, ArmCondition[]>();
  if (outs.length <= 1) { for (const e of outs) when.set(e.id, []); return { outcomes: base, when }; }

  const conditional = outs.filter((e) => !e.isDefault && clausesOf(e).clauses.length > 0);
  const fields = new Set(conditional.flatMap((e) => clausesOf(e).clauses.map((c) => c.field)));
  const field = fields.size === 1 ? [...fields][0]! : null;
  const translated = field ? conditional.map((e) => onOutcome(e, step.id, field)) : [];
  if (field && conditional.length >= outs.length - 1 && translated.every(Boolean)) {
    conditional.forEach((e, i) => when.set(e.id, [translated[i]!]));
    for (const e of outs) if (!when.has(e.id)) when.set(e.id, []);
    const named = [...new Set(translated.flatMap((c) => (c!.op === 'is' ? c!.values : [])))];
    const known = gate ? base : step.outputSchema?.properties[field]?.enum ?? [];
    const outcomes = [...new Set([...known, ...named])];
    /* a way out taken "otherwise" needs a word the station can say for it */
    if (outcomes.length <= named.length && (outs.length > conditional.length || translated.some((c) => c!.op === 'is_not'))) outcomes.push('other');
    return { outcomes: outcomes.length ? outcomes : base, when };
  }

  /* conditions the floor cannot evaluate: each way out gets a name, and the station is asked to say one */
  const used = new Set<string>(), outcomes: string[] = [];
  for (const e of outs) {
    let name = slug(e.label || '') || slug(`to ${nameOf(e.target)}`) || 'way';
    for (let i = 2; used.has(name); i++) name = `${name.replace(/-\d+$/, '')}-${i}`;
    used.add(name); outcomes.push(name);
    when.set(e.id, e.isDefault ? [] : [{ field: 'outcome', op: 'is', values: [name] }]);
  }
  return { outcomes, when, warning: `“${step.name}” chooses its way out on conditions the floor cannot evaluate. Its outcomes are named after its ways out (${outcomes.join(', ')}): say in its instructions when to give each.` };
}

/** The machine a step becomes, with what could not be carried over. */
function machineOf(step: WorkflowStep, outcomes: string[], branching: boolean, warn: (w: string) => void): { machine: Unplaced; small: boolean } {
  const id = newId(), name = step.name || step.executorType;
  const station = (over: Partial<StationSpec>): Omit<StationSpec, 'x' | 'y'> => ({ id, kind: 'station', w: SLOT_W, h: SLOT_H, name, exec: 'agent', outcomes, cap: 2, ...over });
  switch (step.executorType) {
    case 'agent': return { machine: station({ exec: 'agent', ref: step.executorRef, mode: step.mode ?? 'edit', prompt: step.prompt ?? '' }), small: false };
    case 'skill': return { machine: station({ exec: 'skill', ref: step.executorRef, prompt: step.prompt ?? '' }), small: false };
    case 'panel': return { machine: station({ exec: 'panel', ref: step.executorRef, prompt: step.prompt ?? '' }), small: false };
    case 'human_gate': return { machine: station({ exec: 'human_gate', cap: 8 }), small: false };
    case 'native': {
      const actions = step.nativeActions ?? [], status = actions.find((a) => a.operationId === 'ticket.set_status')?.params['status'];
      const sets = typeof status === 'string' && (TICKET_STATUSES as readonly string[]).includes(status) ? (status as TicketStatus) : undefined;
      const others = actions.filter((a) => a.operationId !== 'ticket.set_status' || !sets).map((a) => a.operationId);
      if (others.length) warn(`“${name}” runs ${others.join(', ')}: a status station only sets a status${sets ? '' : ', so this one lets the ticket through unchanged'}.`);
      if (step.forEach) warn(`“${name}” repeats its actions for each item of a list: that is not carried over.`);
      return { machine: station({ exec: 'native', w: 2, h: 2, outcomes: ['ok'], cap: 3, sets }), small: true };
    }
    case 'route':
      if (branching) { warn(`“${name}” is a routing step: here it is a gate where you choose the way out, until arms sort the tickets on what they are.`); return { machine: station({ exec: 'human_gate', name: `Route: ${name}`, cap: 8 }), small: false }; }
      return { machine: station({ exec: 'native', w: 2, h: 2, outcomes: ['ok'], cap: 3, sets: undefined }), small: true };
    default:
      warn(step.executorType === 'workflow'
        ? `“${name}” is the sub-workflow ${step.executorRef}: it is a zone here. Import that workflow as its own plan and connect the two.`
        : `“${name}” is a kind of step the floor does not know (${String(step.executorType)}): it is a zone here.`);
      return { machine: { id, kind: 'zone', w: 3, h: 3, name: step.executorType === 'workflow' ? `Sub-workflow: ${step.executorRef}` : name, status: '', release: 'manual' }, small: false };
  }
}

export function planFromWorkflow(t: WorkflowTemplate): WorkflowPlan {
  const warnings: string[] = [], warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };
  const steps = new Map(t.steps.map((s) => [s.id, s]));
  const edges = t.edges.filter((e) => steps.has(e.source) && steps.has(e.target) && e.source !== e.target);
  if (edges.length < t.edges.length) warn('Some connections lead nowhere or loop on their own step: they are left out.');
  const outsOf = (id: string) => edges.filter((e) => e.source === id);
  const entry = steps.has(t.entryStepId) ? t.entryStepId : t.steps[0]?.id;

  // ---- which edges loop back, and how far from the entry each step is ----
  const back = new Set<string>(), state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const e of outsOf(id)) { const s = state.get(e.target) ?? 0; if (s === 1) back.add(e.id); else if (s === 0) visit(e.target); }
    state.set(id, 2);
  };
  if (entry) visit(entry);
  for (const s of t.steps) if (!state.has(s.id)) visit(s.id);
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const known = depth.get(id); if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(0, ...edges.filter((e) => e.target === id && !back.has(e.id)).map((e) => depthOf(e.source, seen) + 1));
    depth.set(id, d); return d;
  };
  for (const s of t.steps) depthOf(s.id);

  // ---- nodes: a zone to come in by, the steps, a zone to gather in ----
  const nodes: Node[] = [], byStep = new Map<string, Node>();
  const blank = (key: string, step: WorkflowStep | null, layer: number, machine: Unplaced, small: boolean): Node => {
    /* an arm can stand against each row of the machine's east side; row 1 first, which is the one a straight belt leaves by */
    const rows = Array.from({ length: machine.h }, (_, i) => i), armRows = [1, ...rows.filter((r) => r > 1), 0].filter((r) => r < machine.h);
    void small;
    const n: Node = { key, step, layer, row: 0, sx: 0, sy: 0, machine: { ...machine, x: 0, y: 0 } as MachineSpec, armRows, trunk: null, land: 0 };
    nodes.push(n); return n;
  };
  const inZone = blank('in', null, 0, { id: newId(), kind: 'zone', w: 3, h: 3, name: `${t.name} · in`, status: '', release: 'auto' }, false);
  const routing = new Map<string, Routing>();
  const nameOf = (id: string) => steps.get(id)?.name ?? 'the next step';
  for (const s of t.steps) {
    const outs = outsOf(s.id), r = routingOf(s, outs, nameOf);
    const branching = outs.length > 1;
    /* a routing step has nothing that could say an outcome: its arms cannot ask for one */
    if (s.executorType === 'native' && branching) { warn(`“${s.name}” has several ways out, but a status station says nothing to choose between them: only the first is wired.`); for (const e of outs.slice(1)) r.when.delete(e.id); r.when.set(outs[0]!.id, []); }
    else if (r.warning && s.executorType !== 'route') warn(r.warning);
    routing.set(s.id, r);
    const { machine, small } = machineOf(s, r.outcomes, branching, warn);
    byStep.set(s.id, blank(s.id, s, (depth.get(s.id) ?? 0) + 1, machine, small));
  }
  const last = Math.max(0, ...nodes.map((n) => n.layer));
  const ends = t.steps.filter((s) => outsOf(s.id).length === 0);
  const outZone = ends.length ? blank('out', null, last + 1, { id: newId(), kind: 'zone', w: 3, h: 3, name: `${t.name} · out`, status: '', release: 'manual' }, false) : null;

  const layers: Node[][] = [];
  for (const n of nodes) (layers[n.layer] ??= []).push(n);
  for (const col of layers) {
    if (!col) continue;
    col.sort((a, b) => Number(b.key === entry) - Number(a.key === entry) || (a.step?.position.y ?? 0) - (b.step?.position.y ?? 0) || (a.step?.position.x ?? 0) - (b.step?.position.x ?? 0));
    col.forEach((n, i) => { n.row = i; n.sy = i * PITCH; });
  }

  // ---- links: the ways out, each with the arm row it leaves by ----
  const links: Link[] = [];
  const link = (from: Node, to: Node, when: ArmCondition[]) => links.push({ from, to, when, armRow: -1, direct: false, down: 0, bus: 0 });
  if (entry) link(inZone, byStep.get(entry)!, []);
  for (const s of t.steps) for (const e of outsOf(s.id)) { const when = routing.get(s.id)!.when.get(e.id); if (when) link(byStep.get(s.id)!, byStep.get(e.target)!, when); }
  if (outZone) for (const s of ends) link(byStep.get(s.id)!, outZone, []);
  for (const n of nodes) {
    const mine = links.filter((l) => l.from === n), free = [...n.armRows];
    const straight = mine.find((l) => l.to.layer === n.layer + 1 && l.to.row === n.row);
    if (straight) { straight.direct = true; straight.armRow = 1; free.splice(free.indexOf(1), 1); }
    /* the lower rows first: their belts turn down at once, without crossing the others */
    free.sort((a, b) => b - a);
    for (const l of mine) if (l !== straight) l.armRow = free.shift() ?? -1;
    const lost = mine.filter((l) => l.armRow < 0);
    if (lost.length) warn(`“${n.machine.name}” has ${mine.length} ways out and room for ${n.armRows.length} arms: ${lost.map((l) => `the one to “${l.to.machine.name}”`).join(', ')} ${lost.length > 1 ? 'are' : 'is'} not wired.`);
  }
  const wired = links.filter((l) => l.armRow >= 0), routed = wired.filter((l) => !l.direct);

  // ---- columns ----
  let x = 0;
  for (const col of layers) {
    if (!col) continue;
    for (const n of col) if (routed.some((l) => l.to === n)) n.trunk = x++;
    x += 1;                                        // the last tile of the belts that enter the column's stations
    for (const n of col) { n.sx = x; n.land = x + SLOT_W + 1; }
    x += SLOT_W + 2;                               // the stations, their arms, and the tiles the arms drop on
    for (const n of col) for (const l of routed.filter((q) => q.from === n).sort((a, b) => b.armRow - a.armRow)) l.down = x++;
    x += 1;
  }
  const floor = Math.max(...nodes.map((n) => n.sy)) + SLOT_H + UNDER;
  routed.forEach((l, i) => { l.bus = floor + i; });

  // ---- belts ----
  const tiles = new Map<string, { x: number; y: number; dir: Dir; bridge: boolean }>();
  let clash = false;
  const lay = (tx: number, ty: number, dir: Dir): void => {
    const k = `${tx},${ty}`, t0 = tiles.get(k);
    if (!t0) { tiles.set(k, { x: tx, y: ty, dir, bridge: false }); return; }
    if (t0.dir === dir || (t0.bridge && (t0.dir + dir) % 2 === 0)) return;          // the same belt, shared by what leads to the same step
    if ((t0.dir + dir) % 2 === 1) { t0.bridge = true; return; }                     // two belts cross: a bridge
    clash = true;
  };
  const place = (n: Node): void => { const m = n.machine; m.x = n.sx + SLOT_W - m.w; m.y = n.sy; };
  for (const n of nodes) place(n);
  for (const n of nodes) {
    if (n.trunk === null) continue;
    for (let i = n.trunk; i < n.machine.x; i++) lay(i, n.sy + 1, EAST);
    const deepest = Math.max(...routed.filter((l) => l.to === n).map((l) => l.bus));
    for (let j = n.sy + 2; j <= deepest; j++) lay(n.trunk, j, NORTH);
  }
  for (const l of wired) {
    const y0 = l.from.sy + l.armRow;
    if (l.direct) { for (let i = l.from.land; i < (l.to.trunk ?? l.to.machine.x); i++) lay(i, y0, EAST); continue; }
    for (let i = l.from.land; i < l.down; i++) lay(i, y0, EAST);
    for (let j = y0; j < l.bus; j++) lay(l.down, j, SOUTH);
    const to = l.to.trunk!;
    if (to > l.down) for (let i = l.down; i < to; i++) lay(i, l.bus, EAST);
    else for (let i = l.down; i > to; i--) lay(i, l.bus, WEST);
  }
  if (clash) warn('Two belts of this plan run into each other: check the connections once it is placed.');

  // ---- the machines, from the top-left corner of the plan ----
  const machines: MachineSpec[] = nodes.map((n) => n.machine);
  for (const l of wired) machines.push({ id: newId(), kind: 'arm', x: l.from.sx + SLOT_W, y: l.from.sy + l.armRow, w: 1, h: 1, dir: EAST, when: l.when });
  for (const b of tiles.values()) machines.push(b.bridge ? { id: newId(), kind: 'bridge', x: b.x, y: b.y, w: 1, h: 1 } : { id: newId(), kind: 'belt', x: b.x, y: b.y, w: 1, h: 1, dir: b.dir });
  machines.push({ id: newId(), kind: 'label', x: Math.min(...machines.map((m) => m.x)), y: -2, w: 1, h: 1, text: `${t.emoji ? `${t.emoji} ` : ''}${t.name}` });
  const x0 = Math.min(...machines.map((m) => m.x)), y0 = Math.min(...machines.map((m) => m.y));
  for (const m of machines) { m.x -= x0; m.y -= y0; }
  if (!t.steps.length) warn('This workflow has no step.');
  return {
    clip: { w: Math.max(...machines.map((m) => m.x + m.w)), h: Math.max(...machines.map((m) => m.y + m.h)), machines },
    warnings,
    counts: {
      stations: machines.filter((m) => m.kind === 'station').length, arms: machines.filter((m) => m.kind === 'arm').length,
      belts: machines.filter((m) => m.kind === 'belt').length, bridges: machines.filter((m) => m.kind === 'bridge').length,
    },
  };
}
