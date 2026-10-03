import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FocusItem, FocusItemKind, Ticket } from '@fleex/shared';
import { postTicketComment } from '../services/api';
import { useTicketStore } from '../stores/ticketStore';
import { useSessionStore } from '../stores/sessionStore';
import { useNotificationStore } from '../stores/notificationStore';
import {
  UNDO_MS,
  focusStats,
  snoozedFocusItems,
  useFocusStore,
  visibleFocusItems,
} from '../stores/focusStore';
import { cn } from '../lib/cn';
import { tint, tintClasses, type TintHue } from '../lib/tints';
import { FocusIcon } from '../components/sidebar/icons';
import { KindIcon } from '../components/focus/FocusIcons';
import { SNOOZE_CHOICES } from '../components/focus/FocusDetailModal';
import { applyCliSessions } from '../components/focus/focusSessions';
import {
  KIND_META,
  STALE_MS,
  answerQuestion,
  focusActions,
  focusSummary,
  formatWait,
  sortFocusItems,
  waitedMs,
  type FocusAction,
} from '../components/focus/focusModel';
import { PRIORITY_COLOR } from './MobileTicketCard';
import { BellIcon } from './MobileMore';
import { useMobileNavStore } from './mobileNavStore';
import { useClock } from './useClock';
import { MobilePageHeader } from './MobilePageHeader';
import { MobileFocusSheet } from './MobileFocusSheet';
import { COLUMN_EASING, COLUMN_MS } from './useColumnSwipe';
import { ROW_ACTION_WIDTH, useRowSwipe, type RowSide } from './useRowSwipe';

const KINDS: FocusItemKind[] = ['gate', 'question', 'error', 'idle'];

/**
 * Focus on the phone — the human-attention queue, as a list first: one compact
 * row per item, swiped sideways to snooze it. A tap opens the full-screen sheet
 * (the desktop popup's counterpart) where the item is acted on. Same model as
 * the desktop page: `focusActions()` for the choices, the focusStore undo
 * window / snooze / log.
 */
