import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { usePanelStore } from '../../stores/panelStore';
import { useTicketStore } from '../../stores/ticketStore';
import { toast, useToastAnchor } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { MobileSheet } from '../../mobile/MobileSheet';
import { useMobileNavStore } from '../../mobile/mobileNavStore';
import { dropAt, type Drop } from '../dropTarget';
import { useFactoryStore } from '../factoryStore';
import { span, since } from '../format';
import { frameGap, MAX_STEP_S } from '../frameRate';
import { TicketToken } from '../FactoryTicketMeta';
import { needsOf, standing } from '../needs';
import { FactoryView, type ViewState } from '../renderer';
import { isBox } from '../scene';
import { stationModel, modelTag } from '../stationModel';
import { RUNS, type DeskSpec, type FactoryTicket, type MachineSpec, type StationSpec } from '../types';
import { useFactorySkin } from '../useFactorySkin';
import { BTN, TicketActsBar, useLastWord } from './MobileFactoryActs';
import { NeedChip } from './MobileFactoryTickets';
import { gestures } from './gestures';
import { dropPoint, FAR_Z, farBadges, nearestTicket, putLine, toScreen } from './mapTouch';
import { useMobileFactoryStore } from './mobileFactoryStore';
import { askOf } from './ticketActs';
import { placeLook, shortState } from './ticketList';

const NONE: string[] = [];
/** A frame due within that is asked for at the next refresh of the screen; else a little before it is due (as the page does). */
const SOON_MS = 12, EARLY_MS = 4;
/** How far a finger may wander, in pixels, and still have tapped; and how near a ticket it must land to mean it. */
const TAP_SLOP = 10, PICK_PX = 26;
/** The zoom a jump to a ticket brings to when the view was farther: as on the page. */
const CLOSE_Z = 22;
/** Where the view was when the map was last left: coming back to it does not start over. */
let keptCam: { x: number; y: number; z: number } | null = null;
/** Test hook: forget where the view was. */
export const forgetMapView = (): void => { keptCam = null; };

type Sel = { ticket: string } | { machine: string } | null;

/**
 * The floor on the phone: the page's own view (`FactoryView`, the skin chosen in Settings), moved by touch. One finger
 * moves it, two fingers zoom, a tap opens the sheet of what was touched: a machine with the tickets it holds, or a
 * ticket with its buttons. Seen from far, each place carries how many tickets it holds. A ticket taken in hand is put
 * down in two taps: where, then yes. Nothing is built from here.
 */
