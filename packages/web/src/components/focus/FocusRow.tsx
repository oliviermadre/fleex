import { forwardRef, useState } from 'react';
import type { Board, FocusItem, Ticket } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tint, tintClasses } from '../../lib/tints';
import { getStatusBadgeClass } from '../../lib/statusColors';
import { PriorityIndicator } from '../tickets/PriorityIndicator';
import { TicketTypeIcon } from '../tickets/TicketTypeBadge';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { useSessionStore } from '../../stores/sessionStore';
import { executeSkill } from '../../services/api';
import { KindIcon } from './FocusIcons';
import { KIND_META, STALE_MS, focusSummary, formatWait, questionOptions, waitedMs, type FocusAction } from './focusModel';

/** Grid shared by every row: kind · ticket · actions · wait · session. */
export const FOCUS_ROW_GRID =
  'grid-cols-[96px_minmax(0,1fr)_64px_108px] xl:grid-cols-[96px_minmax(0,1fr)_auto_64px_108px]';

interface Props {
  item: FocusItem;
  ticket: Ticket;
  board: Board | undefined;
  actions: FocusAction[];
  now: number;
  selected: boolean;
  onOpen: () => void;
  onAction: (action: FocusAction) => void;
  onAnswer: (text: string) => void;
  onOpenLogs: (executionId: string) => void;
}

/**
 * One item of the Focus list — everything needed to act without opening the
 * ticket: the kind, one line of context, the direct CTAs (or a reply field),
 * how long it has waited, and the SmartSessionButton for anything else.
 * A click anywhere else opens the detail popup.
 */
export const FocusRow = forwardRef<HTMLDivElement, Props>(function FocusRow(
  { item, ticket, board, actions, now, selected, onOpen, onAction, onAnswer, onOpenLogs },
  ref,
) {
  const meta = KIND_META[item.kind];
  const hue = tintClasses(meta.hue);
  const wait = waitedMs(item, now);
  const stale = wait !== null && wait > STALE_MS;
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const sessions = findSessionsForTicketId(ticket.id, sessionGroups);
  const [answer, setAnswer] = useState('');
  const options = item.kind === 'question' ? questionOptions(item) : [];

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const send = () => {
    const text = answer.trim();
    if (!text) return;
    onAnswer(text);
    setAnswer('');
  };

  const who =
    item.kind === 'question' ? item.question?.askedBy
      : item.kind === 'gate' ? item.gate?.stepName
        : null;

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      data-focus-key={item.key}
      aria-label={`${meta.label} · #${ticket.displayId} ${ticket.title}`}
      onClick={onOpen}
      className={cn(
        'relative grid cursor-pointer items-center gap-x-3.5 gap-y-2 overflow-hidden rounded-lg border bg-[var(--theme-bg-surface)] py-2.5 pl-4 pr-3 transition-colors',
        FOCUS_ROW_GRID,
        selected
          ? 'border-[var(--theme-accent)] ring-1 ring-[var(--theme-accent)]'
          : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', hue.solid)} />

      <span className={cn('col-start-1 row-start-1 inline-flex h-[22px] items-center gap-1.5 justify-self-start rounded-full px-2 text-[11px] font-semibold', tint(meta.hue))}>
        <KindIcon kind={item.kind} />
        {meta.label}
      </span>

      <div className="col-start-2 row-start-1 grid min-w-0 gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <TicketTypeIcon type={ticket.type} />
          <span className="whitespace-nowrap font-mono text-[11.5px] text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
          <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--theme-text-primary)]">{ticket.title}</span>
          <PriorityIndicator priority={ticket.priority} />
          {board && (
            <span className="shrink-0 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-px text-[10.5px] text-[var(--theme-text-muted)]">
              {board.emoji} {board.name}
            </span>
          )}
          <span className={cn('shrink-0 rounded-full px-1.5 text-[10.5px] font-medium', getStatusBadgeClass(ticket.status))}>
            {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
          </span>
        </div>
        <div className="truncate text-[12.5px] text-[var(--theme-text-secondary)]">
          {who && <span className={cn('mr-1.5', tintClasses('purple').text)}>{item.kind === 'question' ? `@${who}` : who}</span>}
          <span className={item.kind === 'error' ? tintClasses('red').text : undefined}>{focusSummary(item)}</span>
        </div>
        {options.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" onClick={stop}>
            {actions.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAction(a)}
                title={`Répondre « ${a.label} » (${i + 1})`}
                className="h-6 rounded-full border border-dashed border-[var(--theme-border-input)] px-2 text-[11.5px] text-[var(--theme-text-secondary)] hover:border-solid hover:text-[var(--theme-text-primary)]"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Direct actions — second line below xl. */}
      <div
        className="col-[2/-1] row-start-2 flex flex-wrap items-center gap-1.5 xl:col-[3/4] xl:row-start-1 xl:flex-nowrap xl:justify-end"
        onClick={stop}
      >
        {item.kind === 'question' ? (
          <div className="flex w-full items-center gap-1 xl:w-[300px]">
            <input
              value={answer}
              data-focus-reply
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Répondre${item.question?.askedBy ? ` à @${item.question.askedBy}` : ''}…`}
              aria-label="Réponse"
              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={!answer.trim()}
              title="Envoyer (⏎)"
              className="h-7 rounded-md bg-[var(--theme-accent)] px-2.5 text-xs font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
            >
              ↵
            </button>
          </div>
        ) : (
          <>
            {actions.slice(0, 2).map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAction(a)}
                title={a.hint ? `${a.label} ${a.hint} (${i + 1})` : `${a.label} (${i + 1})`}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium',
                  a.primary
                    ? 'bg-[var(--theme-accent)] font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]'
                    : 'border border-[var(--theme-border-input)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]',
                )}
              >
                {a.label}
                <span className="font-mono text-[9.5px] opacity-70">{i + 1}</span>
              </button>
            ))}
            {actions.length > 2 && (
              <button
                type="button"
                onClick={onOpen}
                title="Autres choix"
                className="h-7 rounded-md border border-[var(--theme-border-input)] px-2 text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]"
              >
                +{actions.length - 2}
              </button>
            )}
            {item.kind === 'error' && item.error?.executionId && (
              <button
                type="button"
                onClick={() => onOpenLogs(item.error!.executionId!)}
                className="h-7 rounded-md border border-[var(--theme-border-input)] px-2.5 text-xs text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
              >
                Logs
              </button>
            )}
          </>
        )}
      </div>

      <div
        className={cn(
          'col-start-3 row-start-1 text-right font-mono xl:col-start-4 text-[11.5px] tabular-nums whitespace-nowrap',
          stale ? tintClasses('orange').text : 'text-[var(--theme-text-muted)]',
        )}
        title={item.since ? `En attente depuis le ${new Date(item.since).toLocaleString()}` : undefined}
      >
        {formatWait(wait)}
        {stale && <span className="block font-sans text-[10px] text-[var(--theme-text-faint)]">&gt; 4 h</span>}
      </div>

      <div className="col-start-4 row-start-1 flex justify-end xl:col-start-5" onClick={stop} data-focus-ssb>
        <SmartSessionButton
          sessions={sessions}
          ticketId={ticket.id}
          onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)}
        />
      </div>
    </div>
  );
});