export function MobileFocus() {
  const now = useClock();
  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const moveTicket = useTicketStore((s) => s.moveTicket);
  const openTicket = useMobileNavStore((s) => s.openTicket);
  const openMorePage = useMobileNavStore((s) => s.openMorePage);
  const unseen = useNotificationStore((s) => s.unseenCount);

  const serverItems = useFocusStore((s) => s.items);
  const loaded = useFocusStore((s) => s.loaded);
  const pending = useFocusStore((s) => s.pending);
  const settled = useFocusStore((s) => s.settled);
  const snoozed = useFocusStore((s) => s.snoozed);
  const prefs = useFocusStore((s) => s.prefs);
  const log = useFocusStore((s) => s.log);
  const clearedAt = useFocusStore((s) => s.clearedAt);
  const serverRunning = useFocusStore((s) => s.running);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const { commit, undo, snooze, unsnoozeAll, setPref, load } = useFocusStore.getState();

  const { items, running } = useMemo(
    () => applyCliSessions(serverItems, serverRunning, sessionGroups),
    [serverItems, serverRunning, sessionGroups],
  );

  const [kindFilter, setKindFilter] = useState<FocusItemKind | 'all'>('all');
  useEffect(() => {
    void load();
  }, [load]);

  const ticketById = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  const base = useMemo(
    () =>
      visibleFocusItems({ items, pending, settled, snoozed, prefs }, now).filter((i) =>
        ticketById.has(i.ticketId),
      ),
    [items, pending, settled, snoozed, prefs, now, ticketById],
  );
  const list = useMemo(
    () => sortFocusItems(kindFilter === 'all' ? base : base.filter((i) => i.kind === kindFilter), 'age', ticketById),
    [base, kindFilter, ticketById],
  );
  const snoozedCount = useMemo(() => snoozedFocusItems({ items, snoozed }, now).length, [items, snoozed, now]);
  const stats = useMemo(() => focusStats(log, clearedAt, now), [log, clearedAt, now]);
  const oldest = useMemo(() => Math.max(0, ...base.map((i) => waitedMs(i, now) ?? 0)), [base, now]);
  const countOf = (k: FocusItemKind | 'all') => (k === 'all' ? base.length : base.filter((i) => i.kind === k).length);
  const pendingList = Object.entries(pending);

  // No floating terminal on a phone: session actions ("Ouvrir CLI") are left out.
  const actionsOf = useCallback(
    (item: FocusItem) => focusActions(item, { ticket: ticketById.get(item.ticketId)!, moveTicket }),
    [ticketById, moveTicket],
  );
  const act = useCallback(
    (item: FocusItem, action: FocusAction) => {
      if (action.immediate) {
        void action.run();
        return;
      }
      commit(item, action.toast, () => action.run());
    },
    [commit],
  );
  // A question gets its answer; an idle ticket a comment (which wakes the agents it mentions).
  const answer = useCallback(
    (item: FocusItem, text: string) => {
      const ref = `#${ticketById.get(item.ticketId)?.displayId ?? ''}`;
      if (item.kind === 'idle') {
        commit(item, `${ref} · commentaire ajouté`, () => postTicketComment(item.ticketId, text));
        return;
      }
      commit(item, `${ref} · réponse envoyée à ${item.question?.askedBy ?? 'l’agent'}`, () => answerQuestion(item, text));
    },
    [commit, ticketById],
  );

  // One row swiped open at a time; the sheet shows one item of the list.
  const [openRow, setOpenRow] = useState<{ key: string; side: RowSide } | null>(null);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const closeSheet = useCallback(() => setSheetKey(null), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MobilePageHeader
        title="Focus"
        icon={<FocusIcon size={24} />}
        count={base.length}
        trailing={
          <button
            type="button"
            onClick={() => openMorePage('pulse')}
            aria-label="Notifications"
            className="relative flex h-11 w-11 items-center justify-center rounded-[10px] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)]"
          >
            <BellIcon size={22} />
            {unseen > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--theme-accent-active)] px-1 text-[9.5px] font-bold text-[var(--theme-accent-fg)]">
                {unseen}
              </span>
            )}
          </button>
        }
        sub={
          !prefs.zen ? (
            <p className="text-[11.5px] text-[var(--theme-text-muted)]">
              {stats.handledToday} traités aujourd’hui · réaction médiane{' '}
              {stats.medianTodayMs === null ? '—' : formatWait(stats.medianTodayMs)} · plus ancien{' '}
              {base.length ? formatWait(oldest) : '—'}
            </p>
          ) : undefined
        }
      />

      <nav className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        <KindChip active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
          Tout <span className="opacity-70">{countOf('all')}</span>
        </KindChip>
        {KINDS.filter((k) => countOf(k) > 0 || kindFilter === k).map((k) => (
          <KindChip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)}>
            {KIND_META[k].plural} <span className="opacity-70">{countOf(k)}</span>
          </KindChip>
        ))}
      </nav>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}
      >
        {!loaded ? (
          <p className="py-16 text-center text-xs text-[var(--theme-text-faint)]">Chargement…</p>
        ) : list.length === 0 ? (
          <EmptyState filtered={base.length > 0} onReset={() => setKindFilter('all')} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {list.map((item) => (
              <FocusRow
                key={item.key}
                item={item}
                ticket={ticketById.get(item.ticketId)!}
                now={now}
                open={openRow?.key === item.key ? openRow.side : null}
                onOpenChange={(side) => setOpenRow(side ? { key: item.key, side } : null)}
                onOpen={() => {
                  setOpenRow(null);
                  setSheetKey(item.key);
                }}
                onSnooze={(until) => {
                  setOpenRow(null);
                  snooze(item.key, until);
                }}
              />
            ))}
          </div>
        )}

        {snoozedCount > 0 && (
          <p className="mt-3 text-center text-xs text-[var(--theme-text-muted)]">
            {snoozedCount} en pause ·{' '}
            <button type="button" onClick={unsnoozeAll} className="py-2 text-[var(--theme-accent)]">
              tout réafficher
            </button>
          </p>
        )}

        {loaded && (
          <RunningBlock
            running={running.filter((r) => ticketById.has(r.ticketId))}
            ticketById={ticketById}
            open={prefs.showRunning}
            onToggle={() => setPref('showRunning', !prefs.showRunning)}
            onOpen={(id) => openTicket(id, 'runs')}
          />
        )}
      </div>

      {sheetKey && (
        <MobileFocusSheet
          list={list}
          currentKey={sheetKey}
          onCurrentChange={setSheetKey}
          ticketById={ticketById}
          boardById={boardById}
          actionsOf={actionsOf}
          now={now}
          onAction={act}
          onAnswer={answer}
          onSnooze={(item, until) => snooze(item.key, until)}
          onOpenTicket={(item) => {
            closeSheet();
            openTicket(item.ticketId, item.kind === 'gate' ? 'workflow' : 'conversation');
          }}
          onOpenLogs={(item) => {
            closeSheet();
            openTicket(item.ticketId, 'runs');
          }}
          onClose={closeSheet}
        />
      )}

      {/* Undo window — just above the floating bar, or over the sheet's header while it is open */}
      {pendingList.length > 0 && (
        <div
          className={cn(
            'pointer-events-none inset-x-3 grid gap-1.5',
            sheetKey ? 'fixed top-[calc(env(safe-area-inset-top)+40px)] z-[60]' : 'absolute bottom-[104px] z-30',
          )}
        >
          {pendingList.slice(-3).map(([key, p]) => (
            <UndoToast key={key} label={p.label} onUndo={() => undo(key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function KindChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium',
        active
          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
          : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]',
      )}
    >
      {children}
    </button>
  );
}

/** The two snoozes a row offers on a swipe: the short one on the right, the long one on the left. */
const SWIPE_SNOOZE: Record<RowSide, { label: string; hue: TintHue; until: () => number }> = {
  right: { label: SNOOZE_CHOICES[0]!.short, hue: 'orange', until: SNOOZE_CHOICES[0]!.until },
  left: { label: SNOOZE_CHOICES[2]!.short, hue: 'indigo', until: SNOOZE_CHOICES[2]!.until },
};

/**
 * One item of the queue: what it is, which ticket, how long it has waited and
 * one line of context — no buttons. A tap opens the sheet; a swipe uncovers a
 * snooze, which a tap on it confirms.
 */
function FocusRow({
  item,
  ticket,
  now,
  open,
  onOpenChange,
  onOpen,
  onSnooze,
}: {
  item: FocusItem;
  ticket: Ticket;
  now: number;
  open: RowSide | null;
  onOpenChange: (side: RowSide | null) => void;
  onOpen: () => void;
  onSnooze: (until: number) => void;
}) {
  const meta = KIND_META[item.kind];
  const wait = waitedMs(item, now);
  const stale = wait !== null && wait > STALE_MS;
  const who =
    item.kind === 'question' ? item.question?.askedBy : item.kind === 'gate' ? item.gate?.stepName : null;
  const { offset, dragging, swiped, touchProps } = useRowSwipe({ open, onOpenChange });
  const side: RowSide | null = offset > 0 ? 'left' : offset < 0 ? 'right' : null;
  const action = side ? SWIPE_SNOOZE[side] : null;

  const tap = () => {
    // The click that ends a swipe is not a tap.
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (open) onOpenChange(null);
    else onOpen();
  };

  return (
    <div className="relative overflow-hidden rounded-xl" {...touchProps}>
      {side && action && (
        <button
          type="button"
          onClick={() => onSnooze(action.until())}
          aria-label={`Plus tard : ${action.label}`}
          className={cn(
            'absolute inset-y-0 flex flex-col items-center justify-center gap-1 text-[12px] font-semibold text-white',
            side === 'left' ? 'left-0' : 'right-0',
            tintClasses(action.hue).solid,
          )}
          style={{ width: Math.max(ROW_ACTION_WIDTH, Math.abs(offset)) }}
        >
          <ClockIcon />
          {action.label}
        </button>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={tap}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className="relative flex flex-col gap-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-2.5 pl-[15px] pr-3"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : `transform ${COLUMN_MS}ms ${COLUMN_EASING}`,
        }}
      >
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', tintClasses(meta.hue).solid)} />
        <div className="flex items-start gap-2">
          <span
            className={cn('mt-px flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full', tint(meta.hue))}
            title={meta.label}
          >
            <KindIcon kind={item.kind} />
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-[1.35] text-[var(--theme-text-primary)] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] overflow-hidden">
            {ticket.priority !== 'none' && (
              <span className={cn('mb-px mr-1.5 inline-block h-[7px] w-[7px] rounded-full', PRIORITY_COLOR[ticket.priority])} />
            )}
            <span className="mr-1.5 font-mono text-[11.5px] font-normal text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
            {ticket.title}
          </span>
          <span
            className={cn('mt-0.5 shrink-0 font-mono text-[11.5px] tabular-nums', stale ? tintClasses('orange').text : 'text-[var(--theme-text-muted)]')}
          >
            {formatWait(wait)}
          </span>
        </div>
        <p className="truncate pl-7 text-[12.5px] text-[var(--theme-text-secondary)]">
          {who && <span className={cn('mr-1.5', tintClasses('purple').text)}>{item.kind === 'question' ? `@${who}` : who}</span>}
          <span className={item.kind === 'error' ? tintClasses('red').text : undefined}>{focusSummary(item)}</span>
        </p>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 15,14" />
    </svg>
  );
}

function RunningBlock({
  running,
  ticketById,
  open,
  onToggle,
  onOpen,
}: {
  running: ReturnType<typeof useFocusStore.getState>['running'];
  ticketById: ReadonlyMap<string, { displayId: number | string; title: string }>;
  open: boolean;
  onToggle: () => void;
  onOpen: (ticketId: string) => void;
}) {
  if (running.length === 0) return null;
  return (
    <section className="mt-4 rounded-xl border border-[var(--theme-border-subtle)]" aria-label="Tickets en cours">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[12.5px] text-[var(--theme-text-muted)]"
      >
        <span className="h-[7px] w-[7px] shrink-0 animate-blink rounded-full bg-[var(--theme-accent)]" />
        <span className="min-w-0 flex-1">
          Pendant ce temps,{' '}
          <strong className="font-semibold text-[var(--theme-text-primary)]">
            {running.length} ticket{running.length > 1 ? 's' : ''}
          </strong>{' '}
          {running.length > 1 ? 'avancent' : 'avance'} en autonomie
        </span>
        <span className={cn('transition-transform duration-150', open && 'rotate-180')}>▾</span>
      </button>
      {open &&
        running.map((r) => {
          const t = ticketById.get(r.ticketId)!;
          return (
            <button
              key={r.ticketId}
              type="button"
              onClick={() => onOpen(r.ticketId)}
              className="flex min-h-11 w-full flex-col gap-0.5 border-t border-[var(--theme-border-subtle)] px-3 py-2 text-left"
            >
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[11.5px] text-[var(--theme-text-muted)]">#{t.displayId}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--theme-text-primary)]">{t.title}</span>
              </span>
              <span className={cn('truncate text-[11.5px]', tintClasses('purple').text)}>{r.label}</span>
            </button>
          );
        })}
    </section>
  );
}

function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  if (filtered) {
    return (
      <p className="py-12 text-center text-xs text-[var(--theme-text-muted)]">
        Rien pour ce filtre.{' '}
        <button type="button" onClick={onReset} className="py-2 text-[var(--theme-accent)]">
          Tout afficher
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-14 text-center">
      <FocusIcon size={36} className={tintClasses('green').solidText} />
      <h2 className="text-lg font-bold">Liste vide</h2>
      <p className="text-[13px] text-[var(--theme-text-muted)]">Rien n’attend ton intervention.</p>
    </div>
  );
}

function UndoToast({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] py-2 pl-3.5 pr-2 text-[13px] text-[var(--theme-text-primary)] shadow-[0_10px_30px_rgba(0,0,0,.4)]"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button type="button" onClick={onUndo} className="min-h-11 px-3 text-sm font-semibold text-[var(--theme-accent)]">
        Annuler
      </button>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-[2px] bg-[var(--theme-accent)]"
        style={{ animation: `focus-undo ${UNDO_MS}ms linear forwards` }}
      />
      <style>{'@keyframes focus-undo{from{width:100%}to{width:0}}'}</style>
    </div>
  );
}
