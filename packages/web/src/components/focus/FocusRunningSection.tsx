import type { Board, FocusRunning, Ticket } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { FocusFavoriteStar, FocusStatusBadge, FocusTicketLead } from './FocusTicketLead';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import { findSessionsForTicketId } from '../dashboard/dashboard-helpers';
import { useSessionStore } from '../../stores/sessionStore';
import { executeSkill } from '../../services/api';
import { FOCUS_ROW_GRID } from './FocusRow';
import { formatWait, waitedMs } from './focusModel';

/** One line of context: who is on the ticket, and how. */
export function runningSummary(r: FocusRunning): string {
  switch (r.source) {
    case 'workflow':
      return `${r.workflow ? `${r.workflow.emoji} ${r.workflow.name} · ` : ''}étape « ${r.label} » en cours`;
    case 'agent':
      return `${r.label} travaille dessus`;
    case 'queued':
      return `${r.label} va s’y mettre (en file d’attente)`;
    case 'cli':
      return 'Session Claude au travail dans le terminal';
  }
}

interface Props {
  running: readonly FocusRunning[];
  ticketById: ReadonlyMap<string, Ticket>;
  boardById: ReadonlyMap<string, Board>;
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenLogs: (executionId: string, title: string) => void;
  onOpenSession: (sessionId: string) => void;
}

/**
 * "By the way": the tickets agents are working on autonomously, under the queue.
 * Collapsed to a counter by default — the page is about what waits on you — and
 * expands into rows shaped like the queue's, with the actions that fit work in
 * flight: follow the logs, open the terminal, open the ticket, launch something else.
 */
export function FocusRunningSection({ running, ticketById, boardById, now, open, onToggle, onOpenTicket, onOpenLogs, onOpenSession }: Props) {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const rows = running
    .filter((r) => ticketById.has(r.ticketId))
    .sort((a, b) => (a.since ?? '￿').localeCompare(b.since ?? '￿'));
  if (rows.length === 0) return null;
  const blue = tintClasses('blue');

  return (
    <section className="mt-5" aria-label="Tickets en cours">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--theme-border)] px-3.5 py-2 text-left text-[12.5px] text-[var(--theme-text-muted)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]"
      >
        <span className={cn('h-[7px] w-[7px] shrink-0 animate-pulse rounded-full motion-reduce:animate-none', blue.solid)} />
        <span>
          Pendant ce temps, <strong className="font-semibold text-[var(--theme-text-primary)]">{rows.length} ticket{rows.length > 1 ? 's' : ''}</strong>{' '}
          {rows.length > 1 ? 'avancent' : 'avance'} en autonomie : rien à faire de ton côté.
        </span>
        <span className="ml-auto text-xs">{open ? 'Masquer ▴' : 'Voir ▾'}</span>
      </button>

      {open && (
        <div className="mt-1.5 grid gap-1.5">
          {rows.map((r) => {
            const ticket = ticketById.get(r.ticketId)!;
            const board = boardById.get(ticket.boardId);
            const sessions = findSessionsForTicketId(ticket.id, sessionGroups);
            const title = `#${ticket.displayId} · ${ticket.title}`;
            return (
              <div
                key={r.ticketId}
                role="button"
                tabIndex={-1}
                onClick={() => onOpenTicket(ticket.id)}
                title="Ouvrir dans Tasks"
                className={cn(
                  'group relative grid cursor-pointer items-center gap-x-3.5 gap-y-2 overflow-hidden rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] py-2.5 pl-4 pr-3 opacity-90 transition-colors hover:border-[var(--theme-border-input)] hover:opacity-100',
                  FOCUS_ROW_GRID,
                )}
              >
                <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', blue.solid)} />
                <span className={cn('col-start-1 row-start-1 inline-flex h-[22px] items-center gap-1.5 justify-self-start rounded-full px-2 text-[11px] font-semibold', blue.bg, blue.text)}>
                  <span className={cn('h-[6px] w-[6px] animate-pulse rounded-full motion-reduce:animate-none', blue.solid)} />
                  {r.source === 'queued' ? 'En file' : 'En cours'}
                </span>

                <FocusStatusBadge ticket={ticket} className="col-start-2 row-start-1" />

                <div className="col-start-3 row-start-1 grid min-w-0 gap-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <FocusTicketLead ticket={ticket} />
                    <span className="whitespace-nowrap font-mono text-[11.5px] text-[var(--theme-text-muted)]">#{ticket.displayId}</span>
                    <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--theme-text-primary)]">{ticket.title}</span>
                    <FocusFavoriteStar ticket={ticket} />
                    {board && (
                      <span className="shrink-0 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-px text-[10.5px] text-[var(--theme-text-muted)]">
                        {board.emoji} {board.name}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12.5px] text-[var(--theme-text-secondary)]">
                    {runningSummary(r)}
                    {r.costUsd > 0 && <span className="ml-2 font-mono text-[11px] text-[var(--theme-text-faint)]">${r.costUsd.toFixed(2)}</span>}
                  </div>
                </div>

                <div
                  className="col-[3/-1] row-start-2 flex flex-wrap items-center gap-1.5 xl:col-[4/5] xl:row-start-1 xl:flex-nowrap xl:justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.source === 'cli' && r.sessionId && (
                    <button
                      type="button"
                      onClick={() => onOpenSession(r.sessionId!)}
                      className="h-7 whitespace-nowrap rounded-md border border-[var(--theme-border-input)] px-2.5 text-xs font-semibold text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
                    >
                      Ouvrir la session
                    </button>
                  )}
                  {r.executionId && (
                    <button
                      type="button"
                      onClick={() => onOpenLogs(r.executionId!, title)}
                      className="h-7 whitespace-nowrap rounded-md border border-[var(--theme-border-input)] px-2.5 text-xs font-semibold text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)]"
                    >
                      Suivre les logs
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenTicket(ticket.id)}
                    className="h-7 whitespace-nowrap rounded-md border border-[var(--theme-border-input)] px-2.5 text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]"
                  >
                    Ouvrir dans Tasks ↗
                  </button>
                </div>

                <div className="col-start-4 row-start-1 flex justify-end xl:col-start-5" onClick={(e) => e.stopPropagation()}>
                  <SmartSessionButton sessions={sessions} ticketId={ticket.id} onExecuteSkill={(skillId) => executeSkill(skillId, ticket.id)} />
                </div>

                <div
                  className="col-start-5 row-start-1 whitespace-nowrap text-right font-mono text-[11.5px] tabular-nums text-[var(--theme-text-muted)] xl:col-start-6"
                  title={r.since ? `En cours depuis le ${new Date(r.since).toLocaleString()}` : undefined}
                >
                  {formatWait(waitedMs(r, now))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
