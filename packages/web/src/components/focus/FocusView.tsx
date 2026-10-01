import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusItem, FocusItemKind } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import {
  UNDO_MS,
  focusStats,
  snoozedFocusItems,
  useFocusStore,
  visibleFocusItems,
} from '../../stores/focusStore';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { FloatingExecutionPanel } from '../tickets/ExecutionModal';
import { postTicketComment } from '../../services/api';
import { FocusIcon } from '../sidebar/icons';
import { Tooltip } from '../ui/Tooltip';
import { KindIcon } from './FocusIcons';
import { FocusRow } from './FocusRow';
import { FocusDetailModal, Kbd, SNOOZE_CHOICES } from './FocusDetailModal';
import {
  KIND_META,
  answerQuestion,
  focusActions,
  formatWait,
  sortFocusItems,
  waitedMs,
  type FocusAction,
  type FocusSort,
} from './focusModel';
import { applyCliSessions } from './focusSessions';
import { FocusRunningSection } from './FocusRunningSection';
import { openTicketInWork } from '../work/openInWork';

const KINDS: FocusItemKind[] = ['gate', 'question', 'error', 'idle'];
const TICK_MS = 30_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function isFormField(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/**
 * Focus — every Doing/Reviewing ticket that waits on a human (gate, question,
 * error, idle), across boards. The job is to keep this list empty: each row
 * carries its CTA, a reply field or the SmartSessionButton, so most items are
 * handled without opening the ticket; a click opens a detail popup for the rest.
 */
export function FocusView() {
  const now = useNow(TICK_MS);

  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const moveTicket = useTicketStore((s) => s.moveTicket);

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
  const addFloatingSession = useUIStore((s) => s.addFloatingSession);
  // The server can't see Claude Code CLI sessions: correct its idle items with their live hook status.
  const { items, running } = useMemo(
    () => applyCliSessions(serverItems, serverRunning, sessionGroups),
    [serverItems, serverRunning, sessionGroups],
  );
  const { commit, undo, snooze, unsnooze, unsnoozeAll, setPref, load } = useFocusStore.getState();

  const [kindFilter, setKindFilter] = useState<FocusItemKind | 'all'>('all');
  const [boardFilter, setBoardFilter] = useState<string>('all');
  const [sort, setSort] = useState<FocusSort>('age');
  const [cursor, setCursor] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Which way the popup last moved through the queue — its card slides that way.
  const [openDir, setOpenDir] = useState<1 | -1>(1);
  const [logs, setLogs] = useState<{ executionId: string; title: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Fresh data whenever the page is opened (the feed keeps it live afterwards).
  useEffect(() => { void load(); }, [load]);

  const ticketById = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  // Items whose ticket isn't loaded yet can't render a title — skip them until it is.
  const base = useMemo(
    () => visibleFocusItems({ items, pending, settled, snoozed, prefs }, now).filter((i) => ticketById.has(i.ticketId)),
    [items, pending, settled, snoozed, prefs, now, ticketById],
  );
  const inBoard = useMemo(
    () => (boardFilter === 'all' ? base : base.filter((i) => ticketById.get(i.ticketId)?.boardId === boardFilter)),
    [base, boardFilter, ticketById],
  );
  const list = useMemo(
    () => sortFocusItems(kindFilter === 'all' ? inBoard : inBoard.filter((i) => i.kind === kindFilter), sort, ticketById),
    [inBoard, kindFilter, sort, ticketById],
  );
  const snoozedItems = useMemo(
    () => snoozedFocusItems({ items, snoozed }, now).sort((a, b) => (snoozed[a.key] ?? 0) - (snoozed[b.key] ?? 0)),
    [items, snoozed, now],
  );
  const snoozedCount = snoozedItems.length;
  const stats = useMemo(() => focusStats(log, clearedAt, now), [log, clearedAt, now]);
  const oldest = useMemo(() => Math.max(0, ...base.map((i) => waitedMs(i, now) ?? 0)), [base, now]);

  useEffect(() => {
    if (cursor > Math.max(0, list.length - 1)) setCursor(Math.max(0, list.length - 1));
  }, [list.length, cursor]);

  const actionCtx = useCallback(
    (item: FocusItem) => {
      const t = ticketById.get(item.ticketId)!;
      return { ticket: t, moveTicket, openSession: addFloatingSession };
    },
    [ticketById, moveTicket, addFloatingSession],
  );
  const actionsOf = useCallback((item: FocusItem) => focusActions(item, actionCtx(item)), [actionCtx]);

  const openItem = openKey ? list.find((i) => i.key === openKey) ?? null : null;
  const openIndex = openItem ? list.indexOf(openItem) : -1;

  // After an action in the popup, move on to the item that takes its place.
  const advanceFrom = useCallback(
    (key: string) => {
      if (openKey !== key) return;
      const idx = list.findIndex((i) => i.key === key);
      const next = list.filter((i) => i.key !== key)[Math.max(0, idx)] ?? null;
      setOpenDir(1);
      setOpenKey(prefs.chain && next ? next.key : null);
    },
    [openKey, list, prefs.chain],
  );

  const act = useCallback(
    (item: FocusItem, action: FocusAction, notes?: string) => {
      // Opening a terminal doesn't handle the item: no undo window, the row stays.
      if (action.immediate) { void action.run(notes); return; }
      advanceFrom(item.key);
      commit(item, action.toast, () => action.run(notes));
    },
    [advanceFrom, commit],
  );
  const answer = useCallback(
    (item: FocusItem, text: string) => {
      const t = ticketById.get(item.ticketId);
      advanceFrom(item.key);
      commit(item, `#${t?.displayId ?? ''} · réponse envoyée à ${item.question?.askedBy ?? 'l’agent'}`, () => answerQuestion(item, text));
    },
    [advanceFrom, commit, ticketById],
  );
  // A comment handles the item: the popup moves on, with the usual undo window before it posts.
  const commentOn = useCallback(
    (item: FocusItem, text: string) => {
      const t = ticketById.get(item.ticketId);
      advanceFrom(item.key);
      commit(item, `#${t?.displayId ?? ''} · commentaire ajouté`, () => postTicketComment(item.ticketId, text));
    },
    [advanceFrom, commit, ticketById],
  );
  const snoozeItem = useCallback(
    (item: FocusItem, until: number) => {
      advanceFrom(item.key);
      snooze(item.key, until);
    },
    [advanceFrom, snooze],
  );
  const openTicket = useCallback(
    (item: Pick<FocusItem, 'ticketId'>) => {
      const t = ticketById.get(item.ticketId);
      if (!t) return;
      setOpenKey(null);
      openTicketInWork(t.id);
    },
    [ticketById],
  );

  // ── Page shortcuts (paused while the popup is open — it has its own) ──
  useEffect(() => {
    if (openKey) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isFormField(e.target)) return;
      const item = list[cursor];
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(list.length - 1, c + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (!item) {
        return;
      } else if (e.key === 'Enter' && !(e.target as HTMLElement | null)?.closest?.('button,a')) {
        e.preventDefault();
        setOpenKey(item.key);
      } else if (e.key === 'r' && item.kind === 'question') {
        e.preventDefault();
        rowRefs.current.get(item.key)?.querySelector<HTMLInputElement>('[data-focus-reply]')?.focus();
      } else if (e.key === 'l') {
        e.preventDefault();
        rowRefs.current.get(item.key)?.querySelector<HTMLButtonElement>('[data-focus-ssb] button')?.click();
      } else if (e.key === 's') {
        e.preventDefault();
        snoozeItem(item, SNOOZE_CHOICES[0]!.until());
      } else if (e.key === 'o') {
        e.preventDefault();
        openTicket(item);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openKey, list, cursor, snoozeItem, openTicket]);

  useEffect(() => {
    const item = list[cursor];
    if (item) rowRefs.current.get(item.key)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, list]);

  const countOf = (k: FocusItemKind | 'all') => (k === 'all' ? inBoard.length : inBoard.filter((i) => i.kind === k).length);
  const boardOptions = useMemo(
    () => [...boards].sort((a, b) => a.name.localeCompare(b.name)),
    [boards],
  );
  const pendingList = Object.entries(pending);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-7 pb-3 pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FocusIcon size={22} className="text-[var(--theme-accent)]" />
          <h1 className="text-xl font-bold tracking-tight text-[var(--theme-text-primary)]">Focus</h1>
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums',
              base.length
                ? cn(tintClasses('yellow').borderColor, tintClasses('yellow').bg, tintClasses('yellow').text)
                : cn(tintClasses('green').borderColor, tintClasses('green').bg, tintClasses('green').text),
            )}
          >
            {base.length ? `${base.length} en attente` : 'liste vide'}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <ToggleButton pressed={prefs.showIdle} onClick={() => setPref('showIdle', !prefs.showIdle)} title="Inclure les tickets sur lesquels personne ne travaille">
            Idle
          </ToggleButton>
          <ToggleButton pressed={prefs.zen} onClick={() => setPref('zen', !prefs.zen)} title="Masquer les indicateurs : ne garder que la liste">
            Mode zen
          </ToggleButton>
        </div>
        <p className="basis-full text-[12.5px] text-[var(--theme-text-muted)]">
          Tickets Doing et Reviewing qui attendent une intervention humaine, tous boards confondus. L’objectif : garder cette liste vide.
        </p>
      </header>

      {!prefs.zen && (
        <FocusPulse
          handledToday={stats.handledToday}
          medianTodayMs={stats.medianTodayMs}
          medianByDayMs={stats.medianByDayMs}
          clearedThisWeek={stats.clearedThisWeek}
          oldestMs={base.length ? oldest : null}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 px-7 pb-2 pt-3">
        <Chip pressed={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
          Tout <span className="tabular-nums text-[var(--theme-text-muted)]">{countOf('all')}</span>
        </Chip>
        {KINDS.filter((k) => k !== 'idle' || prefs.showIdle).map((k) => (
          <Chip key={k} pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
            <span className={cn('h-[7px] w-[7px] rounded-full', tintClasses(KIND_META[k].hue).solid)} />
            {KIND_META[k].plural} <span className="tabular-nums text-[var(--theme-text-muted)]">{countOf(k)}</span>
          </Chip>
        ))}
        <span className="flex-1" />
        {snoozedCount > 0 && (
          <span className="text-xs text-[var(--theme-text-muted)]">
            {snoozedCount} en pause ·{' '}
            <Tooltip
              interactive
              label={
                <SnoozedList
                  items={snoozedItems}
                  snoozed={snoozed}
                  now={now}
                  titleOf={(i) => ticketById.get(i.ticketId)?.title ?? `#${i.ticketId.slice(0, 6)}`}
                  onUnsnooze={unsnooze}
                />
              }
            >
              <button
                type="button"
                onClick={unsnoozeAll}
                className="cursor-pointer text-[var(--theme-accent)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--theme-accent-hover)] hover:decoration-solid"
              >
                ramener
              </button>
            </Tooltip>
          </span>
        )}
        <label htmlFor="focus-board" className="text-xs text-[var(--theme-text-muted)]">Board</label>
        <select
          id="focus-board"
          value={boardFilter}
          onChange={(e) => setBoardFilter(e.target.value)}
          className="h-[26px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-1.5 text-xs text-[var(--theme-text-secondary)]"
        >
          <option value="all">Tous</option>
          {boardOptions.map((b) => <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>)}
        </select>
        <label htmlFor="focus-sort" className="text-xs text-[var(--theme-text-muted)]">Tri</label>
        <select
          id="focus-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as FocusSort)}
          className="h-[26px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-1.5 text-xs text-[var(--theme-text-secondary)]"
        >
          <option value="age">Plus ancien d’abord</option>
          <option value="priority">Priorité</option>
          <option value="kind">Type d’attente</option>
        </select>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6 pt-1">
        {!loaded ? (
          <div className="py-16 text-center text-xs text-[var(--theme-text-faint)]">Chargement…</div>
        ) : base.length === 0 ? (
          <EmptyState />
        ) : list.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">
            Rien pour ce filtre.{' '}
            <button type="button" onClick={() => { setKindFilter('all'); setBoardFilter('all'); }} className="text-[var(--theme-accent)] underline decoration-dotted underline-offset-2">
              Tout afficher
            </button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {list.map((item, i) => {
              const ticket = ticketById.get(item.ticketId)!;
              return (
                <FocusRow
                  key={item.key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.key, el);
                    else rowRefs.current.delete(item.key);
                  }}
                  item={item}
                  ticket={ticket}
                  board={boardById.get(ticket.boardId)}
                  actions={actionsOf(item)}
                  now={now}
                  selected={i === cursor}
                  onOpen={() => { setCursor(i); setOpenKey(item.key); }}
                  onAction={(a) => act(item, a)}
                  onAnswer={(text) => answer(item, text)}
                  onOpenLogs={(executionId) => setLogs({ executionId, title: ticket.title })}
                />
              );
            })}
          </div>
        )}
        {loaded && (
          <FocusRunningSection
            running={boardFilter === 'all' ? running : running.filter((r) => ticketById.get(r.ticketId)?.boardId === boardFilter)}
            ticketById={ticketById}
            boardById={boardById}
            now={now}
            open={prefs.showRunning}
            onToggle={() => setPref('showRunning', !prefs.showRunning)}
            onOpenTicket={(ticketId) => openTicket({ ticketId })}
            onOpenLogs={(executionId, title) => setLogs({ executionId, title })}
            onOpenSession={addFloatingSession}
          />
        )}
      </div>

      {/* Footer: shortcuts */}
      <div className="hidden flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-[var(--theme-border)] px-7 py-2 text-[11px] text-[var(--theme-text-faint)] md:flex">
        <span><Kbd>J</Kbd><Kbd>K</Kbd> naviguer</span>
        <span><Kbd>⏎</Kbd> détails</span>
        <span><Kbd>R</Kbd> répondre</span>
        <span><Kbd>L</Kbd> lancer un agent</span>
        <span><Kbd>S</Kbd> plus tard (1 h)</span>
        <span><Kbd>O</Kbd> ouvrir dans Tasks</span>
      </div>

      {/* Undo window */}
      {pendingList.length > 0 && (
        <div className="pointer-events-none fixed bottom-12 left-1/2 z-40 grid -translate-x-1/2 gap-1.5">
          {pendingList.slice(-3).map(([key, p]) => (
            <UndoToast key={key} label={p.label} onUndo={() => undo(key)} />
          ))}
        </div>
      )}

      {openItem && (
        <FocusDetailModal
          item={openItem}
          ticket={ticketById.get(openItem.ticketId)!}
          board={boardById.get(ticketById.get(openItem.ticketId)!.boardId)}
          actions={actionsOf(openItem)}
          now={now}
          position={`${openIndex + 1} / ${list.length}`}
          chain={prefs.chain}
          onChainChange={(v) => setPref('chain', v)}
          onClose={() => setOpenKey(null)}
          direction={openDir}
          remaining={list.length - 1}
          onPrev={() => { const i = (openIndex - 1 + list.length) % list.length; setCursor(i); setOpenDir(-1); setOpenKey(list[i]!.key); }}
          onNext={() => { const i = (openIndex + 1) % list.length; setCursor(i); setOpenDir(1); setOpenKey(list[i]!.key); }}
          onAction={(a, notes) => act(openItem, a, notes)}
          onAnswer={(text) => answer(openItem, text)}
          onComment={(text) => commentOn(openItem, text)}
          onSnooze={(until) => snoozeItem(openItem, until)}
          onOpenTicket={() => openTicket(openItem)}
          onOpenLogs={(executionId) => setLogs({ executionId, title: ticketById.get(openItem.ticketId)!.title })}
        />
      )}

      {logs && <FloatingExecutionPanel executionId={logs.executionId} title={logs.title} onClose={() => setLogs(null)} />}
    </div>
  );
}

