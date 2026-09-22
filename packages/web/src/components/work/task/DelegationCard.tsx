/**
 * The delegation card in the task stream (design A): `◆ Assistant ⇄ ⌬ <persona>`,
 * a state pill, the brief, the FORWARDED chips and a footer linking to the
 * Threads panel. Turns never render here — they live in the panel. In the
 * `waiting` state the agent's pending question shows with its options so the
 * user can answer without leaving the stream.
 */
import { useState } from 'react';
import type { AgentThread, AgentThreadStatus, TicketComment } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint } from '../../../lib/tints';
import { lastAgentQuestion } from '../selectors';

const STATUS_LABEL: Record<AgentThreadStatus, string> = {
  running: 'in progress',
  idle: 'paused',
  waiting: 'waiting for you',
  concluded: 'concluded',
  failed: 'failed',
};

const STATUS_TINT: Record<AgentThreadStatus, 'yellow' | 'green' | 'red' | 'gray'> = {
  running: 'yellow',
  idle: 'gray',
  waiting: 'yellow',
  concluded: 'green',
  failed: 'red',
};

export function ThreadStatusPill({ status, className }: { status: AgentThreadStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tint(STATUS_TINT[status]),
        className,
      )}
    >
      {status === 'running' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--theme-accent)]" aria-hidden />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

interface Props {
  thread: AgentThread;
  /** The thread's turns (comments with `threadId === thread.id`), oldest first. */
  turns: TicketComment[];
  personaDisplayName: string;
  onOpen: (threadId: string) => void;
  onAnswer: (threadId: string, text: string) => void | Promise<void>;
}

function lastLine(turns: readonly TicketComment[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const c = turns[i]!;
    if (c.authorType !== 'agent') continue;
    const line = c.body.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    if (!line) return null;
    return line.length > 80 ? `${line.slice(0, 77)}…` : line;
  }
  return null;
}

export function DelegationCard({ thread, turns, personaDisplayName, onOpen, onAnswer }: Props) {
  const [answered, setAnswered] = useState<string | null>(null);
  const question = thread.status === 'waiting' ? lastAgentQuestion(turns) : null;
  const last = lastLine(turns);

  return (
    <div className="ml-8 flex flex-col gap-1.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5 text-[13px]">
      <div className="flex items-center gap-2 font-semibold text-[var(--theme-text-primary)]">
        <span className="text-[var(--theme-accent)]" aria-hidden>◆</span>
        <span>Assistant</span>
        <span className="text-[var(--theme-text-faint)]" aria-hidden>⇄</span>
        <span className="text-[var(--tint-purple-text)]" aria-hidden>⌬</span>
        <span>{personaDisplayName}</span>
        <ThreadStatusPill status={thread.status} className="ml-auto" />
      </div>

      <div className="text-[var(--theme-text-secondary)]">{thread.brief}</div>

      {thread.forwardedContext.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[10px] font-semibold tracking-[0.06em] text-[var(--theme-text-faint)]">FORWARDED</span>
          {thread.forwardedContext.map((k) => (
            <span
              key={k}
              className="rounded border border-[var(--theme-border)] px-1.5 py-px font-mono text-[10.5px] text-[var(--theme-text-secondary)]"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      {question && (
        <div className="mt-0.5 rounded-lg border border-[var(--tint-yellow-border)] bg-[var(--tint-yellow-bg)] px-2.5 py-2">
          <div className="mb-1.5 text-[12.5px] text-[var(--theme-text-primary)]">
            <b className="font-semibold text-[var(--tint-purple-text)]">{personaDisplayName}</b> asks:{' '}
            {question.comment.body.split('\n').find((l) => l.trim().length > 0 && !/^\s*[-*•]\s/.test(l)) ?? ''}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {question.options.map((opt, i) => (
              <button
                key={opt}
                type="button"
                disabled={answered !== null}
                onClick={() => {
                  setAnswered(opt);
                  void onAnswer(thread.id, opt);
                }}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-[12px] disabled:opacity-60',
                  i === 0 && answered === null
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-bg-primary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                  answered === opt && 'ring-1 ring-[var(--theme-accent)]',
                )}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onOpen(thread.id)}
              className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2.5 py-1 text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
            >
              Reply…
            </button>
          </div>
        </div>
      )}

      {thread.status === 'concluded' && thread.summary && (
        <div className="text-[12.5px] text-[var(--theme-text-secondary)]">{thread.summary}</div>
      )}

      <div className="mt-0.5 flex items-center gap-2 border-t border-dashed border-[var(--theme-border)] pt-1.5 text-[11.5px] text-[var(--theme-text-secondary)]">
        <span>{thread.exchanges} exchange{thread.exchanges === 1 ? '' : 's'}</span>
        {last && !question && (
          <>
            <span className="text-[var(--theme-text-faint)]">·</span>
            <span className="min-w-0 truncate italic">« {last} »</span>
          </>
        )}
        <button
          type="button"
          onClick={() => onOpen(thread.id)}
          className="ml-auto whitespace-nowrap font-semibold text-[var(--theme-accent)] hover:underline"
        >
          Open thread ›
        </button>
      </div>
    </div>
  );
}