export function MobileFactoryMap({ onNewTicket }: { onNewTicket: (desk: DeskSpec) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null), badgeRef = useRef<HTMLCanvasElement>(null), viewRef = useRef<FactoryView | null>(null);
  const { make: makeSkin, key: skinKey } = useFactorySkin(), skinRef = useRef(makeSkin);
  skinRef.current = makeSkin;
  const snapshot = useFactoryStore((s) => s.snapshot);
  const hand = useMobileFactoryStore((s) => s.hand), pending = useMobileFactoryStore((s) => s.pending);
  const [sel, setSel] = useState<Sel>(null);
  const [drop, setDrop] = useState<(Drop & { x: number; y: number }) | null>(null);
  const live = useRef({ sel, hand, drop });
  live.current = { sel, hand, drop };
  const wokeAt = useRef(performance.now()), owed = useRef(true), hurry = useRef<() => void>(() => {});
  /* over the map the bottom of the screen is where one acts (Next, the ticket in hand, a sheet): what is said goes at the top */
  useToastAnchor('top');
  /** Where the view is gliding to, in tiles. */
  const goal = useRef<{ x: number; y: number } | null>(null);
  const wake = useCallback(() => { wokeAt.current = performance.now(); owed.current = true; hurry.current(); }, []);
  useEffect(() => { wake(); }, [sel, hand, drop, wake]);
  useEffect(() => { if (!hand) setDrop(null); else setSel(null); }, [hand]);

  // Personas, skills and panels: the model written under a station.
  useEffect(() => {
    if (useSkillStore.getState().skills.length === 0) void useSkillStore.getState().loadSkills();
    if (usePanelStore.getState().panels.length === 0) void usePanelStore.getState().loadPanels();
    void useFactoryStore.getState().loadStats();
  }, []);

  const boardName = useCallback((id: string) => useTicketStore.getState().boards.find((b) => b.id === id)?.name ?? 'a board', []);
  const modelOf = useCallback((m: StationSpec) => stationModel(m, { personas: useAgentPersonaStore.getState().personas, skills: useSkillStore.getState().skills, panels: usePanelStore.getState().panels }), []);
  const viewState = useCallback((): ViewState | null => {
    const s = useFactoryStore.getState(), l = live.current;
    if (!s.snapshot || !s.layout) return null;
    const halted = s.snapshot.floor.settings.halted === true;
    return {
      layout: s.layout, tickets: s.snapshot.tickets, arms: new Map(s.snapshot.arms.map((a) => [a.id, { p: a.p, state: a.state ?? 'rest' }])),
      halted, armAge: halted ? 0 : (performance.now() - s.receivedAt) / 1000, armSwing: s.snapshot.armSwing, beltSpeed: s.snapshot.beltSpeed, fastBelt: s.snapshot.fastBelt, boardName, modelOf,
      selMachine: l.drop?.target.machineId ?? (l.sel && 'machine' in l.sel ? l.sel.machine : null), selMany: NONE, marquee: null,
      selTicket: l.hand ?? (l.sel && 'ticket' in l.sel ? l.sel.ticket : null), hoverMachine: null, edit: false, ghost: null,
      /* the ticket in hand is shown where it would go, with what putting it there does */
      drag: l.hand && l.drop ? { ticketId: l.hand, x: l.drop.x, y: l.drop.y, ok: l.drop.ok, text: l.drop.text } : null,
      armTags: true, grid: false, exits: s.stats?.exits ?? null, exitDays: s.stats?.days, intakes: s.snapshot.intakes ?? null,
    };
  }, [boardName, modelOf]);

  // The draw loop: paced as the page's is (frameRate.ts), so a floor at rest costs a phone next to nothing.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const v = new FactoryView(cv, skinRef.current()); viewRef.current = v;
    /* for whoever measures, or drives the map from a script: the view, in development only */
    if (import.meta.env.DEV) (window as unknown as { __mfv?: FactoryView }).__mfv = v;
    let raf = 0, timer = 0, last = performance.now(), placed = false;
    owed.current = true;
    const again = (wait: number) => {
      if (wait <= SOON_MS) { raf = requestAnimationFrame(frame); return; }
      timer = window.setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, wait - EARLY_MS);
    };
    hurry.current = () => { if (!timer) return; window.clearTimeout(timer); timer = 0; raf = requestAnimationFrame(frame); };
    const gap = () => { const snap = useFactoryStore.getState().snapshot; return frameGap({ sinceWake: performance.now() - wokeAt.current, focused: !document.hidden, running: !!snap && snap.floor.settings.halted !== true, moving: v.moving || goal.current !== null }); };
    const frame = (ts: number) => {
      const wait = gap() - (ts - last);
      if (wait > EARLY_MS / 2 && !owed.current) { again(wait); return; }
      owed.current = false;
      const dt = Math.min(MAX_STEP_S, Math.max(0, (ts - last) / 1000)); last = ts;
      const st = viewState();
      if (st) {
        if (!placed) { placed = true; v.fit(st.layout, false); if (keptCam) v.cam = { ...keptCam }; }
        const g = goal.current;
        if (g) {
          const k = 1 - Math.exp(-dt * 10);
          v.cam.x += (g.x - v.cam.x) * k; v.cam.y += (g.y - v.cam.y) * k;
          if (Math.abs(g.x - v.cam.x) + Math.abs(g.y - v.cam.y) < 0.03) goal.current = null;
        }
        v.draw(st, dt);
        paintBadges(badgeRef.current, v, st);
        /* a ticket asked for from elsewhere (its screen, Next): once the floor has drawn it, go to it */
        const want = useMobileFactoryStore.getState().goTo;
        if (want) {
          const p = v.ticketPos(want);
          if (p) { if (v.cam.z < CLOSE_Z) v.cam.z = CLOSE_Z; goal.current = { x: p.x, y: p.y + (v.h * 0.22) / v.cam.z }; setSel({ ticket: want }); }
          if (p || !st.tickets.some((t) => t.ticketId === want)) useMobileFactoryStore.getState().arrived();
        }
      }
      again(gap());
    };
    raf = requestAnimationFrame(frame);
    const unsub = useFactoryStore.subscribe((s, was) => { if (s.snapshot !== was.snapshot || s.layout !== was.layout || s.stats !== was.stats) { owed.current = true; hurry.current(); } });
    const unsubGo = useMobileFactoryStore.subscribe((s, was) => { if (s.goTo !== was.goTo) { owed.current = true; hurry.current(); } });
    /* where the view was is kept only once it was somewhere: a view that never drew a frame has nothing to come back to */
    return () => { if (placed) keptCam = { ...v.cam }; cancelAnimationFrame(raf); window.clearTimeout(timer); hurry.current = () => {}; unsub(); unsubGo(); viewRef.current = null; };
  }, [viewState]);
  const skinShown = useRef(skinKey);
  useEffect(() => { if (skinShown.current !== skinKey) { skinShown.current = skinKey; viewRef.current?.setSkin(makeSkin()); wake(); } }, [skinKey, makeSkin, wake]);

  /** Bring a place of the floor into the part of the view a sheet leaves in sight. */
  const lookAt = useCallback((x: number, y: number, close = false) => {
    const v = viewRef.current; if (!v) return;
    if (close && v.cam.z < CLOSE_Z) v.cam.z = CLOSE_Z;
    goal.current = { x, y: y + (v.h * 0.22) / v.cam.z }; wake();
  }, [wake]);
  const openTicketOnMap = useCallback((ticketId: string) => {
    const p = viewRef.current?.ticketPos(ticketId);
    if (p) lookAt(p.x, p.y, true);
    setSel({ ticket: ticketId });
  }, [lookAt]);
  const openMachineOnMap = useCallback((m: MachineSpec) => { lookAt(m.x + m.w / 2, m.y + m.h / 2); setSel({ machine: m.id }); }, [lookAt]);

  // ---------- touch ----------
  const fingers = useRef(new Map<number, { x: number; y: number }>()), moved = useRef(0), apart = useRef(0);
  const local = (e: { clientX: number; clientY: number }) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const spread = () => { const [a, b] = [...fingers.current.values()]; return a && b ? { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null; };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!fingers.current.size) moved.current = 0;
    fingers.current.set(e.pointerId, local(e));
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone */ }
    if (fingers.current.size === 2) { apart.current = spread()?.d ?? 0; moved.current = TAP_SLOP; }
    goal.current = null; wake();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, was = fingers.current.get(e.pointerId); if (!v || !was) return;
    const now = local(e);
    fingers.current.set(e.pointerId, now);
    if (fingers.current.size === 1) { v.cam.x -= (now.x - was.x) / v.cam.z; v.cam.y -= (now.y - was.y) / v.cam.z; moved.current += Math.abs(now.x - was.x) + Math.abs(now.y - was.y); }
    else { const s = spread(); if (s && apart.current > 0 && s.d > 0) { v.pinch(s.x, s.y, s.d / apart.current); apart.current = s.d; } }
    wake();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const was = fingers.current.get(e.pointerId); if (!was) return;
    fingers.current.delete(e.pointerId);
    apart.current = 0;
    if (!fingers.current.size && moved.current < TAP_SLOP && e.type === 'pointerup') tap(was);
    wake();
  };
  const tap = (at: { x: number; y: number }) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    v.use(st.layout);
    const w = v.toWorld(at.x, at.y);
    if (live.current.hand) {
      const d = dropAt(v, st.tickets, w.x, w.y);
      if (!d.can) { toast.warning(d.text); return; }
      setDrop({ ...d, ...dropPoint(d.target.machineId ? v.machine(d.target.machineId) : null, w.x, w.y) });
      return;
    }
    const hit = v.pick(at.x, at.y, st, false), m = hit && 'machineId' in hit ? v.machine(hit.machineId) : null, box = m && isBox(m) ? m : null;
    const near = nearestTicket(v.ticketPlaces(), v, at, PICK_PX);
    /* seen from far, a place is touched before the tickets in it, which are too small to mean one of them */
    if (box && (v.cam.z < FAR_Z || !near)) openMachineOnMap(box);
    else if (near) openTicketOnMap(near);
    else setSel(null);
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => { const v = viewRef.current; if (!v) return; const p = local(e); v.wheel(p.x, p.y, e.deltaY, e.ctrlKey, e.deltaMode === 1); goal.current = null; wake(); };
  const zoom = (factor: number) => { const v = viewRef.current; if (v) { v.zoomAt(v.w / 2, v.h / 2, factor); goal.current = null; wake(); } };
  const fit = () => { const v = viewRef.current, l = useFactoryStore.getState().layout; if (v && l) { v.fit(l, false); goal.current = null; wake(); } };

  // ---------- what is selected, in hand, waiting ----------
  const machines = snapshot?.floor.layout.machines;
  const byId = useMemo(() => new Map((machines ?? []).map((m) => [m.id, m])), [machines]);
  const ticketOf = (id: string | null) => (id ? snapshot?.tickets.find((t) => t.ticketId === id) ?? null : null);
  const selTicket = sel && 'ticket' in sel ? ticketOf(sel.ticket) : null, selMachine = sel && 'machine' in sel ? byId.get(sel.machine) ?? null : null;
  const inHand = ticketOf(hand);
  useEffect(() => { if (sel && !selTicket && !selMachine) setSel(null); }, [sel, selTicket, selMachine]);
  useEffect(() => { if (hand && snapshot && !inHand) useMobileFactoryStore.getState().letGo(); }, [hand, snapshot, inHand]);
  const needs = useMemo(() => (snapshot ? needsOf(snapshot.tickets.filter((t) => !t.item && !pending[t.ticketId]), snapshot.floor.layout.machines, snapshot.serverTime) : []), [snapshot, pending]);
  const next = () => {
    if (!needs.length) return;
    const at = sel && 'ticket' in sel ? needs.findIndex((n) => n.ticket.ticketId === sel.ticket) : -1;
    openTicketOnMap(needs[(at + 1) % needs.length]!.ticket.ticketId);
  };
  const put = () => {
    if (!inHand || !drop) return;
    const into = drop.target.machineId ? byId.get(drop.target.machineId) ?? null : null;
    gestures.put(inHand, drop.target, putLine(into));
    useMobileFactoryStore.getState().letGo();
  };

  const above = { bottom: 'calc(max(26px, env(safe-area-inset-bottom)) + 76px)' }, aboveHand = { bottom: 'calc(max(26px, env(safe-area-inset-bottom)) + 148px)' };
  const fab = 'flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] text-xl text-[var(--theme-text-secondary)] active:bg-[var(--theme-bg-overlay)]';
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ touchAction: 'none' }} aria-label="Factory floor"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} />
      <canvas ref={badgeRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      {!snapshot && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--theme-text-muted)]">Reading the floor…</div>}

      {/* where the thumb is: the ticket in hand, and the two taps that put it down */}
      {inHand && (
        <div className="absolute inset-x-3 z-10 flex items-center gap-2 rounded-2xl border border-[var(--theme-success)] bg-[var(--theme-bg-surface)] px-3 py-2 shadow-lg" style={above} role="status" aria-label="Ticket in hand">
          <span className="min-w-0 flex-1 text-[13px] text-[var(--theme-text-primary)]">
            <b>#{inHand.info?.displayId ?? '?'}</b> {drop ? <span>here? <span className={drop.ok ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-warning)]'}>{drop.text}</span></span> : 'in hand: touch where it goes'}
          </span>
          <button type="button" className={cn(BTN.ghost, 'max-w-[76px]')} onClick={() => useMobileFactoryStore.getState().letGo()}>Cancel</button>
          {drop && <button type="button" className={cn(BTN.go, 'max-w-[110px]')} onClick={put}>Put it there</button>}
        </div>
      )}

      {!inHand && needs.length > 0 && (
        <button type="button" onClick={next} style={above} aria-label={`Next ticket that needs you, of ${needs.length}`}
          className="absolute left-3 flex h-11 items-center gap-2 rounded-full bg-[var(--theme-warning)] px-4 text-[14px] font-bold text-[var(--theme-bg-base)] shadow-lg">
          Next <span className="rounded-full bg-[color-mix(in_srgb,var(--theme-bg-base)_22%,transparent)] px-2 py-px font-mono text-[11px]">{needs.length}</span>
        </button>
      )}
      <div className="absolute right-3 flex flex-col gap-1.5" style={inHand ? aboveHand : above}>
        <button type="button" className={fab} onClick={() => zoom(1.5)} aria-label="Zoom in">+</button>
        <button type="button" className={fab} onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">−</button>
        <button type="button" className={fab} onClick={fit} aria-label="See what is built">⤢</button>
      </div>

      {selMachine && <MachineSheet machine={selMachine} tickets={snapshot?.tickets ?? []} now={snapshot?.serverTime ?? ''} onClose={() => setSel(null)} onTicket={openTicketOnMap} onNewTicket={(d) => { setSel(null); onNewTicket(d); }} modelOf={modelOf} />}
      {selTicket && !hand && <TicketSheet ticket={selTicket} machine={selTicket.machineId ? byId.get(selTicket.machineId) ?? null : null} now={snapshot?.serverTime ?? ''} onClose={() => setSel(null)} />}
    </div>
  );
}

