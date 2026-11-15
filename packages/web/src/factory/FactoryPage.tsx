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
import { useFactoryStore } from './factoryStore';
import { FactoryInspector, type Selection } from './FactoryInspector';
import { FactoryView, isBox, type DragState, type Ghost, type ViewState } from './renderer';
import { canPlace, erase, machineAt, move, paintBelts, place, rotate, specFor, update, type Tool } from './layoutOps';
import { needsHuman, type Dir, type FactoryLayout, type MachineSpec, type Target } from './types';

const POLL_MS = 600;
const ARROW = ['→', '↓', '←', '↑'];
/** The build menu: tool, hotkey, label, what it is. */
const TOOLS: [Tool, string, string, string][] = [
  ['belt', 'C', 'Belt', 'Drag to lay belts: each tile points the way you drag'],
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
  | { kind: 'machine'; id: string; ox: number; oy: number; dragging: boolean }
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
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">A ticket you hand over lands in the zone that matches its status. From then on the floor drives it: stations start real agent runs on it.</p>
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
  const live = useRef({ building, tool, dir, selection, hover: null as string | null, ghost: null as Ghost | null, drag: null as DragState | null });
  live.current.building = building; live.current.tool = tool; live.current.dir = dir; live.current.selection = selection;
  const fitted = useRef(false);
  useToastOffset(56);   // keep toasts clear of the command bar

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

  const viewState = useCallback((): ViewState | null => {
    const s = useFactoryStore.getState(), l = live.current;
    if (!s.snapshot || !s.layout) return null;
    return {
      layout: s.layout, tickets: s.snapshot.tickets, arms: new Map(s.snapshot.arms.map((a) => [a.id, a.p])),
      selMachine: l.selection && 'machine' in l.selection ? l.selection.machine : null, selTicket: l.selection && 'ticket' in l.selection ? l.selection.ticket : null,
      hoverMachine: l.hover, edit: l.building, ghost: l.ghost, drag: l.drag,
    };
  }, []);

  // The draw loop.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const v = new FactoryView(cv); viewRef.current = v; setView(v);
    let raf = 0, last = performance.now();
    const frame = (ts: number) => {
      const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000)); last = ts;
      const st = viewState();
      if (st) { if (!fitted.current) { v.fit(st.layout, st.layout.machines.length === 0); fitted.current = true; } v.draw(st, dt); }
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
    commit(update(l, id, patch));
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
    const spec = specFor(t, x, y, live.current.dir); if (!spec) return null;
    return { cells: [{ x: spec.x, y: spec.y, w: spec.w, h: spec.h, dir: spec.kind === 'belt' || spec.kind === 'arm' ? spec.dir : undefined }], ok: canPlace(l, spec) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y);
    moved.current = 0; lastPt.current = p; press.current = null;
    if (live.current.building) {
      const t = live.current.tool;
      if (t === 'belt') { store.beginEdit(); press.current = { kind: 'paint', last: { x: tx, y: ty }, did: false, draft: st.layout }; }
      else if (t === 'erase') { store.beginEdit(); const m = machineAt(st.layout, tx, ty); const draft = m ? erase(st.layout, m.id) : st.layout; store.previewLayout(draft); press.current = { kind: 'erase', draft }; }
      else if (t === 'select') { const hit = v.pick(p.x, p.y, st, false); if (hit && 'machineId' in hit) { const m = v.machine(hit.machineId); if (m) press.current = { kind: 'machine', id: m.id, ox: tx - m.x, oy: ty - m.y, dragging: false }; } }
      else press.current = { kind: 'place' };
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
      live.current.ghost = ghostAt(v, w.x, w.y);
      return;
    }
    const dx = p.x - lastPt.current.x, dy = p.y - lastPt.current.y; moved.current += Math.abs(dx) + Math.abs(dy); lastPt.current = p;
    if (pr?.kind === 'paint') {
      if (tx !== pr.last.x || ty !== pr.last.y) { const r = paintBelts(pr.draft, pr.last, { x: tx, y: ty }); pr.draft = r.layout; pr.last = { x: tx, y: ty }; pr.did = true; if (r.dir != null) setDir(r.dir); store.previewLayout(pr.draft); }
    } else if (pr?.kind === 'erase') {
      const m = machineAt(pr.draft, tx, ty); if (m) { pr.draft = erase(pr.draft, m.id); store.previewLayout(pr.draft); }
    } else if (pr?.kind === 'machine') {
      if (moved.current > 5) { pr.dragging = true; const m = v.machine(pr.id); if (m) { const gx = tx - pr.ox, gy = ty - pr.oy; live.current.ghost = { cells: [{ x: gx, y: gy, w: m.w, h: m.h }], ok: canPlace(st.layout, { x: gx, y: gy, w: m.w, h: m.h }, m.id), text: 'Move' }; } }
    } else if (pr?.kind === 'ticket') {
      if (moved.current > 5) { pr.dragging = true; const d = dropTarget(v, w.x, w.y); live.current.drag = { ticketId: pr.id, x: w.x, y: w.y, ok: d.ok, text: d.text }; }
    } else if (moved.current > 5) { v.cam.x -= dx / v.cam.z; v.cam.y -= dy / v.cam.z; }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(), pr = press.current; press.current = null;
    if (!v || !st) return;
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y), click = moved.current <= 5;
    if (pr?.kind === 'paint') {
      const final = !pr.did && click ? place(pr.draft, specFor('belt', tx, ty, live.current.dir)!) ?? paintBelts(pr.draft, { x: tx, y: ty }, { x: tx, y: ty }).layout : pr.draft;
      void store.setLayout(final).finally(() => store.endEdit());
    } else if (pr?.kind === 'erase') { void store.setLayout(pr.draft).finally(() => store.endEdit()); }
    else if (pr?.kind === 'machine') {
      const g = live.current.ghost; live.current.ghost = null;
      if (pr.dragging && g?.cells[0]) { if (g.ok) commit(move(st.layout, pr.id, g.cells[0].x, g.cells[0].y)); else toast.warning('No room here'); }
      setSelection({ machine: pr.id });
    } else if (pr?.kind === 'place') {
      if (click) {
        const spec = specFor(live.current.tool, tx, ty, live.current.dir), next = spec ? place(st.layout, spec) : null;
        commit(next);
        if (next && spec && spec.kind !== 'arm') { setTool('select'); setSelection({ machine: spec.id }); }
      }
    } else if (pr?.kind === 'ticket') {
      const dr = live.current.drag; live.current.drag = null;
      if (pr.dragging && dr) { const d = dropTarget(v, dr.x, dr.y); if (d.can) void store.move(pr.id, d.target); else toast.warning(d.text); }
      setSelection({ ticket: pr.id });
    } else if (click) {
      const hit = v.pick(p.x, p.y, st, !live.current.building);
      setSelection(hit ? ('ticketId' in hit ? { ticket: hit.ticketId } : { machine: hit.machineId }) : null);
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => { const v = viewRef.current; if (!v) return; const p = local(e); v.zoomAt(p.x, p.y, Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * (e.ctrlKey ? 0.012 : 0.0022))); };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    const p = local(e), hit = v.pick(p.x, p.y, st, true);
    if (hit && 'ticketId' in hit) openTicketInWork(hit.ticketId);
  };

  // ---------- commands and their keys ----------
  const selMachine = selection && 'machine' in selection && layout ? layout.machines.find((m) => m.id === selection.machine) ?? null : null;
  const selTicket = selection && 'ticket' in selection && snapshot ? snapshot.tickets.find((t) => t.ticketId === selection.ticket) ?? null : null;
  const transferTo = useCallback((ticketId: string) => {
    const s = useFactoryStore.getState(), t = useTicketStore.getState().tickets.find((q) => q.id === ticketId), zones = (s.layout?.machines ?? []).filter((m) => m.kind === 'zone');
    const zone = zones.find((z) => z.kind === 'zone' && z.status === t?.status) ?? zones[0];
    void s.transfer(ticketId, zone ? { machineId: zone.id } : { x: 1, y: 1 });
    if (!zone) toast.info('No zone on the floor yet: the ticket was put down at the top-left corner');
  }, []);

  interface Cmd { key: string; label: string; run: () => void; primary?: boolean; active?: boolean; title?: string; danger?: boolean }
  const commands: Cmd[] = useMemo(() => {
    const out: Cmd[] = [];
    const fit = () => { const l = useFactoryStore.getState().layout; if (l && viewRef.current) viewRef.current.fit(l, building || l.machines.length === 0); };
    if (selTicket) {
      const m = layout?.machines.find((q) => q.id === selTicket.machineId);
      if (selTicket.phase === 'review' && m?.kind === 'station') m.outcomes.slice(0, 4).forEach((o, i) => out.push({ key: 'QWER'[i]!, label: o, primary: i === 0, run: () => void store.resolve(selTicket.ticketId, o) }));
      if (selTicket.phase === 'zone' && !selTicket.released) out.push({ key: 'Q', label: 'Release', primary: true, run: () => void store.release(selTicket.ticketId) });
      if (selTicket.phase === 'failed' || selTicket.phase === 'question') out.push({ key: 'Q', label: 'Run again', primary: true, run: () => void store.retry(selTicket.ticketId) });
      out.push({ key: 'V', label: 'Open ticket', run: () => openTicketInWork(selTicket.ticketId) });
      out.push({ key: 'X', label: 'Give back', title: 'Take this ticket out of the Factory', run: () => { void store.giveBack(selTicket.ticketId); setSelection(null); } });
    } else if (selMachine && (!building || tool === 'select')) {
      if (selMachine.kind === 'belt' || selMachine.kind === 'arm') out.push({ key: 'R', label: 'Turn', run: () => { const l = useFactoryStore.getState().layout; if (l) commit(rotate(l, selMachine.id)); } });
      if (selMachine.kind === 'zone') out.push({ key: 'L', label: 'Release next', primary: true, run: () => { const next = snapshot?.tickets.filter((t) => t.machineId === selMachine.id && !t.released).sort((a, b) => a.since.localeCompare(b.since))[0]; if (next) void store.release(next.ticketId); } });
      out.push({ key: 'Delete', label: 'Remove', danger: true, run: () => removeMachine(selMachine.id) });
    } else if (building) {
      for (const [t, key, label, title] of TOOLS) out.push({ key, label, title, active: tool === t, run: () => setTool((cur) => (cur === t ? 'select' : t)) });
      out.push({ key: 'R', label: `Facing ${ARROW[dir]}`, title: 'Direction of the belts and arms you place', run: () => setDir((d) => ((d + 1) % 4) as Dir) });
    } else {
      out.push({ key: 'B', label: 'Build', primary: true, title: 'Lay belts, arms, stations and zones', run: () => { setBuilding(true); setSelection(null); } });
      out.push({ key: 'T', label: 'Hand tickets over', run: () => setTransferOpen(true) });
    }
    out.push({ key: 'F', label: 'Fit', run: fit });
    if (building) out.push({ key: 'Escape', label: tool !== 'select' ? 'Drop tool' : selection ? 'Deselect' : 'Done', run: () => { if (tool !== 'select') setTool('select'); else if (selection) setSelection(null); else setBuilding(false); } });
    return out;
  }, [selTicket, selMachine, building, tool, dir, selection, layout, snapshot, store, commit, removeMachine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || transferOpen) return;
      const key = e.key === 'Backspace' ? 'Delete' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const cmd = commands.find((c) => c.key === key);
      if (cmd) { e.preventDefault(); cmd.run(); }
      else if (key === 'Escape' && selection) setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands, selection, transferOpen]);

  const waiting = snapshot ? snapshot.tickets.filter((t) => needsHuman(t)).length : 0;
  const toolHint = building && tool !== 'select' ? TOOLS.find((t) => t[0] === tool)?.[3] : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      <div className="flex w-full items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
        <span className="text-sm text-[var(--theme-text-primary)]">Factory</span>
        <span className="rounded border border-[var(--theme-border-input)] px-1.5 text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]">experimental</span>
        {building && <span className="text-xs text-[var(--theme-accent)]">Building — the floor keeps running</span>}
        <span className="flex-1" />
        {snapshot && <span className="font-mono text-xs text-[var(--theme-text-muted)]">{snapshot.tickets.length} tickets · {snapshot.running} running · {snapshot.runsLastHour}/{snapshot.floor.settings.maxRunsPerHour} runs this hour{waiting ? ` · ${waiting} waiting for you` : ''}</span>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef} className={cn('absolute inset-0 h-full w-full touch-none', building && tool !== 'select' ? 'cursor-crosshair' : 'cursor-grab')}
            aria-label="Factory floor" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onPointerLeave={() => { live.current.hover = null; live.current.ghost = null; }} onWheel={onWheel} onDoubleClick={onDoubleClick}
          />
          {layout && layout.machines.length === 0 && !building && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4 text-center">
                <div className="text-sm font-semibold text-[var(--theme-text-primary)]">The floor is empty</div>
                <p className="mt-1 text-xs text-[var(--theme-text-muted)]">Start with a zone for incoming tickets, an arm against it, a belt, then a station. Nothing moves until you hand a ticket over.</p>
                <div className="mt-3"><Button variant="primary" size="sm" onClick={() => setBuilding(true)}>Build</Button></div>
              </div>
            </div>
          )}
        </div>
        <FactoryInspector selection={selection} view={view} onSelect={setSelection} onPatch={patchMachine} onRemove={removeMachine} onTransfer={() => setTransferOpen(true)} building={building} />
      </div>
      <div className="flex min-h-[52px] items-center gap-3 border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-xs text-[var(--theme-text-secondary)]">
          {selTicket ? <>#{selTicket.info?.displayId ?? '?'} {selTicket.info?.title}</>
            : selMachine ? <>{selMachine.name || selMachine.kind}{isBox(selMachine) && snapshot ? ` · ${snapshot.tickets.filter((t) => t.machineId === selMachine.id).length} inside` : ''}</>
            : toolHint ?? (building ? 'Pick a machine to place, or click one to set it up.' : 'Click to select, drag a ticket to move it, double-click a ticket to open it.')}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5" role="toolbar" aria-label="Factory commands">
          {commands.map((c) => (
            <Button key={c.key + c.label} size="sm" variant={c.primary ? 'primary' : c.danger ? 'danger' : c.active ? 'secondary' : 'ghost'} title={c.title} onClick={c.run} aria-pressed={c.active}
              className={cn(c.active && 'ring-1 ring-[var(--theme-accent)]')}>
              <kbd className="mr-1.5 font-mono text-[10px] opacity-70">{c.key === 'Escape' ? 'Esc' : c.key === 'Delete' ? 'Del' : c.key}</kbd>{c.label}
            </Button>
          ))}
        </div>
      </div>
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} onPick={transferTo} />
    </div>
  );
}