function ToggleButton({ pressed, onClick, title, children }: { pressed: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={cn(
        'h-7 rounded-md border px-2.5 text-xs transition-colors',
        pressed
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
          : 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-border-input)]',
      )}
    >
      {children}
    </button>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        pressed
          ? 'border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
          : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-primary)]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * One line of indicators, hidden by the zen mode. Deliberately not a dashboard:
 * the reaction time says whether focus works, the oldest wait says whether
 * something is rotting, and "vidée" counts the only goal of the page.
 */
function FocusPulse({ handledToday, medianTodayMs, medianByDayMs, clearedThisWeek, oldestMs }: {
  handledToday: number;
  medianTodayMs: number | null;
  medianByDayMs: (number | null)[];
  clearedThisWeek: number;
  oldestMs: number | null;
}) {
  const W = 120;
  const H = 26;
  const max = Math.max(1, ...medianByDayMs.map((v) => v ?? 0));
  const stale = oldestMs !== null && oldestMs > 4 * 3600_000;
  return (
    <div className="mx-7 flex flex-wrap items-center gap-x-4.5 gap-y-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-xs text-[var(--theme-text-muted)]">
      <span><b className="font-semibold tabular-nums text-[var(--theme-text-primary)]">{handledToday}</b> traités aujourd’hui</span>
      <span>réaction médiane <b className="font-semibold tabular-nums text-[var(--theme-text-primary)]">{medianTodayMs === null ? '—' : formatWait(medianTodayMs)}</b></span>
      <span>
        plus ancien en attente{' '}
        <b className={cn('font-semibold tabular-nums', stale ? tintClasses('orange').text : 'text-[var(--theme-text-primary)]')}>
          {oldestMs === null ? '—' : formatWait(oldestMs)}
        </b>
      </span>
      <span><b className="font-semibold tabular-nums text-[var(--theme-text-primary)]">{clearedThisWeek}</b> fois vidée cette semaine</span>
      <span className="ml-auto flex items-center gap-2" title="Réaction médiane par jour, 7 derniers jours (ce navigateur)">
        <span>réaction, 7 j</span>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Réaction médiane par jour sur 7 jours">
          {medianByDayMs.map((v, i) => {
            const h = v === null ? 2 : Math.max(3, (v / max) * (H - 4));
            return (
              <rect
                key={i}
                x={i * 17}
                y={H - h}
                width={11}
                height={h}
                rx={2}
                className={i === medianByDayMs.length - 1 ? 'fill-[var(--theme-accent)]' : 'fill-[var(--theme-bg-overlay-hover)]'}
              />
            );
          })}
        </svg>
      </span>
    </div>
  );
}

