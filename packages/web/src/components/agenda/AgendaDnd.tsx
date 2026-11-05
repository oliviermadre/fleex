/**
 * Drag & drop on /agenda with native pointer events (no library).
 *
 * Drop targets are plain DOM attributes, so every view can take a drop
 * without wiring: `data-agenda-col="YYYY-MM-DD"` on a day column of the hour
 * grid (the pointer's y gives the time) and `data-agenda-day="YYYY-MM-DD"` on
 * a day cell (all-day band, month cell). The math lives in `agendaDrag.ts`.
 *
 * A press only becomes a drag past DRAG_THRESHOLD_PX; a real drag swallows the
 * click that follows, so it never opens the item popover.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { AgendaItem } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { HOUR_PX, dayKey } from './agendaLayout';
import {
  DRAG_THRESHOLD_PX, canDrag, dayDiff, planDrop, pxToMinutes, selectionRange, wallMinutes,
  type DragSource, type DropPlan, type DropPreview, type DropTarget,
} from './agendaDrag';

export interface SelectRange { dayKey: string; startMin: number; endMin: number }

export interface AgendaDndApi {
  /** The item being dragged: dimmed where it was. */
  draggingId: string | null;
  /** Where the drag would land, or the slot being selected. */
  preview: DropPreview | null;
  refused: boolean;
  beginItem: (e: ReactPointerEvent, item: AgendaItem, mode: 'move' | 'resize') => void;
  beginTicket: (e: ReactPointerEvent, ticket: { id: string; title: string }) => void;
  /** Press on an empty slot of a grid column: click = 1 h, drag = a range. */
  beginSelect: (e: ReactPointerEvent, dayKey: string) => void;
}

export const AgendaDndContext = createContext<AgendaDndApi | null>(null);
export const useAgendaDnd = () => useContext(AgendaDndContext);

/** The day column / day cell under the pointer. */
export function hitTest(x: number, y: number): DropTarget | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-agenda-col],[data-agenda-day]');
  if (!el) return null;
  const col = el.dataset.agendaCol;
  if (col) return { dayKey: col, minutes: pxToMinutes(y - el.getBoundingClientRect().top) };
  return el.dataset.agendaDay ? { dayKey: el.dataset.agendaDay, minutes: null } : null;
}

