import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useSkillStore } from '../stores/skillStore';
import { usePanelStore } from '../stores/panelStore';
import { openTicketInWork } from '../components/work/openInWork';
import { toast, useToastOffset } from '../lib/toast';
import { cn } from '../lib/cn';
import { tint } from '../lib/tints';
import { useFactoryStore } from './factoryStore';
import { FactoryMachinePopup } from './FactoryMachinePopup';
import { FactoryFloorPopup } from './FactoryFloorPopup';
import { FactoryConsole } from './FactoryConsole';
import { factoryMenu } from './factoryMenu';
import { byKey, menuAt, type Command } from './menu';
import { FactoryView, type DragState, type Ghost, type ViewState } from './renderer';
import { canPaste, canPlace, clipAt, copyOf, erase, eraseMany, machineAt, machinesIn, moveMany, paintBelts, pasteAt, place, rotate, specFor, update, type Clip, type Tool } from './layoutOps';
import { find, NO_FINDER, type Finder } from './finder';
import { FactoryFinder } from './FactoryFinder';
import { FactoryTicketTip, type TicketTipHandle } from './FactoryTicketTip';
import { FactoryLampTip, type LampTipHandle } from './FactoryLampTip';
import { FactoryNeeds } from './FactoryNeeds';
import { FactoryPeek, type PeekHandle } from './FactoryPeek';
import { needsOf, stepNeed } from './needs';
import { FactoryWorkbench } from './FactoryWorkbench';
import { FactoryPlanModal } from './FactoryPlanModal';
import { FactoryTicketsModal } from './FactoryTicketsModal';
import { loadShow, saveShow, type Show } from './viewToggles';
import { LENS_LABEL, lensLayer, type LensLayer } from './lens';
import { canSetAside, hasPopup, humanCall, needsHuman, RUNS, type Dir, type FactoryLayout, type Lens, type MachineSpec, type Selection, type Target } from './types';

const MINIMAP_EVERY_MS = 150;

const POLL_MS = 600;
const STATS_EVERY_MS = 30_000;
/** Saved selections: keys 1 to 9, then 0. */
const GROUPS = 10;
/** Above this many, the tickets a filter keeps are ringed but not all named: the floor would be covered in text. */
const NAMED_MAX = 30;
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** What was copied or cut in build mode. Kept for the session, so it survives leaving the page and coming back. */
let clipboard: Clip | null = null;
const ARROW = ['→', '↓', '←', '↑'];
/** The build menu: tool, hotkey, label, what it is. */
const TOOLS: [Tool, string, string, string][] = [
  ['belt', 'C', 'Belt', 'Drag to lay belts: each tile points the way you drag'],
  ['bridge', 'H', 'Bridge', 'Where two belts cross: each ticket goes straight across, the lines do not mix'],
  ['arm', 'B', 'Arm', 'Takes from the tile behind it, drops on the tile in front. R turns it'],
  ['agent', 'A', 'Agent', 'A station that runs a persona on the ticket'],
  ['skill', 'S', 'Skill', 'A station that runs a skill'],
  ['panel', 'N', 'Panel', 'A station that runs a panel of personas'],
  ['gate', 'G', 'Gate', 'Waits for your decision; each outcome leaves by its own arm'],
  ['native', 'T', 'Status', 'Sets a status on the ticket and lets it through'],
  ['zone', 'D', 'Zone', 'Tickets wait here until released'],
  ['exit', 'O', 'Exit', 'Sets the ticket to done and hands it back to Fleex'],
  ['label', 'L', 'Label', 'A name on the floor'],
  ['erase', 'X', 'Erase', 'Click or drag to remove machines'],
];

type Press =
  | { kind: 'paint'; last: { x: number; y: number }; did: boolean; draft: FactoryLayout }
  | { kind: 'erase'; draft: FactoryLayout }
  | { kind: 'machine'; id: string; sx: number; sy: number; dragging: boolean; group: string[] }
  | { kind: 'marquee'; x0: number; y0: number }
  | { kind: 'pan' }
  | { kind: 'place' }
  | { kind: 'ticket'; id: string; dragging: boolean }
  | null;

function Disabled() {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-[var(--theme-bg-base)] p-8">
      <div className="max-w-md text-center">
        <div className="text-base font-semibold text-[var(--theme-text-primary)]">The Factory is switched off</div>
        <p className="mt-2 text-sm text-[var(--theme-text-muted)]">It is an experimental feature. Switch it on in Settings › General to open the floor.</p>
      </div>
    </div>
  );
}

function TransferModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (ticketId: string) => void }) {
  const tickets = useTicketStore((s) => s.tickets), fetchTickets = useTicketStore((s) => s.fetchTickets);
  const managed = useFactoryStore((s) => s.managed);
  const [q, setQ] = useState('');
  useEffect(() => { if (open && tickets.length === 0) void fetchTickets(); }, [open, tickets.length, fetchTickets]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => !t.archivedAt && t.status !== 'done' && t.status !== 'cancelled' && !managed.has(t.id) && (!needle || t.title.toLowerCase().includes(needle) || String(t.displayId).includes(needle))).slice(0, 60);
  }, [tickets, managed, q]);
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-xl">
      <div className="flex max-h-[70vh] flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold text-[var(--theme-text-primary)]">Hand tickets over to the Factory</div>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">A ticket you hand over lands in the Inbound zone and waits there. Drag it onto a belt or a machine to start it: from then on the floor drives it, and stations start real agent runs on it.</p>
        </div>
        <Input id="factory-transfer-search" placeholder="Search by title or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {rows.length === 0 && <div className="py-6 text-center text-xs text-[var(--theme-text-muted)]">No open ticket to hand over.</div>}
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border border-[var(--theme-border)] px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">#{t.displayId}</span>{t.title}</span>
              <span className="flex-shrink-0 text-[11px] text-[var(--theme-text-muted)]">{t.status}</span>
              <Button size="sm" onClick={() => onPick(t.id)}>Hand over</Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

export function FactoryPage() {
  const enabled = useFactoryStore((s) => s.enabled);
  const loadStatus = useFactoryStore((s) => s.loadStatus);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  return enabled ? <Floor /> : <Disabled />;
}

