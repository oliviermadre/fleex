/**
 * The Threads tool window (SPEC §6.2): the ticket's assistant ⇄ agent threads on
 * top, the selected thread below with a Conversation tab (turns, tool calls
 * summary, forwarded context) and an Agent SDK stream tab (the live execution
 * log of the agent's current run). Footer: step into the thread as You, or ask
 * the assistant to conclude now.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AgentThread, TicketComment, TicketMention } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { formatAge } from '../../../lib/formatAge';
import * as api from '../../../services/api';
import { useWorkStore } from '../../../stores/workStore';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import { AgentEventStream } from '../../main-panel/AgentEventStream';
import { MessageMarkdown } from '../task/MessageMarkdown';
import { ThreadStatusPill } from '../task/DelegationCard';
import type { WorkTask } from '../types';
import { useTicketThreads } from './useTicketThreads';
import { useThreadTurns } from './useThreadTurns';
import { resolveSelectedThread } from './threadSelection';

const DOT: Record<AgentThread['status'], string> = {
  running: 'bg-[var(--theme-accent)] animate-pulse',
  waiting: 'bg-[var(--tint-yellow-solid)]',
  concluded: 'bg-[var(--tint-green-solid)]',
  failed: 'bg-[var(--tint-red-solid)]',
};

function Turn({ turn }: { turn: TicketComment }) {
  if (turn.authorType === 'user') {
    return (
      <div className="flex justify-end">
        <div className="min-w-0 max-w-[85%] overflow-hidden rounded-xl rounded-br-sm bg-[var(--theme-accent-muted)] px-2.5 py-1.5 text-[12.5px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={turn.body} />
        </div>
      </div>
    );
  }
  const isAssistant = turn.authorType === 'assistant';
  return (
    <div className="flex gap-2">
      <div
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]',
          isAssistant
            ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
            : 'bg-[var(--tint-purple-bg)] text-[var(--tint-purple-text)]',
        )}
        aria-hidden
      >
        {isAssistant ? '◆' : '⌬'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-medium text-[var(--theme-text-secondary)]">
          {turn.authorName || (isAssistant ? 'Assistant' : 'Agent')}
        </div>
        <div className="min-w-0 overflow-hidden text-[12.5px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={turn.body} />
        </div>
      </div>
    </div>
  );
}

export function ThreadsPanel({ task }: { task: WorkTask }) {
  const threads = useTicketThreads(task.id);
  const selectedThreadId = useWorkStore((s) => s.selectedThreadId);
  const setSelectedThreadId = useWorkStore((s) => s.setSelectedThreadId);
  const threadTab = useWorkStore((s) => s.threadTab);
  const setThreadTab = useWorkStore((s) => s.setThreadTab);
  const personas = useAgentPersonaStore((s) => s.personas);
  const executions = useAgentEventStore((s) => s.executionsByTicket[task.id]);

  const thread = resolveSelectedThread(threads, selectedThreadId);
  const turns = useThreadTurns(thread?.id ?? null);
  const personaName = (t: AgentThread) => personas.find((p) => p.id === t.personaId)?.displayName ?? t.personaName;

  // Cost = the agent runs this thread opened (executions of its mentions).
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  useEffect(() => {
    api.fetchTicketMentions(task.id).then(setMentions).catch(() => setMentions([]));
  }, [task.id, turns.length]);
  const threadMentionIds = useMemo(() => {
    const turnIds = new Set(turns.map((t) => t.id));
    return new Set(mentions.filter((m) => turnIds.has(m.commentId)).map((m) => m.id));
  }, [mentions, turns]);
  const cost = useMemo(
    () => (executions ?? []).filter((e) => threadMentionIds.has(e.mentionId)).reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
    [executions, threadMentionIds],
  );
  const currentExecution = useMemo(
    () => (thread?.currentMentionId ? (executions ?? []).find((e) => e.mentionId === thread.currentMentionId) ?? null : null),
    [executions, thread?.currentMentionId],
  );

  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const stepIn = async () => {
    if (!thread || !reply.trim() || busy) return;
    setBusy(true);
    try {
      await api.postThreadMessage(thread.id, reply.trim());
      setReply('');
    } finally {
      setBusy(false);
    }
  };
  const conclude = async () => {
    if (!thread || busy) return;
    setBusy(true);
    try {
      await api.concludeThread(thread.id);
    } finally {
      setBusy(false);
    }
  };

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] text-[var(--theme-text-faint)]">
        No thread yet. Ask the assistant to see something with an agent, and the delegation shows up here.
      </div>
    );
  }

  const terminal = thread ? thread.status === 'concluded' || thread.status === 'failed' : true;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread list */}
      <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-[var(--theme-border)]">
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedThreadId(t.id)}
            className={cn(
              'flex w-full items-center gap-2 border-b border-[var(--theme-border-subtle)] px-3 py-2 text-left text-[12.5px] hover:bg-[var(--theme-bg-hover)]',
              thread?.id === t.id && 'bg-[var(--theme-accent-muted)]',
            )}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[t.status])} aria-hidden />
            <span className="shrink-0 font-semibold text-[var(--theme-text-primary)]">{personaName(t)}</span>
            <span className="min-w-0 truncate text-[var(--theme-text-secondary)]">{t.brief}</span>
            <span className="ml-auto shrink-0 text-[11px] text-[var(--theme-text-faint)]">{formatAge(t.createdAt)}</span>
          </button>
        ))}
      </div>

      {thread && (
        <>
          {/* Header + tabs */}
          <div className="shrink-0 px-3 pt-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--theme-text-primary)]">
              <span className="text-[var(--theme-accent)]" aria-hidden>◆</span>
              <span className="text-[var(--theme-text-faint)]" aria-hidden>⇄</span>
              <span className="text-[var(--tint-purple-text)]" aria-hidden>⌬</span>
              <span className="min-w-0 truncate">{personaName(thread)}</span>
              <ThreadStatusPill status={thread.status} />
              {cost > 0 && (
                <span className="ml-auto font-mono text-[11px] font-normal text-[var(--theme-text-faint)]">${cost.toFixed(2)}</span>
              )}
            </div>
            <div className="mt-2 flex gap-4 border-b border-[var(--theme-border)] text-[12px]">
              {(['conv', 'stream'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setThreadTab(tab)}
                  className={cn(
                    'pb-1.5',
                    threadTab === tab
                      ? 'border-b-2 border-[var(--theme-accent)] font-semibold text-[var(--theme-accent)]'
                      : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]',
                  )}
                >
                  {tab === 'conv' ? 'Conversation' : 'Agent SDK stream'}
                </button>
              ))}
            </div>
          </div>

          {threadTab === 'conv' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
              {thread.forwardedContext.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-0.5 text-[10px] font-semibold tracking-[0.06em] text-[var(--theme-text-faint)]">CONTEXT FORWARDED</span>
                  {thread.forwardedContext.map((k) => (
                    <span key={k} className="rounded border border-[var(--theme-border)] px-1.5 py-px font-mono text-[10.5px] text-[var(--theme-text-secondary)]">
                      {k}
                    </span>
                  ))}
                </div>
              )}
              {turns.map((t) => <Turn key={t.id} turn={t} />)}
              {thread.status === 'running' && (
                <div className="flex items-center gap-2 pl-7 text-[11.5px] text-[var(--theme-text-muted)]">
                  <span className="text-[var(--tint-purple-text)]" aria-hidden>⌬</span>
                  <span>{personaName(thread)} is working…</span>
                </div>
              )}
              {thread.status === 'concluded' && (
                <div className="pl-7 text-[11.5px] text-[var(--theme-text-muted)]">Concluded · summary posted back to the main thread</div>
              )}
              {thread.status === 'failed' && (
                <div className="pl-7 text-[11.5px] text-[var(--tint-red-text)]">The agent run failed · the assistant was notified</div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {currentExecution ? (
                <>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <AgentEventStream executionId={currentExecution.id} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2 border-t border-[var(--theme-border)] px-3 py-2 text-[11.5px] text-[var(--theme-text-secondary)]">
                    <span className="font-mono text-[var(--theme-text-faint)]">exec {currentExecution.id.slice(0, 8)}</span>
                    {currentExecution.status === 'running' && (
                      <button
                        type="button"
                        onClick={() => void api.cancelExecution(currentExecution.id)}
                        className="ml-auto rounded-md border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] px-2 py-0.5 text-[11.5px] text-[var(--tint-red-text)]"
                      >
                        Terminate
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--theme-text-faint)]">No execution yet for this thread.</div>
              )}
            </div>
          )}

          {!terminal && (
            <div className="flex shrink-0 gap-2 border-t border-[var(--theme-border)] px-3 py-2">
              <label htmlFor="thread-step-in" className="sr-only">Step into the thread</label>
              <input
                id="thread-step-in"
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void stepIn();
                  }
                }}
                placeholder="Step into the thread…"
                disabled={busy}
                className="min-w-0 flex-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2.5 py-1.5 text-[12.5px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              />
              <button
                type="button"
                onClick={() => void conclude()}
                disabled={busy}
                title="Stop the agent and ask the assistant to bring the result back"
                className="shrink-0 whitespace-nowrap rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5 text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] disabled:opacity-50"
              >
                Conclude now ↩
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
