import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusItem, FocusItemKind } from '@fleex/shared';
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
import { tint, tintClasses } from '../lib/tints';
import { FocusIcon } from '../components/sidebar/icons';
import { KindIcon } from '../components/focus/FocusIcons';
import { FocusStatusBadge } from '../components/focus/FocusTicketLead';
import { applyCliSessions } from '../components/focus/focusSessions';
import {
  KIND_META,
  STALE_MS,
  answerQuestion,
  focusActions,
  focusSummary,
  formatWait,
  questionOptions,
  sortFocusItems,
  waitedMs,
  type FocusAction,
} from '../components/focus/focusModel';
import { PRIORITY_COLOR } from './MobileTicketCard';
import { BellIcon } from './MobileMore';
import { useMobileNavStore } from './mobileNavStore';
import { useClock } from './useClock';
import { useFileUpload } from '../hooks/useFileUpload';

const KINDS: FocusItemKind[] = ['gate', 'question', 'error', 'idle'];

/**
 * Focus on the phone — the human-attention queue, one card per item with its
 * direct actions. Same model as the desktop page: `focusActions()` for the
 * buttons, the focusStore undo window / snooze / log. No shortcut, no popup:
 * tapping a card opens the ticket full-screen on the tab that matters.
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
  const answer = useCallback(
    (item: FocusItem, text: string) => {
      const t = ticketById.get(item.ticketId);
      commit(item, `#${t?.displayId ?? ''} · réponse envoyée à ${item.question?.askedBy ?? 'l’agent'}`, () =>
        answerQuestion(item, text),
      );
    },
    [commit, ticketById],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--theme-border)] px-4 pb-2.5 pt-1.5">
        <div className="flex items-center gap-2">
          <FocusIcon size={22} className="text-[var(--theme-accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Focus</h1>
          <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--theme-text-secondary)]">
            {base.length}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => openMorePage('pulse')}
            aria-label="Notifications"
            className="relative flex h-11 w-11 items-center justify-center rounded-[10px] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)]"
          >
            <BellIcon />
            {unseen > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--theme-accent-active)] px-1 text-[9.5px] font-bold text-[var(--theme-accent-fg)]">
                {unseen}
              </span>
            )}
          </button>
        </div>
        {!prefs.zen && (
          <p className="text-[11.5px] text-[var(--theme-text-muted)]">
            {stats.handledToday} traités aujourd’hui · réaction médiane{' '}
            {stats.medianTodayMs === null ? '—' : formatWait(stats.medianTodayMs)} · plus ancien{' '}
            {base.length ? formatWait(oldest) : '—'}
          </p>
        )}
      </header>

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
              <FocusCard
                key={item.key}
                item={item}
                ticket={ticketById.get(item.ticketId)!}
                boardLabel={(() => {
                  const b = boardById.get(ticketById.get(item.ticketId)!.boardId);
                  return b ? `${b.emoji} ${b.name}` : undefined;
                })()}
                actions={actionsOf(item)}
                now={now}
                onOpen={() => openTicket(item.ticketId, item.kind === 'gate' ? 'workflow' : 'conversation')}
                onOpenLogs={() => openTicket(item.ticketId, 'runs')}
                onAction={(a) => act(item, a)}
                onAnswer={(text) => answer(item, text)}
                onSnooze={() => snooze(item.key, Date.now() + 3600_000)}
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

      {/* Undo window — just above the floating bar */}
      {pendingList.length > 0 && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[104px] z-30 grid gap-1.5">
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
        'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
        active
          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
          : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]',
      )}
    >
      {children}
    </button>
  );
}