/** Swallow the click the browser fires right after a drag's pointerup. */
function swallowNextClick() {
  const stop = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

type Session =
  | { kind: 'drag'; source: DragSource; x0: number; y0: number; active: boolean; plan: DropPlan | null }
  | { kind: 'select'; dayKey: string; col: HTMLElement; anchorMin: number; range: SelectRange | null; x0: number; y0: number; active: boolean };

interface View {
  draggingId: string | null;
  preview: DropPreview | null;
  refused: boolean;
  ghost: { x: number; y: number; label: string } | null;
}
const IDLE: View = { draggingId: null, preview: null, refused: false, ghost: null };

export function useAgendaDndController({ now, onDrop, onSelect }: {
  now: Date;
  onDrop: (plan: DropPlan) => void;
  onSelect: (range: SelectRange) => void;
}): { api: AgendaDndApi; ghost: View['ghost']; refused: boolean } {
  const [view, setView] = useState<View>(IDLE);
  const session = useRef<Session | null>(null);
  const teardown = useRef<(() => void) | null>(null);
  const latest = useRef({ now, onDrop, onSelect });
  latest.current = { now, onDrop, onSelect };

  useEffect(() => () => teardown.current?.(), []);

  const start = useCallback((e: ReactPointerEvent, s: Session) => {
    if (e.button !== 0 || session.current) return;
    e.preventDefault(); // no text selection, no focus ring while dragging
    session.current = s;
    const prevSelect = document.body.style.userSelect;

    const update = (ev: PointerEvent) => {
      const cur = session.current;
      if (!cur) return;
      if (!cur.active) {
        if (Math.hypot(ev.clientX - cur.x0, ev.clientY - cur.y0) < DRAG_THRESHOLD_PX) return;
        cur.active = true;
        document.body.style.userSelect = 'none';
      }
      if (cur.kind === 'select') {
        const min = pxToMinutes(ev.clientY - cur.col.getBoundingClientRect().top);
        const r = selectionRange(cur.anchorMin, min, true);
        cur.range = { dayKey: cur.dayKey, ...r };
        setView({ draggingId: null, refused: false, preview: { dayKey: cur.dayKey, ...r, label: `${hhmm(r.startMin)} - ${hhmm(r.endMin)}` }, ghost: null });
        return;
      }
      const target = hitTest(ev.clientX, ev.clientY);
      cur.plan = target ? planDrop(cur.source, target, latest.current.now) : null;
      const label = cur.plan?.preview.label ?? (cur.source.kind === 'ticket' ? 'Drop on a day' : 'Drop elsewhere to move');
      setView({
        draggingId: cur.source.kind === 'ticket' ? `ticket:${cur.source.ticketId}` : cur.source.item.id,
        preview: cur.plan?.preview ?? null,
        refused: cur.plan?.kind === 'refused',
        ghost: { x: ev.clientX, y: ev.clientY, label },
      });
    };

    const finish = (commit: boolean) => {
      const cur = session.current;
      teardown.current?.();
      if (!cur || !commit) return;
      if (cur.kind === 'select') {
        if (cur.active) swallowNextClick();
        const range = cur.range ?? { dayKey: cur.dayKey, ...selectionRange(cur.anchorMin, cur.anchorMin, false) };
        latest.current.onSelect(range);
        return;
      }
      if (!cur.active) return; // a plain click: the item's own onClick opens it
      swallowNextClick();
      if (cur.plan) latest.current.onDrop(cur.plan);
    };

    const onMove = (ev: PointerEvent) => update(ev);
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      if (session.current?.active) swallowNextClick();
      finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    teardown.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.userSelect = prevSelect;
      session.current = null;
      teardown.current = null;
      setView(IDLE);
    };
  }, []);

  const beginItem = useCallback((e: ReactPointerEvent, item: AgendaItem, mode: 'move' | 'resize') => {
    if (!canDrag(item)) return;
    let grabMin = 0;
    if (mode === 'move' && item.shape === 'allDay') {
      const t = hitTest(e.clientX, e.clientY);
      if (t) grabMin = Math.max(0, dayDiff(item.start, t.dayKey)) * 1440;
    } else if (mode === 'move') {
      // Keep the grabbed point under the pointer: a block grabbed by its middle doesn't jump.
      const t = hitTest(e.clientX, e.clientY);
      const s = new Date(item.start);
      if (t?.minutes != null) grabMin = dayDiff(dayKey(s), t.dayKey) * 1440 + t.minutes - wallMinutes(s);
    }
    const source: DragSource = mode === 'resize' ? { kind: 'resize', item } : { kind: 'move', item, grabMin };
    start(e, { kind: 'drag', source, x0: e.clientX, y0: e.clientY, active: false, plan: null });
  }, [start]);

  const beginTicket = useCallback((e: ReactPointerEvent, ticket: { id: string; title: string }) => {
    start(e, { kind: 'drag', source: { kind: 'ticket', ticketId: ticket.id, title: ticket.title }, x0: e.clientX, y0: e.clientY, active: false, plan: null });
  }, [start]);

  const beginSelect = useCallback((e: ReactPointerEvent, key: string) => {
    const col = e.currentTarget as HTMLElement;
    const anchorMin = pxToMinutes(e.clientY - col.getBoundingClientRect().top);
    start(e, { kind: 'select', dayKey: key, col, anchorMin, range: null, x0: e.clientX, y0: e.clientY, active: false });
  }, [start]);

  return {
    api: { draggingId: view.draggingId, preview: view.preview, refused: view.refused, beginItem, beginTicket, beginSelect },
    ghost: view.ghost,
    refused: view.refused,
  };
}

/** The label that follows the pointer: where the item would land. */
export function DragGhost({ ghost, refused }: { ghost: View['ghost']; refused: boolean }) {
  if (!ghost) return null;
  return (
    <div
      className={cn(
        'pointer-events-none fixed z-[70] whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-lg',
        refused
          ? 'border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-text)]'
          : 'border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)]',
      )}
      style={{ left: ghost.x + 14, top: ghost.y + 14 }}
    >
      {ghost.label}
    </div>
  );
}

/**
 * Makes a compact chip (all-day band, month cell) draggable when the PO allows
 * it; any other item is returned untouched (it keeps its pointer cursor).
 */
export function DragWrap({ item, children }: { item: AgendaItem; children: ReactNode }) {
  const dnd = useAgendaDnd();
  if (!dnd || !canDrag(item)) return <>{children}</>;
  return (
    <div
      data-agenda-draggable={item.id}
      onPointerDown={(e) => dnd.beginItem(e, item, 'move')}
      className={cn('min-w-0 [&>button]:cursor-grab', dnd.draggingId === item.id && 'opacity-40')}
      title="Drag to another day"
    >
      {children}
    </div>
  );
}

/** Slot preview drawn inside a grid column while dragging / selecting. */
export function SlotPreview({ preview, refused }: { preview: DropPreview; refused: boolean }) {
  if (preview.startMin === null || preview.endMin === null) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-0.5 right-0.5 z-40 rounded border-2 border-dashed px-1 text-[10.5px] font-medium',
        refused
          ? 'border-[var(--tint-red-solid)] bg-[var(--tint-red-bg)] text-[var(--tint-red-text)]'
          : 'border-[var(--theme-accent)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]',
      )}
      style={{ top: (preview.startMin / 60) * HOUR_PX, height: (Math.max(15, preview.endMin - preview.startMin) / 60) * HOUR_PX }}
    >
      {preview.label}
    </div>
  );
}