/** Over each place seen from far: how many tickets it holds, in amber when one of them waits for someone. Paint, on any theme, like the floor's lamps. */
function paintBadges(cv: HTMLCanvasElement | null, v: FactoryView, st: ViewState): void {
  const ctx = cv?.getContext('2d'); if (!cv || !ctx) return;
  const w = Math.max(1, Math.round(v.w * v.dpr)), h = Math.max(1, Math.round(v.h * v.dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  if (v.cam.z >= FAR_Z) return;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const b of farBadges(st.layout, st.tickets)) {
    const c = toScreen(v, b.x + b.w / 2, b.y + b.h / 2), side = Math.min(b.w, b.h) * v.cam.z;
    if (side < 14 || c.x < -20 || c.y < -20 || c.x > v.w + 20 || c.y > v.h + 20) continue;
    const r = Math.max(9, Math.min(15, side * 0.36)), text = String(b.count), half = Math.max(r, (text.length * r * 0.62 + r) / 2);
    ctx.beginPath(); ctx.roundRect(c.x - half, c.y - r, half * 2, r * 2, r);
    ctx.fillStyle = b.needs ? '#fbbf24' : 'rgba(9, 9, 11, 0.86)'; ctx.fill();
    if (!b.needs) { ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = b.needs ? '#231a02' : '#fafafa'; ctx.font = `700 ${Math.round(r * 1.15)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(text, c.x, c.y + 0.5);
  }
}

const row = 'flex min-h-[52px] items-center gap-2.5 border-b border-[var(--theme-border-subtle)] py-1';

/** A place of the floor, touched: what it is, how it stands, and the tickets it holds. A zone lets them out from here. */
function MachineSheet({ machine: m, tickets, now, onClose, onTicket, onNewTicket, modelOf }: {
  machine: MachineSpec; tickets: readonly FactoryTicket[]; now: string; onClose: () => void; onTicket: (ticketId: string) => void; onNewTicket: (desk: DeskSpec) => void; modelOf: (m: StationSpec) => string | null;
}) {
  const pending = useMobileFactoryStore((s) => s.pending), waiting = pending[m.id];
  const look = placeLook(m), here = tickets.filter((t) => t.machineId === m.id), held = m.kind === 'zone' ? here.filter((t) => !t.item && t.phase === 'zone' && !t.released && !pending[t.ticketId]) : [];
  const station = m.kind === 'station' ? m : null, runs = !!station && RUNS.includes(station.exec), model = station ? modelOf(station) : null;
  const says = station
    ? runs ? `${model ? `${modelTag(model)} · ` : ''}${here.filter((t) => t.phase === 'running').length}/${station.cap} at work${station.off ? ' · switched off: it takes tickets in and starts nothing' : ''}`
      : station.exec === 'human_gate' ? `${here.length} to decide` : 'Sets a status on what goes through'
    : m.kind === 'zone' ? (m.needsYou ? 'Its tickets wait for you: release one when your part is done.' : m.release === 'auto' ? 'It lets tickets out by itself.' : 'Nothing leaves until it is released.')
    : m.kind === 'desk' ? 'Where a ticket is born on the floor.' : m.kind === 'intake' ? 'Where items come in from their source.' : 'A ticket that reaches it is done, and leaves the floor.';
  return (
    <MobileSheet grabber onClose={onClose}>
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] font-bold tracking-wider text-[var(--theme-text-muted)]" style={look.hue ? { color: look.hue } : undefined}>{look.word}</span>
          <b className="block truncate text-[17px] font-semibold text-[var(--theme-text-primary)]">{look.title}</b>
        </span>
        {waiting && <button type="button" className={cn(BTN.ghost, 'max-w-[130px]')} onClick={() => useMobileFactoryStore.getState().undo(m.id)}>Undo release</button>}
        {!waiting && held.length > 1 && <button type="button" className={cn(BTN.go, 'max-w-[130px]')} onClick={() => gestures.releaseAll(m, held)}>Release all</button>}
      </div>
      <p className="mt-1 text-[12.5px] text-[var(--theme-text-secondary)]">{says}</p>
      {station && station.outcomes.length > 0 && <p className="mt-1 font-mono text-[11px] text-[var(--theme-text-muted)]">leaves as: {station.outcomes.join(' · ')}</p>}
      <div className="mt-2">
        {here.length === 0 && m.kind !== 'desk' && <p className="py-3 text-[12.5px] text-[var(--theme-text-muted)]">It holds nothing.</p>}
        {here.map((t) => {
          const st = shortState(t, m), going = !!pending[t.ticketId] || (!!waiting && t.phase === 'zone' && !t.released);
          return (
            <div key={t.ticketId} className={cn(row, going && 'opacity-50')}>
              <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => onTicket(t.ticketId)}>
                <TicketToken info={t.info} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-[var(--theme-text-primary)]">{t.item ? '' : <span className="mr-1.5 font-mono text-[12px] text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'}</span>}{t.info?.title ?? t.ticketId}</span>
                  <span className={cn('block text-[12px]', st.needs && !going ? 'font-semibold text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{going ? 'leaving…' : `${st.text} · ${span(since(t.since, now))}`}</span>
                </span>
              </button>
              {held.includes(t) && !waiting && <button type="button" className={cn(BTN.plain, 'max-w-[92px]')} onClick={() => gestures.release(t, m)}>Release</button>}
            </div>
          );
        })}
      </div>
      {m.kind === 'desk' && <div className="mt-3 flex"><button type="button" className={BTN.accent} onClick={() => onNewTicket(m)}>New ticket here</button></div>}
    </MobileSheet>
  );
}

/** A ticket of the floor, touched: where it stands, what was last said, its buttons, and the two ways on: take it in hand, or open it. */
function TicketSheet({ ticket: t, machine, now, onClose }: { ticket: FactoryTicket; machine: MachineSpec | null; now: string; onClose: () => void }) {
  const ask = askOf(t, machine), { where, state } = standing(t, machine);
  const word = useLastWord(t.ticketId, t.since, !t.item && (ask?.kind === 'decision' || ask?.kind === 'question'));
  const open = () => { onClose(); useMobileNavStore.getState().openTicket(t.ticketId, 'conversation'); };
  const said = t.item ? t.item.excerpt : ask?.kind === 'failed' ? t.note : word?.body ?? '';
  return (
    <MobileSheet grabber onClose={onClose}>
      <div className="flex items-start gap-2.5">
        <TicketToken info={t.info} size={24} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <b className="block text-[16px] font-semibold leading-snug text-[var(--theme-text-primary)]">{!t.item && <span className="mr-1.5 font-mono text-[12px] font-medium text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'}</span>}{t.info?.title ?? t.ticketId}</b>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--theme-text-secondary)]">{ask && <NeedChip kind={ask.kind} />}<span>{where} · {state} · {span(since(t.since, now))}</span></span>
        </span>
      </div>
      {said && <p className={cn('mt-2.5 line-clamp-4 rounded-xl bg-[var(--theme-bg-surface)] px-3 py-2 text-[13px] text-[var(--theme-text-secondary)]', ask?.kind === 'failed' && 'font-mono text-[12px]')}>{said}</p>}
      {t.item ? (
        <p className="mt-2.5 text-[12.5px] text-[var(--theme-text-muted)]">An item from {t.item.source}{t.item.author ? `, by ${t.item.author}` : ''}. Items are read and archived on the desktop for now.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <TicketActsBar ticket={t} machine={machine} word={word} onReply={open} />
          <div className="flex gap-2">
            <button type="button" className={BTN.plain} onClick={() => { onClose(); useMobileFactoryStore.getState().take(t.ticketId); }}>Take</button>
            <button type="button" className={BTN.plain} onClick={open}>Open</button>
          </div>
        </div>
      )}
    </MobileSheet>
  );
}