function FocusCard({
  item,
  ticket,
  boardLabel,
  actions,
  now,
  onOpen,
  onOpenLogs,
  onAction,
  onAnswer,
  onSnooze,
}: {
  item: FocusItem;
  ticket: NonNullable<ReturnType<typeof useTicketStore.getState>['tickets'][number]>;
  boardLabel?: string;
  actions: FocusAction[];
  now: number;
  onOpen: () => void;
  onOpenLogs: () => void;
  onAction: (a: FocusAction) => void;
  onAnswer: (text: string) => void;
  onSnooze: () => void;
}) {
  const meta = KIND_META[item.kind];
  const wait = waitedMs(item, now);
  const stale = wait !== null && wait > STALE_MS;
  const [text, setText] = useState('');
  const replyRef = useRef<HTMLTextAreaElement>(null);
  // Attach an image/file to the answer (paste or picker), like the desktop detail composer
  const fileUpload = useFileUpload({ textareaRef: replyRef, value: text, onChange: setText });
  const reply = item.kind === 'question' && item.question?.source !== 'session';
  const options = reply ? questionOptions(item) : [];
  const who =
    item.kind === 'question' ? item.question?.askedBy : item.kind === 'gate' ? item.gate?.stepName : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onAnswer(v);
    setText('');
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-3 pl-[15px] pr-3"
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', tintClasses(meta.hue).solid)} />

      <div className="flex items-center gap-2">
        <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold', tint(meta.hue))}>
          <KindIcon kind={item.kind} />
          {meta.label}
        </span>
        <FocusStatusBadge ticket={ticket} />
        <span className="flex-1" />
        <span
          className={cn('font-mono text-[11.5px] tabular-nums', stale ? tintClasses('orange').text : 'text-[var(--theme-text-muted)]')}
        >
          {formatWait(wait)}
        </span>
      </div>

      <div className="flex items-start gap-1.5">
        {ticket.priority !== 'none' && (
          <span className={cn('mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full', PRIORITY_COLOR[ticket.priority])} />
        )}
        <span className="mt-0.5 shrink-0 font-mono text-[11.5px] text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
        <span className="text-sm font-semibold leading-[1.35] text-[var(--theme-text-primary)]">{ticket.title}</span>
      </div>

      <p className="text-[13px] leading-[1.45] text-[var(--theme-text-secondary)]">
        {who && (
          <span className={cn('mr-1.5', tintClasses('purple').text)}>{item.kind === 'question' ? `@${who}` : who}</span>
        )}
        <span className={item.kind === 'error' ? tintClasses('red').text : undefined}>{focusSummary(item)}</span>
      </p>

      {boardLabel && (
        <span className="w-fit whitespace-nowrap rounded bg-[var(--theme-bg-overlay)] px-1.5 py-px text-[10.5px] text-[var(--theme-text-muted)]">
          {boardLabel}
        </span>
      )}

      <div className="flex flex-col gap-2" onClick={stop}>
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAction(a)}
                className="h-8 whitespace-nowrap rounded-full border border-dashed border-[var(--theme-border-input)] px-3 text-[12.5px] text-[var(--theme-text-secondary)] active:bg-[var(--theme-bg-overlay)]"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {reply ? (
          <div className="flex items-center gap-1.5">
            <textarea
              ref={replyRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={fileUpload.pasteHandler}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Répondre${item.question?.askedBy ? ` à @${item.question.askedBy}` : ''}…`}
              aria-label="Réponse"
              className="max-h-32 min-h-[38px] min-w-0 flex-1 resize-none rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2.5 py-[7px] text-base leading-6 text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] [field-sizing:content] focus:border-[var(--theme-accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={fileUpload.openFilePicker}
              disabled={fileUpload.isUploading}
              aria-label="Joindre une image ou un fichier"
              className="flex h-[38px] w-10 shrink-0 items-center justify-center rounded-lg text-[var(--theme-text-muted)] disabled:opacity-50"
            >
              {fileUpload.isUploading ? '…' : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
              )}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!text.trim() || fileUpload.isUploading}
              aria-label="Envoyer"
              className="h-[38px] w-11 shrink-0 rounded-lg bg-[var(--theme-accent)] text-sm font-semibold text-[var(--theme-accent-fg)] disabled:opacity-40"
            >
              ↵
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions
              .filter((a) => !a.immediate)
              .slice(0, 2)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onAction(a)}
                  className={cn(
                    'h-9 whitespace-nowrap rounded-lg px-3.5 text-[13px]',
                    a.primary
                      ? 'bg-[var(--theme-accent)] font-semibold text-[var(--theme-accent-fg)]'
                      : 'border border-[var(--theme-border-input)] font-medium text-[var(--theme-text-primary)]',
                  )}
                >
                  {a.label}
                </button>
              ))}
            {item.kind === 'error' && item.error?.executionId && (
              <button
                type="button"
                onClick={onOpenLogs}
                className="h-9 rounded-lg border border-[var(--theme-border-input)] px-3.5 text-[13px] font-medium text-[var(--theme-text-primary)]"
              >
                Logs
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onSnooze}
          className="-mb-1 -mr-1 min-h-9 self-end px-2 text-[12.5px] text-[var(--theme-text-muted)]"
        >
          Plus tard
        </button>
      </div>
    </div>
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
      <button type="button" onClick={onUndo} className="min-h-9 px-2 text-[13px] font-semibold text-[var(--theme-accent)]">
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
