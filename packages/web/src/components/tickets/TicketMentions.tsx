import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TicketMention, MentionStatus, MentionExecutionMode, AgentExecution, TicketWsMessage, MentionExecutionFailedPayload } from '@fleex/shared';
import { appWs } from '../../services/websocket';
import { tint, tintText, tintClasses } from '../../lib/tints';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useToastStore } from '../../stores/toastStore';
import { FloatingExecutionPanel } from './ExecutionModal';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { useTicketStore } from '../../stores/ticketStore';
import { isMissingRepo } from '../../lib/repoStatus';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import * as api from '../../services/api';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_CONFIG: Record<MentionStatus, { label: string; color: string; bg: string; dot: string }> = {
  pending: {
    label: 'Pending',
    color: tintText('yellow'),
    bg: tintClasses('yellow').bg,
    dot: tintClasses('yellow').solid,
  },
  acknowledged: {
    label: 'Acknowledged',
    color: tintText('blue'),
    bg: tintClasses('blue').bg,
    dot: tintClasses('blue').solid,
  },
  waiting_for_info: {
    label: 'Waiting',
    color: tintText('orange'),
    bg: tintClasses('orange').bg,
    dot: tintClasses('orange').solid,
  },
  resolved: {
    label: 'Resolved',
    color: tintText('green'),
    bg: tintClasses('green').bg,
    dot: tintClasses('green').solid,
  },
  failed: {
    label: 'Failed',
    color: tintText('red'),
    bg: tintClasses('red').bg,
    dot: tintClasses('red').solid,
  },
};

const STATUS_ORDER: MentionStatus[] = ['pending', 'acknowledged', 'waiting_for_info', 'failed', 'resolved'];

type FilterStatus = MentionStatus | 'all';

function StatusDropdown({
  currentStatus,
  onSelect,
}: {
  currentStatus: MentionStatus;
  onSelect: (status: MentionStatus) => void;
}) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-end',
  });

  const cfg = STATUS_CONFIG[currentStatus]!;

  return (
    <div className="relative">
      <button
        ref={refs.setReference}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80 ${cfg.bg} ${cfg.color}`}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        title="Change status"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
        <svg className="ml-0.5 h-2.5 w-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-20 min-w-[120px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
          >
            {STATUS_ORDER.map((s) => {
              const sc = STATUS_CONFIG[s]!;
              return (
                <button
                  key={s}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--theme-bg-hover)] ${
                    s === currentStatus ? 'font-semibold' : ''
                  } ${sc.color}`}
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                  }}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                  {sc.label}
                </button>
              );
            })}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

const MODE_CONFIG: Record<MentionExecutionMode, { label: string; color: string; bg: string }> = {
  talk: { label: 'Talk', color: tintText('teal'), bg: tintClasses('teal').bg },
  plan: { label: 'Plan', color: tintText('yellow'), bg: tintClasses('yellow').bg },
  edit: { label: 'Edit', color: tintText('green'), bg: tintClasses('green').bg },
};