/** Tooltip body under "ramener": what's snoozed, until when, and a way to bring each one back. */
function SnoozedList({ items, snoozed, now, titleOf, onUnsnooze }: {
  items: FocusItem[];
  snoozed: Record<string, number>;
  now: number;
  titleOf: (item: FocusItem) => string;
  onUnsnooze: (key: string) => void;
}) {
  return (
    <div className="flex w-72 flex-col gap-0.5">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--theme-text-muted)]">
        En pause · clic sur « ramener » pour tout ramener
      </div>
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[var(--theme-bg-overlay-hover)]">
          <span className={tintClasses(KIND_META[item.kind].hue).text}><KindIcon kind={item.kind} size={11} /></span>
          <span className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)]">{titleOf(item)}</span>
          <span className="shrink-0 tabular-nums text-[var(--theme-text-muted)]">
            encore {formatWait(Math.max(0, (snoozed[item.key] ?? now) - now))}
          </span>
          <button
            type="button"
            onClick={() => onUnsnooze(item.key)}
            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-accent-hover)]"
          >
            ramener
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid justify-items-center gap-2.5 px-4 pb-2 pt-14 text-center">
      <div className={cn('grid h-16 w-16 place-items-center rounded-full border', tintClasses('green').borderColor, tintClasses('green').bg, tintClasses('green').solidText)}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
      </div>
      <h2 className="mt-1 text-lg font-bold text-[var(--theme-text-primary)]">Rien n’attend ton intervention</h2>
      <p className="max-w-[52ch] text-[13px] text-[var(--theme-text-muted)]">
        Les agents ont tout ce qu’il leur faut. Les nouvelles gates, questions et erreurs apparaîtront ici dès qu’elles se présentent.
      </p>
    </div>
  );
}

function UndoToast({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="pointer-events-auto relative flex items-center gap-2.5 overflow-hidden rounded-full border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] py-1.5 pl-3.5 pr-1.5 text-[12.5px] text-[var(--theme-text-primary)] shadow-xl"
    >
      <span className="max-w-[60vw] truncate">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-full bg-[var(--theme-bg-surface)] px-2.5 py-0.5 text-xs font-semibold text-[var(--theme-accent)] hover:bg-[var(--theme-bg-hover)]"
      >
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