function Floor() {
  const store = useFactoryStore();
  const { snapshot, layout } = store;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<FactoryView | null>(null);
  const [view, setView] = useState<FactoryView | null>(null);
  const [building, setBuilding] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [dir, setDir] = useState<Dir>(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [groups, setGroups] = useState<Selection[]>(() => Array.from({ length: GROUPS }, () => null));
  const [finder, setFinder] = useState<Finder>(NO_FINDER);
  const [hasClip, setHasClip] = useState(clipboard !== null);
  const tipRef = useRef<TicketTipHandle>(null);
  const lampTipRef = useRef<LampTipHandle>(null);
  /* the thread of the selected ticket, beside its machine: opened by a click on the ticket, closed by Escape */
  const peekRef = useRef<PeekHandle>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const peekFor = useRef<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const jumpAt = useRef(0);
  const groupsRef = useRef(groups); groupsRef.current = groups;
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [openMachine, setOpenMachine] = useState<string | null>(null);
  const [floorOpen, setFloorOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /* what the floor shows on top of the machines: kept in the browser from one visit to the next */
  const [show, setShow] = useState<Show>(loadShow);
  const flipShow = useCallback((key: keyof Show) => setShow((s) => { const next = { ...s, [key]: !s[key] }; saveShow(next); return next; }), []);
  const [lens, setLens] = useState<Lens>('none');
  const stats = useFactoryStore((s) => s.stats);
  /* the lens is worked out when its inputs change, not at every frame */
  const layer = useMemo<LensLayer | null>(() => (snapshot && layout ? lensLayer(lens, layout, snapshot.tickets, stats, snapshot.serverTime) : null), [lens, layout, snapshot, stats]);
  /* what the filter keeps; the rest is faded on the floor, never hidden */
  const found = useMemo(() => (snapshot ? find(snapshot.tickets, finder, (t) => humanCall(t) !== null) : null), [snapshot, finder]);
  const marks = useMemo(() => {
    if (!found || !snapshot) return { dim: null, found: null, named: null };
    const keep = new Set(found.map((t) => t.ticketId));
    return { dim: new Set(snapshot.tickets.filter((t) => !keep.has(t.ticketId)).map((t) => t.ticketId)), found: keep, named: keep.size <= NAMED_MAX ? keep : null };
  }, [found, snapshot]);
  const live = useRef({ building, tool, dir, selection, lens: layer, marks, hover: null as string | null, hoverLamp: null as string | null, ghost: null as Ghost | null, drag: null as DragState | null, marquee: null as ViewState['marquee'], space: false, show });
  live.current.building = building; live.current.tool = tool; live.current.dir = dir; live.current.selection = selection; live.current.lens = layer; live.current.marks = marks; live.current.show = show;
  const fitted = useRef(false);
  useToastOffset(262);   // keep toasts clear of the console

  // Personas, skills and panels feed the station pickers.
  useEffect(() => {
    if (useAgentPersonaStore.getState().personas.length === 0) void useAgentPersonaStore.getState().loadPersonas();
    if (useSkillStore.getState().skills.length === 0) void useSkillStore.getState().loadSkills();
    if (usePanelStore.getState().panels.length === 0) void usePanelStore.getState().loadPanels();
  }, []);

  // Poll the floor while the page is open.
  useEffect(() => {
    void useFactoryStore.getState().refresh();
    const id = window.setInterval(() => { if (!document.hidden) void useFactoryStore.getState().refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // What the floor did: loaded with the page, then kept fresh while it stays open.
  useEffect(() => {
    void useFactoryStore.getState().loadStats();
    const id = window.setInterval(() => { if (!document.hidden) void useFactoryStore.getState().loadStats(); }, STATS_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  const boardName = useCallback((id: string) => useTicketStore.getState().boards.find((b) => b.id === id)?.name ?? 'a board', []);
  const viewState = useCallback((): ViewState | null => {
    const s = useFactoryStore.getState(), l = live.current;
    if (!s.snapshot || !s.layout) return null;
    return {
      layout: s.layout, tickets: s.snapshot.tickets, arms: new Map(s.snapshot.arms.map((a) => [a.id, { p: a.p, state: a.state ?? 'rest' }])),
      armAge: (performance.now() - s.receivedAt) / 1000, armSwing: s.snapshot.armSwing, boardName,
      selMachine: l.selection && 'machine' in l.selection ? l.selection.machine : null, selMany: l.selection && 'machines' in l.selection ? l.selection.machines : [], marquee: l.marquee, selTicket: l.selection && 'ticket' in l.selection ? l.selection.ticket : null,
      hoverMachine: l.hover, hoverLamp: l.hoverLamp, edit: l.building, ghost: l.ghost, drag: l.drag, lens: l.building ? null : l.lens,
      dim: l.marks.dim, found: l.marks.found, named: l.marks.named,
      allNames: l.show.names, armTags: l.show.arms, numbers: l.show.numbers, grid: l.show.grid,
    };
  }, [boardName]);

  // The draw loop.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const v = new FactoryView(cv); viewRef.current = v; setView(v);
    let raf = 0, last = performance.now(), miniAt = 0;
    const frame = (ts: number) => {
      const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000)); last = ts;
      const st = viewState();
      if (st) {
        if (!fitted.current) { v.fit(st.layout, st.layout.machines.length <= 1); fitted.current = true; }
        v.draw(st, dt);
        if (peekFor.current) { const r = v.anchorOf(peekFor.current, st); if (r) peekRef.current?.place(r); }
        if (ts - miniAt > MINIMAP_EVERY_MS && miniRef.current) { miniAt = ts; v.minimap(miniRef.current, st); }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [viewState]);

  const commit = useCallback((next: FactoryLayout | null) => { if (next) void useFactoryStore.getState().setLayout(next); else toast.warning('No room here'); }, []);
  const removeMachine = useCallback((id: string) => {
    const l = useFactoryStore.getState().layout; if (!l) return;
    commit(erase(l, id)); setSelection((s) => (s && 'machine' in s && s.machine === id ? null : s));
  }, [commit]);
  const patchMachine = useCallback((id: string, patch: Partial<MachineSpec>) => {
    const l = useFactoryStore.getState().layout; if (!l) return;
    const m = l.machines.find((q) => q.id === id); if (!m) return;
    if (('w' in patch || 'h' in patch) && !canPlace(l, { x: m.x, y: m.y, w: patch.w ?? m.w, h: patch.h ?? m.h }, id)) { toast.warning('No room to resize here'); return; }
    // One Inbound zone per floor: ticking it on a zone takes it off the others.
    const base = 'inbound' in patch && patch.inbound ? { ...l, machines: l.machines.map((q) => (q.kind === 'zone' && q.id !== id && q.inbound ? { ...q, inbound: false } : q)) } : l;
    commit(update(base, id, patch));
  }, [commit]);

  const dropTarget = (v: FactoryView, wx: number, wy: number): { target: Target; ok: boolean; can: boolean; text: string } => {
    const tx = Math.floor(wx), ty = Math.floor(wy), m = v.at(tx, ty);
    if (!m) return { target: { x: tx, y: ty }, ok: false, can: true, text: 'On the floor: it will not move by itself' };
    if (m.kind === 'arm' || m.kind === 'label') return { target: {}, ok: false, can: false, text: 'Not on an arm' };
    const dest = m.kind === 'belt' ? v.leadsTo(m) : null;
    return { target: { machineId: m.id }, ok: true, can: true, text: m.kind === 'belt' ? `Belt ${ARROW[m.dir]}${dest ? ` towards ${dest.name ?? dest.kind}` : ': leads nowhere'}` : m.kind === 'exit' ? 'Ship: sets it to done' : `Drop in ${m.name ?? m.kind}` };
  };

  // ---------- pointer ----------
  const press = useRef<Press>(null);
  const moved = useRef(0);
  const lastPt = useRef({ x: 0, y: 0 });
  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const ghostAt = (v: FactoryView, wx: number, wy: number): Ghost | null => {
    const l = useFactoryStore.getState().layout, t = live.current.tool;
    if (!live.current.building || t === 'select' || !l) return null;
    const x = Math.floor(wx), y = Math.floor(wy);
    if (t === 'erase') { const m = machineAt(l, x, y); return { cells: [m ?? { x, y, w: 1, h: 1 }], ok: true, erase: true }; }
    if (t === 'paste') {
      if (!clipboard) return null;
      const cells = clipAt(clipboard, x, y).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h, dir: m.kind === 'belt' || m.kind === 'arm' ? m.dir : undefined }));
      return { cells, ok: canPaste(l, clipboard, x, y), text: cells.length > 1 ? `Paste ${cells.length} machines` : 'Paste' };
    }
    const spec = specFor(t, x, y, live.current.dir); if (!spec) return null;
    return { cells: [{ x: spec.x, y: spec.y, w: spec.w, h: spec.h, dir: spec.kind === 'belt' || spec.kind === 'arm' ? spec.dir : undefined }], ok: canPlace(l, spec) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y);
    moved.current = 0; lastPt.current = p; press.current = null; tipRef.current?.hide(); lampTipRef.current?.hide();
    /* right or middle button, or Space held: move the view, whatever the tool */
    if (e.button !== 0 || live.current.space) { press.current = { kind: 'pan' }; return; }
    if (live.current.building) {
      const t = live.current.tool;
      if (t === 'belt') { store.beginEdit(); press.current = { kind: 'paint', last: { x: tx, y: ty }, did: false, draft: st.layout }; }
      else if (t === 'erase') { store.beginEdit(); const m = machineAt(st.layout, tx, ty); const draft = m ? erase(st.layout, m.id) : st.layout; store.previewLayout(draft); press.current = { kind: 'erase', draft }; }
      else if (t === 'select') {
        const hit = v.pick(p.x, p.y, st, false), m = hit && 'machineId' in hit ? v.machine(hit.machineId) : null;
        if (m) { const sel = live.current.selection, group = sel && 'machines' in sel && sel.machines.includes(m.id) ? sel.machines : [m.id]; press.current = { kind: 'machine', id: m.id, sx: tx, sy: ty, dragging: false, group }; }
        else press.current = { kind: 'marquee', x0: w.x, y0: w.y };
      } else press.current = { kind: 'place' };
    } else {
      const hit = v.pick(p.x, p.y, st, true);
      if (hit && 'ticketId' in hit) press.current = { kind: 'ticket', id: hit.ticketId, dragging: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y), pr = press.current;
    if (e.buttons === 0) {
      const hit = v.pick(p.x, p.y, st, !live.current.building);
      live.current.hover = hit && 'machineId' in hit ? hit.machineId : null;
      live.current.hoverLamp = hit && 'lamp' in hit ? hit.lamp : null;
      live.current.ghost = ghostAt(v, w.x, w.y);
      /* a ticket says what it is as soon as the pointer is over it, and so does a machine's light */
      if (hit && 'ticketId' in hit) tipRef.current?.show(hit.ticketId, p.x, p.y); else tipRef.current?.hide();
      if (hit && 'lamp' in hit) lampTipRef.current?.show(hit.lamp, p.x, p.y); else lampTipRef.current?.hide();
      e.currentTarget.style.cursor = hit && 'lamp' in hit ? 'pointer' : '';
      return;
    }
    const dx = p.x - lastPt.current.x, dy = p.y - lastPt.current.y; moved.current += Math.abs(dx) + Math.abs(dy); lastPt.current = p;
    if (pr?.kind === 'paint') {
      if (tx !== pr.last.x || ty !== pr.last.y) { const r = paintBelts(pr.draft, pr.last, { x: tx, y: ty }); pr.draft = r.layout; pr.last = { x: tx, y: ty }; pr.did = true; if (r.dir != null) setDir(r.dir); store.previewLayout(pr.draft); }
    } else if (pr?.kind === 'erase') {
      const m = machineAt(pr.draft, tx, ty); if (m) { pr.draft = erase(pr.draft, m.id); store.previewLayout(pr.draft); }
    } else if (pr?.kind === 'machine') {
      if (moved.current > 5) {
        pr.dragging = true;
        const ids = new Set(pr.group), ox = tx - pr.sx, oy = ty - pr.sy, cells = st.layout.machines.filter((m) => ids.has(m.id)).map((m) => ({ x: m.x + ox, y: m.y + oy, w: m.w, h: m.h, label: m.kind === 'label' }));
        live.current.ghost = { cells, ok: cells.every((c) => c.label || canPlace(st.layout, c, ids)), text: pr.group.length > 1 ? `Move ${pr.group.length} machines` : 'Move' };
      }
    } else if (pr?.kind === 'marquee') {
      live.current.marquee = { x0: pr.x0, y0: pr.y0, x1: w.x, y1: w.y };
    } else if (pr?.kind === 'ticket') {
      if (moved.current > 5) { pr.dragging = true; const d = dropTarget(v, w.x, w.y); live.current.drag = { ticketId: pr.id, x: w.x, y: w.y, ok: d.ok, text: d.text }; }
    } else if (moved.current > 5) { v.cam.x -= dx / v.cam.z; v.cam.y -= dy / v.cam.z; }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(), pr = press.current; press.current = null;
    if (!v || !st) return;
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y), click = moved.current <= 5;
    if (pr?.kind === 'pan') return;
    if (pr?.kind === 'paint') {
      const final = !pr.did && click ? place(pr.draft, specFor('belt', tx, ty, live.current.dir)!) ?? paintBelts(pr.draft, { x: tx, y: ty }, { x: tx, y: ty }).layout : pr.draft;
      void store.setLayout(final).finally(() => store.endEdit());
    } else if (pr?.kind === 'erase') { void store.setLayout(pr.draft).finally(() => store.endEdit()); }
    else if (pr?.kind === 'machine') {
      const g = live.current.ghost; live.current.ghost = null;
      if (pr.dragging && g) { if (g.ok) commit(moveMany(st.layout, new Set(pr.group), tx - pr.sx, ty - pr.sy)); else toast.warning('No room here'); }
      if (!pr.dragging || pr.group.length === 1) setSelection({ machine: pr.id });
    } else if (pr?.kind === 'marquee') {
      const q = live.current.marquee; live.current.marquee = null;
      const ids = q && !click ? machinesIn(st.layout, q.x0, q.y0, q.x1, q.y1) : [];
      setSelection(ids.length > 1 ? { machines: ids } : ids.length === 1 ? { machine: ids[0]! } : null);
    } else if (pr?.kind === 'place') {
      if (click && live.current.tool === 'paste') {
        const done = clipboard ? pasteAt(st.layout, clipboard, tx, ty) : null;
        if (done) { commit(done.layout); setTool('select'); setSelection(done.ids.length > 1 ? { machines: done.ids } : { machine: done.ids[0]! }); live.current.ghost = null; }
        else toast.warning('No room to paste here');
      } else if (click) {
        const spec = specFor(live.current.tool, tx, ty, live.current.dir), next = spec ? place(st.layout, spec) : null;
        commit(next);
        if (next && spec && spec.kind !== 'arm' && spec.kind !== 'bridge') { setTool('select'); setSelection({ machine: spec.id }); live.current.ghost = null; }
      }
    } else if (pr?.kind === 'ticket') {
      const dr = live.current.drag; live.current.drag = null;
      if (pr.dragging && dr) { const d = dropTarget(v, dr.x, dr.y); if (d.can) void store.move(pr.id, d.target); else toast.warning(d.text); }
      setSelection({ ticket: pr.id }); setPeekOpen(!pr.dragging);
    } else if (click) {
      const hit = v.pick(p.x, p.y, st, !live.current.building);
      if (hit && 'lamp' in hit) {
        /* the light of a machine that runs something is its switch; a gate's only speaks */
        const m = v.machine(hit.lamp);
        if (m?.kind === 'station' && RUNS.includes(m.exec)) void store.power(m.id, !!m.off);
      } else { setSelection(hit ? ('ticketId' in hit ? { ticket: hit.ticketId } : { machine: hit.machineId }) : null); setPeekOpen(!!hit && 'ticketId' in hit); }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => { const v = viewRef.current; if (!v) return; const p = local(e); v.zoomAt(p.x, p.y, Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * (e.ctrlKey ? 0.012 : 0.0022))); };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    const p = local(e), hit = v.pick(p.x, p.y, st, true);
    if (hit && 'ticketId' in hit) { setOpenTicket(hit.ticketId); return; }
    /* a machine opens in its popup: its settings, what it holds, what it did. In build mode too, with nothing in hand */
    const m = hit && 'machineId' in hit && (!live.current.building || live.current.tool === 'select') ? v.machine(hit.machineId) : null;
    if (m && hasPopup(m)) setOpenMachine(m.id);
  };

  // ---------- commands and their keys ----------
  const selMachine = selection && 'machine' in selection && layout ? layout.machines.find((m) => m.id === selection.machine) ?? null : null;
  const selMany = useMemo(() => (selection && 'machines' in selection ? selection.machines : []), [selection]);
  const selTicket = selection && 'ticket' in selection && snapshot ? snapshot.tickets.find((t) => t.ticketId === selection.ticket) ?? null : null;
  const closeMachine = useCallback(() => setOpenMachine(null), []);
  /* from one machine's popup to another's (a station's arm): the floor's selection follows */
  const openMachineOn = useCallback((id: string) => { setSelection({ machine: id }); setOpenMachine(id); }, []);
  /* select a machine and bring it to the middle of the view */
  const showMachine = useCallback((id: string) => {
    const m = useFactoryStore.getState().layout?.machines.find((q) => q.id === id), v = viewRef.current;
    if (!m) return;
    setSelection({ machine: id });
    if (v) { v.cam.x = m.x + m.w / 2; v.cam.y = m.y + m.h / 2; }
  }, []);
  const transferTo = useCallback((ticketId: string) => { void useFactoryStore.getState().transfer(ticketId, {}); }, []);

  const fit = useCallback(() => { const l = useFactoryStore.getState().layout; if (l && viewRef.current) viewRef.current.fit(l, live.current.building || l.machines.length <= 1); }, []);
  /** Centre the view on a ticket and select it. */
  const goTo = useCallback((ticketId: string) => {
    const v = viewRef.current, p = v?.ticketPos(ticketId);
    if (v && p) { v.cam.x = p.x; v.cam.y = p.y; if (v.cam.z < 22) v.cam.z = 22; }
    setSelection({ ticket: ticketId });
  }, []);
  /* what waits for someone: listed top-left, and walked with the left and right arrows */
  const needs = useMemo(() => (snapshot && layout ? needsOf(snapshot.tickets, layout.machines, snapshot.serverTime) : []), [snapshot, layout]);
  const pickNeed = useCallback((ticketId: string) => { goTo(ticketId); setPeekOpen(true); }, [goTo]);
  peekFor.current = peekOpen && selTicket && !building ? selTicket.ticketId : null;
  /* the workbench: a ticket opened over the floor. Moving to another one in it selects that one on the floor too, so the floor is on it when the workbench goes down */
  const openOn = useCallback((ticketId: string) => { setSelection({ ticket: ticketId }); setOpenTicket(ticketId); }, []);
  const closeTicket = useCallback(() => setOpenTicket(null), []);
  /** Enter in the search box: the next ticket found, round and round. */
  const jump = useCallback(() => {
    if (!found?.length) return;
    const t = found[jumpAt.current % found.length]!; jumpAt.current = (jumpAt.current + 1) % found.length;
    goTo(t.ticketId);
  }, [found, goTo]);
  useEffect(() => { jumpAt.current = 0; }, [finder]);

  // ---------- copy, cut, paste (build mode) ----------
  const copy = useCallback((cut: boolean) => {
    const sel = live.current.selection, l = useFactoryStore.getState().layout;
    const ids = sel && 'machines' in sel ? sel.machines : sel && 'machine' in sel ? [sel.machine] : [];
    const clip = l && ids.length ? copyOf(l, new Set(ids)) : null;
    if (!l || !clip) { toast.info('Select one or several machines first'); return; }
    clipboard = clip; setHasClip(true);
    if (cut) { commit(eraseMany(l, new Set(ids))); setSelection(null); }
    toast.info(`${clip.machines.length} machine${clip.machines.length === 1 ? '' : 's'} ${cut ? 'cut' : 'copied'}: ${MOD}V, then click where to put ${clip.machines.length === 1 ? 'it' : 'them'}`);
  }, [commit]);
  const paste = useCallback(() => {
    if (!clipboard) { toast.info('Nothing to paste: copy or cut machines first'); return; }
    setSelection(null); setTool('paste');
  }, []);

  /** A plan is put down like anything copied: it follows the pointer until a click says where. */
  const placePlan = useCallback((clip: Clip, name: string) => {
    clipboard = clip; setHasClip(true); setPlanOpen(false); setSelection(null); setTool('paste');
    /* a plan is often wider than what is on screen: step back until it can be seen whole while it is carried */
    const v = viewRef.current;
    if (v) v.cam.z = Math.max(5, Math.min(v.cam.z, 0.7 * Math.min(v.w / clip.w, v.h / clip.h)));
    toast.info(`Plan “${name}”: click on the floor where it should go. Escape puts it down; ${MOD}V picks it up again.`);
  }, []);

  // The command card: the menu that fits what is selected and the mode, and the sub-menus opened in it.
  const [path, setPath] = useState<string[]>([]);
  const zoneNext = selMachine?.kind === 'zone' ? snapshot?.tickets.filter((t) => t.machineId === selMachine.id && !t.released).sort((a, b) => a.since.localeCompare(b.since))[0] ?? null : null;
  const gate = selTicket ? layout?.machines.find((q) => q.id === selTicket.machineId) : null;
  const root = useMemo(() => factoryMenu({
    building, tool, dir, mod: MOD, many: selMany.length, undoable: store.undoable > 0, redoable: store.redoable > 0, hasClip,
    ticket: selTicket ? { phase: selTicket.phase, released: selTicket.released, favorite: selTicket.info ? selTicket.info.favorite : null, outcomes: gate?.kind === 'station' ? gate.outcomes : [], canAside: canSetAside(selTicket, gate) } : null,
    machine: selMachine ? { kind: selMachine.kind, waiting: !!zoneNext, popup: hasPopup(selMachine), power: selMachine.kind === 'station' && RUNS.includes(selMachine.exec) ? (selMachine.off ? 'off' : 'on') : null } : null,
    act: {
      build: () => { setBuilding(true); setSelection(null); },
      done: () => setBuilding(false),
      intake: () => setTransferOpen(true),
      tickets: () => setListOpen(true),
      fit, plan: () => setPlanOpen(true), paste,
      tool: (t) => setTool((cur) => (cur === t ? 'select' : t)),
      select: () => setTool('select'),
      back: () => { setPath((p) => p.slice(0, -1)); setTool('select'); },
      face: () => setDir((d) => ((d + 1) % 4) as Dir),
      undo: () => void store.undo(), redo: () => void store.redo(),
      copy: () => copy(false), cut: () => copy(true),
      turn: () => { const l = useFactoryStore.getState().layout; if (l && selMachine) commit(rotate(l, selMachine.id)); },
      remove: () => {
        const l = useFactoryStore.getState().layout;
        if (selMany.length > 1) { if (l) commit(eraseMany(l, new Set(selMany))); setSelection(null); }
        else if (selMachine) removeMachine(selMachine.id);
      },
      deselect: () => setSelection(null),
      openTicket: () => { if (selTicket) setOpenTicket(selTicket.ticketId); },
      star: () => { if (selTicket?.info) void store.star(selTicket.ticketId, !selTicket.info.favorite); },
      giveBack: () => { if (selTicket) { void store.giveBack(selTicket.ticketId); setSelection(null); } },
      resolve: (o) => { if (selTicket) void store.resolve(selTicket.ticketId, o); },
      release: () => { if (selTicket) void store.release(selTicket.ticketId); },
      retry: () => { if (selTicket) void store.putBack(selTicket.ticketId); },
      setAside: () => { if (selTicket) void store.setAside(selTicket.ticketId); },
      putBack: (o) => { if (selTicket) void store.putBack(selTicket.ticketId, o); },
      openMachine: () => { if (selMachine && hasPopup(selMachine)) setOpenMachine(selMachine.id); },
      power: () => { if (selMachine?.kind === 'station') void store.power(selMachine.id, !!selMachine.off); },
      floor: () => setFloorOpen(true),
      releaseNext: () => { if (zoneNext) void store.release(zoneNext.ticketId); },
    },
  }), [building, tool, dir, selMany, selTicket, selMachine, gate, zoneNext, hasClip, store, fit, paste, copy, commit, removeMachine]);
  const card = useMemo(() => menuAt(root, path), [root, path]);
  /* a sub-menu belongs to what was on screen when it was opened: selecting something, or leaving build mode, closes it */
  const selKind = selection ? Object.keys(selection)[0] : '';
  useEffect(() => { setPath([]); }, [building, selKind]);
  /* where the card is, from the floor down: Factory › Build › Move */
  const trail = useMemo(() => [...(root.title === 'Factory' ? [] : ['Factory']), ...(building && root.title !== 'Build' ? ['Build'] : []), ...card.titles], [root.title, building, card.titles]);
  const runCommand = useCallback((c: Command) => {
    if (c.disabled) return;
    c.run?.();
    if (c.menu) setPath([...card.path, c.id]);
  }, [card.path]);

  // Saved selections, RTS style: Shift+1…9 and Shift+0 save, the digit alone recalls and centres the view on it.
  const onGroup = useCallback((i: number, save: boolean) => {
    if (save) {
      const cur = live.current.selection;
      if (!cur) { toast.info('Select a machine or a ticket first'); return; }
      setGroups((g) => g.map((x, k) => (k === i ? cur : x)));
      return;
    }
    const g = groupsRef.current[i], s = useFactoryStore.getState(), v = viewRef.current;
    if (!g || !v) return;
    setSelection(g);
    if ('ticket' in g) { const p = v.ticketPos(g.ticket); if (p) { v.cam.x = p.x; v.cam.y = p.y; } }
    else { const id = 'machines' in g ? g.machines[0] : g.machine, m = s.layout?.machines.find((q) => q.id === id); if (m) { v.cam.x = m.x + m.w / 2; v.cam.y = m.y + m.h / 2; } }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      /* a dialog is open (a ticket, a machine, the instructions editor…): the floor's keys are not for it */
      if (transferOpen || openTicket || openMachine || floorOpen || document.querySelector('[data-overlay-top]')) return;
      /* Tab opens the list of the tickets on the floor; in the list, Tab closes it */
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setListOpen(true); return; }
      /* Ctrl/Cmd+Z takes back the last change to the floor, with Shift it puts it back: in build mode only */
      const chord = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey ? e.key.toLowerCase() : '';
      if (live.current.building && (chord === 'c' || chord === 'x' || chord === 'v')) {
        e.preventDefault();
        if (chord === 'v') paste(); else copy(chord === 'x');
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); findRef.current?.focus(); findRef.current?.select(); return; }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z' && live.current.building) {
        e.preventDefault(); setSelection(null);
        void (e.shiftKey ? useFactoryStore.getState().redo() : useFactoryStore.getState().undo());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); live.current.space = true; return; }
      /* out of build mode, left and right walk the tickets that wait for someone; with none, and up and down always, the arrows move the view */
      if (!live.current.building && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const next = stepNeed(needs, selTicket?.ticketId ?? null, e.key === 'ArrowRight' ? 1 : -1);
        if (next) { e.preventDefault(); pickNeed(next); return; }
      }
      if (e.key === 'Enter' && selTicket && !live.current.building) { e.preventDefault(); setOpenTicket(selTicket.ticketId); return; }
      if (e.key === 'Enter' && selMachine && hasPopup(selMachine)) { e.preventDefault(); setOpenMachine(selMachine.id); return; }
      if (e.key === 'Escape' && peekFor.current) { e.preventDefault(); setPeekOpen(false); return; }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (arrow && viewRef.current) { e.preventDefault(); viewRef.current.cam.x += arrow[0]! * 3; viewRef.current.cam.y += arrow[1]! * 3; return; }
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (digit) { e.preventDefault(); onGroup((Number(digit[1]) + GROUPS - 1) % GROUPS, e.shiftKey); return; }
      const key = e.key === 'Backspace' ? 'Delete' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const cmd = byKey(card.menu, key);
      if (cmd) { e.preventDefault(); runCommand(cmd); }
      else if (key === 'F') { e.preventDefault(); fit(); }
      else if (key === 'Escape' && selection) setSelection(null);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') live.current.space = false; };
    /* a key released while the window is elsewhere never says so: let go of it */
    const onBlur = () => { live.current.space = false; };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, [card, runCommand, fit, selection, transferOpen, openTicket, openMachine, floorOpen, onGroup, copy, paste, needs, selTicket, selMachine, pickNeed]);

  const waiting = snapshot ? snapshot.tickets.filter((t) => needsHuman(t)).length : 0;
  const toolHint = building && tool !== 'select' ? TOOLS.find((t) => t[0] === tool)?.[3] : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      <div className="flex w-full items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
        <span className="text-sm text-[var(--theme-text-primary)]">Factory</span>
        <span className="rounded border border-[var(--theme-border-input)] px-1.5 text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]">experimental</span>
        {building && <span className="text-xs text-[var(--theme-accent)]">Building — the floor keeps running</span>}
        {snapshot && <FactoryFinder finder={finder} onChange={setFinder} tickets={snapshot.tickets} found={found} onJump={jump} inputRef={findRef} />}
        <span className="flex-1" />
        {snapshot && <span className="hidden min-w-0 truncate font-mono text-xs text-[var(--theme-text-muted)] 2xl:inline">{snapshot.tickets.length} tickets · {snapshot.running} running · {snapshot.runsLastHour}/{snapshot.floor.settings.maxRunsPerHour} runs this hour{waiting ? ` · ${waiting} waiting for you` : ''}</span>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef} className={cn('absolute inset-0 h-full w-full touch-none', building && tool !== 'select' ? 'cursor-crosshair' : 'cursor-grab')}
            aria-label="Factory floor" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onPointerLeave={() => { live.current.hover = null; live.current.hoverLamp = null; live.current.ghost = null; tipRef.current?.hide(); lampTipRef.current?.hide(); }} onWheel={onWheel} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}
          />
          <FactoryTicketTip ref={tipRef} />
          <FactoryLampTip ref={lampTipRef} />
          {!building && needs.length > 0 && <FactoryNeeds needs={needs} selected={selTicket?.ticketId ?? null} onPick={pickNeed} onOpen={setOpenTicket} />}
          {peekFor.current && <FactoryPeek ref={peekRef} key={peekFor.current} ticketId={peekFor.current} onOpen={() => setOpenTicket(peekFor.current)} onClose={() => setPeekOpen(false)} />}
          {snapshot?.notice && (
            <div className={cn('absolute inset-x-3 top-3 z-10 mx-auto flex max-w-3xl items-start gap-3 rounded-lg px-3 py-2 text-xs shadow-lg', tint('yellow'))} role="status">
              <span className="min-w-0 flex-1">{snapshot.notice}</span>
              <Button size="sm" onClick={() => void store.ackNotice()}>Got it</Button>
            </div>
          )}
          {layer && !building && (
            <div className={cn('absolute top-3 flex max-w-[min(560px,calc(100%-24px))] items-center gap-2 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 shadow-lg', needs.length ? 'left-[292px]' : 'left-3')} role="status">
              <span className="flex-none text-xs font-semibold text-[var(--theme-text-primary)]">{LENS_LABEL[layer.kind]}</span>
              <span className="min-w-0 flex-1 text-[11px] text-[var(--theme-text-secondary)]">{layer.legend}{layer.kind !== 'load' && stats && layer.values.size === 0 ? ' — nothing to show yet.' : ''}</span>
              <Button size="sm" variant="ghost" onClick={() => setLens('none')}>Off</Button>
            </div>
          )}
          {layout && layout.machines.length <= 1 && !building && snapshot && snapshot.tickets.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4 text-center">
                <div className="text-sm font-semibold text-[var(--theme-text-primary)]">The floor is empty</div>
                <p className="mt-1 text-xs text-[var(--theme-text-muted)]">Build belts, arms and stations, then hand tickets over: they land in the Inbound zone, and you drag them onto the floor to start them.</p>
                <div className="mt-3"><Button variant="primary" size="sm" onClick={() => setBuilding(true)}>Build</Button></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <FactoryConsole view={view} snapshot={snapshot} layout={layout} selection={selection} onSelect={setSelection} menu={card.menu} trail={trail} onRun={runCommand} groups={groups} onGroup={onGroup} miniRef={miniRef} lens={lens} onLens={setLens} onFit={fit} show={show} onShow={flipShow}
        title={building ? 'Build' : 'Factory floor'}
        hint={toolHint ?? (building ? 'Pick a machine to place, or double-click one to set it up. Drag on empty floor to select several, then drag one of them to move them all. Right-drag, Space+drag or the arrow keys move the view.' : 'Click to select, drag a ticket to move it, double-click a ticket or a machine to open it. Tab lists the tickets, hovering one shows what it is, / finds one.')} />
      {/* a ticket opened from a machine's window covers it: closing the ticket brings the window back */}
      {openMachine && !openTicket && view && <FactoryMachinePopup machineId={openMachine} view={view} onClose={closeMachine} onPatch={patchMachine} onRemove={removeMachine} onOpenTicket={setOpenTicket} onOpenMachine={openMachineOn} />}
      {floorOpen && <FactoryFloorPopup onClose={() => setFloorOpen(false)} onGoTo={showMachine} />}
      {openTicket && <FactoryWorkbench ticketId={openTicket} needs={needs} tickets={snapshot?.tickets ?? []} onNavigate={openOn} onClose={closeTicket} />}
      {planOpen && <FactoryPlanModal onPlace={placePlan} onClose={() => setPlanOpen(false)} />}
      {listOpen && !openTicket && <FactoryTicketsModal finder={finder} onFinder={setFinder} onClose={() => setListOpen(false)}
        onGoTo={(id) => { setListOpen(false); setBuilding(false); goTo(id); }} onDetail={(id) => { setListOpen(false); setOpenTicket(id); }} />}
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} onPick={transferTo} />
    </div>
  );
}