function MentionModeToggle({
  mode,
  onChange,
  disabled = false,
}: {
  mode: MentionExecutionMode;
  onChange: (mode: MentionExecutionMode) => void;
  disabled?: boolean;
}) {
  const modes: MentionExecutionMode[] = ['talk', 'plan', 'edit'];
  return (
    <div className={`inline-flex items-center overflow-hidden rounded-full border border-[var(--theme-border)] ${disabled ? 'opacity-50' : ''}`}>
      {modes.map((m) => {
        const cfg = MODE_CONFIG[m];
        return (
          <button
            key={m}
            disabled={disabled}
            className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              mode === m ? `${cfg.bg} ${cfg.color}` : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]'
            } ${disabled ? 'cursor-default' : ''}`}
            onClick={() => !disabled && onChange(m)}
            title={`${cfg.label} mode`}
          >
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

export function TicketMentions({ ticketId }: { ticketId: string }) {
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');
  // The parent ticket drives the missing-repo guard: executing a mention spins
  // up a run that needs a worktree, which a repo-less ticket can't provide.
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  // Mention held by the guard until the user confirms running with no codebase.
  const [repoGuardMention, setRepoGuardMention] = useState<TicketMention | null>(null);
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );

  /** Show the configured human name instead of "user" */
  const displaySource = (name: string) =>
    name === 'user' && humanMentionName ? humanMentionName : name;

  useEffect(() => {
    const ac = new AbortController();
    api.fetchTicketMentions(ticketId, { signal: ac.signal }).then(setMentions).catch(api.ignoreAbort);
    return () => ac.abort();
  }, [ticketId]);

  // Per-mention startup failures (server emitted mention:execution_failed
  // before the mention could reach `acknowledged`). Keyed by mentionId.
  const [failures, setFailures] = useState<Record<string, { reason: string; message: string }>>({});

  // Real-time updates
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        const msg = raw as TicketWsMessage;
        if (msg.type === 'mention:created') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => {
              if (prev.some((x) => x.id === m.id)) return prev;
              return [...prev, m];
            });
          }
        } else if (
          msg.type === 'mention:acknowledged' ||
          msg.type === 'mention:resolved' ||
          msg.type === 'mention:waiting_for_info' ||
          msg.type === 'mention:updated'
        ) {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
            // A subsequent *successful* state change clears any prior failure.
            // The companion mention:updated that accompanies a crash carries
            // status `failed` — keep the live reason/message for it.
            setFailures((prev) => {
              if (m.status === 'failed' || !(m.id in prev)) return prev;
              const { [m.id]: _drop, ...rest } = prev;
              return rest;
            });
          }
        } else if (msg.type === 'mention:execution_failed') {
          const d = msg.data as MentionExecutionFailedPayload;
          if (d.ticketId === ticketId) {
            setFailures((prev) => ({
              ...prev,
              [d.mentionId]: { reason: d.reason, message: d.message },
            }));
            useToastStore.getState().addToast('error', `${d.targetAgent}: ${d.message}`);
          }
        } else if (msg.type === 'mention:deleted') {
          const d = msg.data as { id: string; ticketId: string };
          if (d.ticketId === ticketId) {
            setMentions((prev) => prev.filter((x) => x.id !== d.id));
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId]);

  const personas = useAgentPersonaStore((s) => s.personas);
  const personaByName = useMemo(() => {
    const map = new Map<string, string>(); // name -> id
    for (const p of personas) map.set(p.name, p.id);
    return map;
  }, [personas]);

  const [executing, setExecuting] = useState<Set<string>>(new Set());
  const [modalExecutionId, setModalExecutionId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');

  // Execution lookup: match mentions to their executions
  const executionsByTicket = useAgentEventStore((s) => s.executionsByTicket);
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  useEffect(() => { loadExecutionsForTicket(ticketId); }, [ticketId, loadExecutionsForTicket]);

  const executionByMention = useMemo(() => {
    const execs = executionsByTicket[ticketId] ?? [];
    const map = new Map<string, AgentExecution>();
    for (const exec of execs) {
      const existing = map.get(exec.mentionId);
      // Keep the latest execution per mention
      if (!existing || exec.startedAt > existing.startedAt) {
        map.set(exec.mentionId, exec);
      }
    }
    return map;
  }, [executionsByTicket, ticketId]);

  const openExecution = useCallback((mention: TicketMention) => {
    const exec = executionByMention.get(mention.id);
    if (!exec) return;
    setModalTitle(`${mention.targetAgent} execution`);
    setModalExecutionId(exec.id);
  }, [executionByMention]);

  const runMentionNow = useCallback(async (mention: TicketMention) => {
    const agentName = mention.targetAgent;
    setExecuting((prev) => new Set(prev).add(agentName));
    // Clear any stale failure chip for this mention — a fresh ▶ is a fresh
    // attempt; the chip will come back if it fails again.
    setFailures((prev) => {
      if (!prev[mention.id]) return prev;
      const { [mention.id]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      const result = await api.runMention(mention.id);
      if (result.status === 'no_work') {
        useToastStore.getState().addToast('info', `Nothing to execute for ${agentName}`);
      } else if (result.status === 'already_running') {
        useToastStore.getState().addToast('info', `${agentName} is already running`);
      }
    } catch {
      // ignore
    } finally {
      setExecuting((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
    }
  }, []);

  const handleExecute = useCallback(async (mention: TicketMention) => {
    // Missing-repo guard-rail: running a mention builds a worktree to work in.
    // With no repository linked, the run has no codebase — hold and confirm.
    if (ticket && isMissingRepo(ticket)) {
      setRepoGuardMention(mention);
      return;
    }
    await runMentionNow(mention);
  }, [ticket, runMentionNow]);

  const confirmRepoGuardAndRun = useCallback(async () => {
    const mention = repoGuardMention;
    setRepoGuardMention(null);
    if (mention) await runMentionNow(mention);
  }, [repoGuardMention, runMentionNow]);

  const handleStatusChange = async (mentionId: string, newStatus: MentionStatus) => {
    try {
      const updated = await api.updateMentionStatus(mentionId, newStatus);
      setMentions((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch {
      // ignore
    }
  };

  const handleDelete = async (mentionId: string) => {
    try {
      await api.deleteMentionFromComment(mentionId);
      setMentions((prev) => prev.filter((m) => m.id !== mentionId));
    } catch {
      // ignore
    }
  };

  const handleModeChange = async (mentionId: string, mode: MentionExecutionMode) => {
    try {
      const updated = await api.updateMentionExecutionMode(mentionId, mode);
      setMentions((prev) => prev.map((m) => (m.id === mentionId ? updated : m)));
    } catch {
      // ignore
    }
  };

  if (mentions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
        <div className="mb-2 text-2xl opacity-30">@</div>
        <p className="text-sm text-[var(--theme-text-muted)]">No mentions yet</p>
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          Use <span className="font-mono text-[var(--theme-accent)]">@agent:name</span> in comments to create mentions
        </p>
      </div>
    );
  }

  // Status counts for filter pills
  const counts: Record<FilterStatus, number> = {
    all: mentions.length,
    pending: mentions.filter((m) => m.status === 'pending').length,
    acknowledged: mentions.filter((m) => m.status === 'acknowledged').length,
    waiting_for_info: mentions.filter((m) => m.status === 'waiting_for_info').length,
    failed: mentions.filter((m) => m.status === 'failed').length,
    resolved: mentions.filter((m) => m.status === 'resolved').length,
  };

  const filtered = filter === 'all' ? mentions : mentions.filter((m) => m.status === filter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const filterOptions: { key: FilterStatus; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'acknowledged', label: 'Acknowledged' },
    { key: 'waiting_for_info', label: 'Waiting' },
    { key: 'failed', label: 'Failed' },
    { key: 'resolved', label: 'Resolved' },
  ];

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* Filter pills */}
      <div className="mb-3 flex flex-shrink-0 items-center gap-1.5">
        {filterOptions.map((opt) => {
          const count = counts[opt.key];
          if (opt.key !== 'all' && count === 0) return null;
          return (
            <button
              key={opt.key}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === opt.key
                  ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                  : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
              }`}
              onClick={() => setFilter(opt.key)}
            >
              {opt.label}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Mention list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-[var(--theme-text-muted)]">No {filter} mentions</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((m) => (
              <div
                key={m.id}
                className="group rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5"
              >
                {/* Top row: source -> target + status + delete */}
                <div className="flex items-center gap-2">
                  {/* Source */}
                  <span className={`text-xs font-medium ${tintText('blue')}`}>
                    {displaySource(m.sourceAgent)}
                  </span>

                  {/* Arrow */}
                  <svg className="h-3 w-3 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>

                  {/* Target agent */}
                  <span className={`text-xs font-medium ${m.targetType === 'human' ? tintText('yellow') : tintText('purple')}`}>
                    {m.targetType === 'human' ? `@${m.targetAgent}` : m.targetAgent}
                  </span>

                  {m.targetType === 'human' && (
                    <span className={`rounded-full px-1.5 py-px text-[9px] font-medium ${tint('yellow')}`}>
                      human
                    </span>
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* View execution button — when an execution exists for this mention */}
                  {executionByMention.has(m.id) && (
                    <button
                      className={`rounded p-0.5 transition-all ${
                        executionByMention.get(m.id)?.status === 'running'
                          ? `animate-pulse ${tintText('blue')}`
                          : `text-[var(--theme-text-faint)] opacity-0 group-hover:opacity-100 ${tintClasses('blue').hoverBg} ${tintClasses('blue').hoverText}`
                      }`}
                      onClick={() => openExecution(m)}
                      title="View execution"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </button>
                  )}

                  {/* Play button — only for non-resolved agent mentions */}
                  {m.targetType === 'agent' && m.status !== 'resolved' && personaByName.has(m.targetAgent) && (
                    <button
                      className={`rounded p-0.5 transition-all ${
                        executing.has(m.targetAgent)
                          ? `animate-pulse ${tintText('green')}`
                          : `text-[var(--theme-text-faint)] opacity-0 group-hover:opacity-100 ${tintClasses('green').hoverBg} ${tintClasses('green').hoverText}`
                      }`}
                      onClick={() => handleExecute(m)}
                      disabled={executing.has(m.targetAgent)}
                      title={`Execute ${m.targetAgent}`}
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  )}

                  {/* Delete button (visible on hover) */}
                  <button
                    className={`rounded p-0.5 text-[var(--theme-text-faint)] opacity-0 transition-all group-hover:opacity-100 ${tintClasses('red').hoverBg} ${tintClasses('red').hoverText}`}
                    onClick={() => handleDelete(m.id)}
                    title="Delete mention"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>

                  {/* Execution mode toggle (read-only when acknowledged or resolved) */}
                  <MentionModeToggle
                    mode={m.executionMode}
                    onChange={(mode) => handleModeChange(m.id, mode)}
                    disabled={m.status === 'acknowledged' || m.status === 'resolved'}
                  />

                  {/* Startup-failure chip — last server attempt could not start the agent */}
                  {failures[m.id] && (
                    <span
                      className={`inline-flex max-w-[220px] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${tint('red')}`}
                      title={failures[m.id]!.message}
                    >
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${tintClasses('red').solid}`} />
                      <span className="truncate">Failed to start</span>
                    </span>
                  )}

                  {/* Status badge (clickable dropdown) */}
                  <StatusDropdown
                    currentStatus={m.status}
                    onSelect={(s) => handleStatusChange(m.id, s)}
                  />
                </div>

                {/* Bottom row: timestamps */}
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--theme-text-faint)]">
                  <span>Created {relativeTime(m.createdAt)}</span>
                  {m.resolvedAt && (
                    <>
                      <span>&middot;</span>
                      <span>Resolved {relativeTime(m.resolvedAt)}</span>
                    </>
                  )}
                  {m.resolvedDeliverableId && (
                    <>
                      <span>&middot;</span>
                      <span className="text-[var(--theme-text-muted)]">Has deliverable</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating execution panel */}
      {modalExecutionId && (
        <FloatingExecutionPanel
          executionId={modalExecutionId}
          title={modalTitle}
          onClose={() => setModalExecutionId(null)}
        />
      )}

      {/* Missing-repo guard: about to run a mention on a repo-less ticket */}
      {repoGuardMention && (
        <Modal open onClose={() => setRepoGuardMention(null)} maxWidth="max-w-md">
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
            Aucun repository lié à ce ticket
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-[var(--theme-text-secondary)]">
            Exécuter <strong>{repoGuardMention.targetAgent}</strong> démarrera une run{' '}
            <strong>sans codebase</strong> (pas de worktree) — elle ne pourra pas modifier de
            code. Lie un repo (via la bannière en haut du ticket) ou exécute quand même si
            c'est volontaire.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="secondary" onClick={() => void confirmRepoGuardAndRun()}>
              Exécuter quand même
            </Button>
            <Button variant="ghost" onClick={() => setRepoGuardMention(null)}>
              Annuler
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
