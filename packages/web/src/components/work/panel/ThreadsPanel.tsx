/**
 * The Threads tool window (SPEC §6.2): the ticket's assistant ⇄ agent threads on
 * top, the selected thread below with a Conversation tab (turns, tool calls
 * summary, forwarded context) and an Agent SDK stream tab (the live execution
 * log of the agent's current run). Footer: step into the thread as You, or ask
 * the assistant to conclude now.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AgentExecution, AgentThread, TicketComment, TicketDeliverable, TicketMention } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { formatAge } from '../../../lib/formatAge';
import * as api from '../../../services/api';
import { useWorkStore } from '../../../stores/workStore';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import { toast } from '../../../lib/toast';
import { AgentEventStream } from '../../main-panel/AgentEventStream';
import { MessageMarkdown } from '../task/MessageMarkdown';
import { ThreadStatusPill } from '../task/DelegationCard';
import { RunCard } from '../task/RunCard';
import { Composer } from '../task/Composer';
import { DeliverableCard } from '../task/DeliverableCard';
import type { WorkTask } from '../types';
import { useTicketThreads } from './useTicketThreads';
import { useThreadStats } from './useThreadStats';
import { NO_STATS } from './threadStats';
import { useThreadTurns } from './useThreadTurns';
import { resolveSelectedThread } from './threadSelection';
import { threadTargetLabel } from '../selectors';

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

export function ThreadsPanel({ task, deliverables, onOpenExecution }: { task: WorkTask; deliverables: TicketDeliverable[]; onOpenExecution: (executionId: string, title: string) => void }) {
  const threads = useTicketThreads(task.id);
  const stats = useThreadStats(task.id);
  const selectedThreadId = useWorkStore((s) => s.selectedThreadId);
  const setSelectedThreadId = useWorkStore((s) => s.setSelectedThreadId);
  const threadTab = useWorkStore((s) => s.threadTab);
  const setThreadTab = useWorkStore((s) => s.setThreadTab);
  const personas = useAgentPersonaStore((s) => s.personas);
  const executions = useAgentEventStore((s) => s.executionsByTicket[task.id]);

  // Two-level navigation: show list of threads OR detail of selected thread.
  // Opening a thread closes the list from the click handler (not from an effect on
  // selectedThreadId, which never fires when the clicked thread is already selected).
  const [showThreadList, setShowThreadList] = useState(false);

  const thread = resolveSelectedThread(threads, selectedThreadId);
  const turns = useThreadTurns(thread?.id ?? null);
  const personaName = (t: AgentThread) => threadTargetLabel(t, personas.find((p) => p.id === t.personaId)?.displayName);

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
  // Every run the thread opened, oldest first — the run cards of the conversation
  // tab and the run picker of the stream tab (a mention can run several times).
  const threadExecutions = useMemo(
    () => (executions ?? []).filter((e) => threadMentionIds.has(e.mentionId)).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    [executions, threadMentionIds],
  );
  // The agent's results: deliverables attached to the thread's mentions.
  const threadDeliverables = useMemo(
    () => deliverables.filter((d) => d.mentionId && threadMentionIds.has(d.mentionId)),
    [deliverables, threadMentionIds],
  );
  const currentExecution = useMemo(() => {
    const ofMention = thread?.currentMentionId ? threadExecutions.filter((e) => e.mentionId === thread.currentMentionId) : [];
    return ofMention.at(-1) ?? threadExecutions.at(-1) ?? null;
  }, [threadExecutions, thread?.currentMentionId]);
  const [pickedExecutionId, setPickedExecutionId] = useState<string | null>(null);
  const streamExecution: AgentExecution | null =
    (pickedExecutionId ? threadExecutions.find((e) => e.id === pickedExecutionId) : undefined) ?? currentExecution;

  // "running" on the thread means the mention is open; the agent itself may still be
  // queued behind another run (agent concurrency limit) — say so instead of "working".
  const agentRunning = threadExecutions.some((e) => e.status === 'running');
  const currentMention = thread?.currentMentionId ? mentions.find((m) => m.id === thread.currentMentionId) ?? null : null;
  // Derived from the mention and the executions, not from the stored thread status,
  // so a stale status never claims an agent is working.
  const agentState: 'working' | 'queued' | 'answered' | 'failed' | 'asking' | 'none' = agentRunning
    ? 'working'
    : currentMention?.status === 'pending' || currentMention?.status === 'acknowledged'
      ? 'queued'
      : currentMention?.status === 'waiting_for_info'
        ? 'asking'
        : currentMention?.status === 'failed'
          ? 'failed'
          : currentMention?.status === 'resolved'
            ? 'answered'
            : 'none';

  // The list shows the newest thread first, by the same date as the age on each card;
  // the status dot says what is still open. Hooks stay above the empty-state return.
  const sortedThreads = useMemo(() => [...threads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [threads]);

  // Default selection: the most recent thread that is not concluded, else the most recent one.
  useEffect(() => {
    if (!selectedThreadId && sortedThreads.length > 0) {
      const open = sortedThreads.find((t) => t.status !== 'concluded' && t.status !== 'failed');
      setSelectedThreadId((open ?? sortedThreads[0]!).id);
    }
  }, [sortedThreads, selectedThreadId, setSelectedThreadId]);

  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  // Called by the shared Composer (rich editor: image paste, attach, @-mentions) with the final body.
  const stepIn = async (body: string) => {
    if (!thread || !body.trim() || busy) return;
    setBusy(true);
    try {
      await api.postThreadMessage(thread.id, body.trim());
    } catch (err) {
      toast.error('Failed to send message', { detail: err instanceof Error ? err.message : 'Unknown error' });
      throw err; // Composer keeps the draft when onSend throws
    } finally {
      setBusy(false);
    }
  };
  const nudgeAssistant = async () => {
    if (!thread || busy) return;
    setBusy(true);
    try {
      await api.postAssistantMessage(task.id, `Reprends le thread avec ${personaName(thread)} : relance-le jusqu'à un résultat concret, ou conclus si c'est terminé.`);
    } finally {
      setBusy(false);
    }
  };
  const conclude = async () => {
    if (!thread || busy) return;
    setBusy(true);
    try {
      const result = await api.concludeThread(thread.id);
      // Show confirmation toast with count of auto-terminated runs
      if (result.runsAutoTerminated > 0) {
        toast.success(`Thread concluded. ${result.runsAutoTerminated} run${result.runsAutoTerminated !== 1 ? 's' : ''} auto-terminated.`);
      } else {
        toast.success('Thread concluded.');
      }
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
      {/* Two-Level Navigation: List or Detail */}
      {showThreadList ? (
        // LEVEL 1: Thread List View
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
            {sortedThreads.map((t) => {
              const isSelected = t.id === selectedThreadId;
              const st = stats.get(t.id) ?? NO_STATS;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedThreadId(t.id);
                    setShowThreadList(false);
                  }}
                  className={cn(
                    'group flex min-h-0 flex-col gap-1.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
                      : 'border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] hover:border-[var(--theme-accent)] hover:bg-[var(--theme-accent-muted)]'
                  )}
                >
                  {/* Name + self-explaining state + counters + age */}
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-semibold text-[var(--theme-text-primary)]">{personaName(t)}</span>
                    <ThreadStatusPill
                      status={t.status}
                      live={st.activeRuns > 0}
                      label={st.activeRuns > 0 ? 'run in progress' : undefined}
                      title={st.activeRuns > 0 ? `${st.activeRuns} SDK run${st.activeRuns > 1 ? 's' : ''} executing right now` : undefined}
                      className="shrink-0"
                    />
                    <span className="ml-auto flex shrink-0 items-center gap-2.5 text-[11px] text-[var(--theme-text-faint)]">
                      <span className="inline-flex items-center gap-1" title={`${st.messages} message${st.messages === 1 ? '' : 's'}`}>
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                        </svg>
                        {st.messages}
                      </span>
                      <span className="inline-flex items-center gap-1" title={`${st.runs} SDK run${st.runs === 1 ? '' : 's'}${st.activeRuns > 0 ? ` (${st.activeRuns} running)` : ''}`}>
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                        {st.runs}
                      </span>
                      <span>{formatAge(t.createdAt)}</span>
                    </span>
                  </div>

                  {/* Brief & Participants */}
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--theme-text-secondary)]">{t.brief || '(no brief)'}</span>
                    {t.participants && t.participants.length > 0 && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        {t.participants.slice(0, 3).map((p) => (
                          <div
                            key={p.userId}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--theme-bg-secondary)] text-[8px] font-semibold text-[var(--theme-text-primary)]"
                            title={p.displayName}
                          >
                            {p.avatar ? (
                              <img src={p.avatar} alt={p.displayName} className="h-full w-full rounded-full object-cover" />
                            ) : (
                              p.displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                        ))}
                        {t.participants.length > 3 && (
                          <span className="text-[9px] font-semibold text-[var(--theme-text-faint)]">+{t.participants.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) :
        // LEVEL 2: Thread Detail View
        thread && (
          <>
          {/* One header line: back · who · status · title · participants · cost · conclude, then the tabs */}
          <div className="shrink-0 px-3 pt-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--theme-text-primary)]">
              <button
                type="button"
                aria-label="Back to the thread list"
                title="Back to the thread list"
                onClick={() => setShowThreadList(true)}
                className="-ml-1.5 shrink-0 rounded px-1.5 py-0.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]"
              >
                ←
              </button>
              <span className="text-[var(--theme-accent)]" aria-hidden>◆</span>
              <span className="text-[var(--theme-text-faint)]" aria-hidden>⇄</span>
              <span className="text-[var(--tint-purple-text)]" aria-hidden>⌬</span>
              <span className="min-w-0 truncate">{personaName(thread)}</span>
              <ThreadStatusPill status={thread.status} />
              {/* Title generated by Haiku; until it exists (or if it failed) show the brief, truncated. */}
              {(() => {
                const label = thread.generatedTitle || thread.brief;
                return label ? (
                  <span className="min-w-0 flex-1 truncate text-[12px] font-normal text-[var(--theme-text-secondary)]" title={label}>
                    {label}
                  </span>
                ) : (
                  <span className="flex-1" />
                );
              })()}
              {thread.participants && thread.participants.length > 0 && (
                <div className="flex shrink-0 items-center gap-1">
                  {thread.participants.slice(0, 5).map((p) => (
                    <div
                      key={p.userId}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--theme-bg-secondary)] text-[9px] font-semibold text-[var(--theme-text-primary)]"
                      title={p.displayName}
                    >
                      {p.avatar ? (
                        <img src={p.avatar} alt={p.displayName} className="h-full w-full rounded-full object-cover" />
                      ) : (
                        p.displayName.charAt(0).toUpperCase()
                      )}
                    </div>
                  ))}
                  {thread.participants.length > 5 && (
                    <span className="text-[10px] font-semibold text-[var(--theme-text-secondary)]">+{thread.participants.length - 5}</span>
                  )}
                </div>
              )}
              {cost > 0 && (
                <span className="shrink-0 font-mono text-[11px] font-normal text-[var(--theme-text-faint)]">${cost.toFixed(2)}</span>
              )}
              {!terminal && (
                <button
                  type="button"
                  onClick={() => void conclude()}
                  disabled={busy}
                  title="Stop the agent and ask the assistant to bring the result back"
                  className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-normal text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)] disabled:opacity-50"
                >
                  Conclude ↩
                </button>
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
              {[
                ...turns.map((t) => ({ at: Date.parse(t.createdAt), key: `c-${t.id}`, node: <Turn key={`c-${t.id}`} turn={t} /> })),
                // A run sits just before the reply it produced (same convention as the main stream).
                ...threadExecutions.map((e) => ({ at: Date.parse(e.startedAt) - 1, key: `r-${e.id}`, node: <RunCard key={`r-${e.id}`} execution={e} onOpen={onOpenExecution} /> })),
                // A deliverable sits just after the turn that announced it.
                ...threadDeliverables.map((d) => ({ at: Date.parse(d.createdAt) + 1, key: `d-${d.id}`, node: <DeliverableCard key={`d-${d.id}`} deliverable={d} /> })),
              ]
                .sort((a, b) => a.at - b.at)
                .map((x) => x.node)}
              {/* The running RunCard above already says the agent is working: no duplicate line. */}
              {!terminal && agentState !== 'working' && (
                <div className="flex items-center gap-2 pl-7 text-[11.5px] text-[var(--theme-text-muted)]">
                  <span className={agentState === 'queued' ? 'text-[var(--tint-purple-text)]' : 'text-[var(--theme-accent)]'} aria-hidden>
                    {agentState === 'queued' ? '⌬' : '◆'}
                  </span>
                  <span>
                    {agentState === 'queued' && `${personaName(thread)} is queued — starts as soon as its previous turn settles…`}
                    {agentState === 'asking' && `${personaName(thread)} asked a question — the assistant answers, or you step in below`}
                    {agentState === 'failed' && `${personaName(thread)}'s run failed — the assistant relaunches or reports back`}
                    {agentState === 'answered' && `${personaName(thread)} answered · the assistant paused the thread here`}
                    {agentState === 'none' && (thread.status === 'waiting' ? 'Waiting for you — answer in the main stream or step in below' : 'No agent run yet')}
                  </span>
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
              {streamExecution ? (
                <>
                  {threadExecutions.length > 1 && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--theme-border-subtle)] px-3 py-1.5 text-[11px]">
                      <span className="mr-1 text-[10px] font-semibold tracking-[0.06em] text-[var(--theme-text-faint)]">RUNS</span>
                      {threadExecutions.map((e, i) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setPickedExecutionId(e.id)}
                          className={cn(
                            'rounded border px-1.5 py-0.5 font-mono',
                            e.id === streamExecution.id
                              ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
                              : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                          )}
                          title={`${e.status} · ${e.startedAt}`}
                        >
                          #{i + 1} {e.status === 'running' ? '●' : e.status === 'failed' ? '✕' : e.status === 'interrupted' ? '◌' : '✓'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <AgentEventStream executionId={streamExecution.id} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2 border-t border-[var(--theme-border)] px-3 py-2 text-[11.5px] text-[var(--theme-text-secondary)]">
                    <span className="font-mono text-[var(--theme-text-faint)]">exec {streamExecution.id.slice(0, 8)} · {streamExecution.status}</span>
                    <button type="button" onClick={() => onOpenExecution(streamExecution.id, personaName(thread))} className="ml-auto text-[var(--theme-accent)] hover:underline">Open in Execution log</button>
                    {streamExecution.status === 'running' && (
                      <button
                        type="button"
                        onClick={() => void api.cancelExecution(streamExecution.id)}
                        className="rounded-md border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] px-2 py-0.5 text-[11.5px] text-[var(--tint-red-text)]"
                      >
                        Terminate
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] text-[var(--theme-text-faint)]">
                  {agentState === 'queued'
                    ? 'No execution yet — the agent is queued behind another run (agent concurrency limit). The stream appears as soon as it starts.'
                    : 'No execution for this thread yet.'}
                </div>
              )}
            </div>
          )}

          {!terminal && thread.status === 'idle' && (
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-[11.5px] text-[var(--theme-text-secondary)]">
              <span className="min-w-0 flex-1">The assistant left this thread without relaunching the agent.</span>
              <button
                type="button"
                onClick={() => void nudgeAssistant()}
                disabled={busy}
                className="shrink-0 whitespace-nowrap rounded-md bg-[var(--theme-accent)] px-2.5 py-1 text-[12px] text-[var(--theme-accent-fg)] hover:opacity-90 disabled:opacity-50"
              >
                ◆ Ask the assistant to continue
              </button>
            </div>
          )}
          {!terminal && (
            <Composer
              ticketId={task.id}
              value={reply}
              onChange={setReply}
              onSend={stepIn}
              posting={busy}
              showExecBar={false}
              placeholder="Step into the thread…"
            />
          )}
        </>
        )}
    </div>
  );
}
