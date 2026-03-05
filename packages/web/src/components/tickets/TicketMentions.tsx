import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { TicketMention, MentionStatus, TicketWsMessage } from '@fleex/shared';
import { ticketWs } from '../../services/websocket';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
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
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/15',
    dot: 'bg-yellow-400',
  },
  acknowledged: {
    label: 'Acknowledged',
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
    dot: 'bg-blue-400',
  },
  waiting_for_info: {
    label: 'Waiting',
    color: 'text-orange-400',
    bg: 'bg-orange-500/15',
    dot: 'bg-orange-400',
  },
  resolved: {
    label: 'Resolved',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    dot: 'bg-emerald-400',
  },
};

const STATUS_ORDER: MentionStatus[] = ['pending', 'acknowledged', 'waiting_for_info', 'resolved'];

type FilterStatus = MentionStatus | 'all';

function StatusDropdown({
  currentStatus,
  onSelect,
}: {
  currentStatus: MentionStatus;
  onSelect: (status: MentionStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const cfg = STATUS_CONFIG[currentStatus];

  return (
    <div ref={ref} className="relative">
      <button
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80 ${cfg.bg} ${cfg.color}`}
        onClick={() => setOpen(!open)}
        title="Change status"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
        <svg className="ml-0.5 h-2.5 w-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg">
          {STATUS_ORDER.map((s) => {
            const sc = STATUS_CONFIG[s];
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
      )}
    </div>
  );
}

export function TicketMentions({ ticketId }: { ticketId: string }) {
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );

  /** Show the configured human name instead of "user" */
  const displaySource = (name: string) =>
    name === 'user' && humanMentionName ? humanMentionName : name;

  useEffect(() => {
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
  }, [ticketId]);

  // Real-time updates
  useEffect(() => {
    const decoder = new TextDecoder();
    const unsub = ticketWs.onMessage((buf: ArrayBuffer) => {
      try {
        const msg = JSON.parse(decoder.decode(buf)) as TicketWsMessage;
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

  const handleExecute = useCallback(async (agentName: string) => {
    const personaId = personaByName.get(agentName);
    if (!personaId) return;
    setExecuting((prev) => new Set(prev).add(agentName));
    try {
      await api.executeAgent(personaId);
    } catch {
      // ignore
    } finally {
      setExecuting((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
    }
  }, [personaByName]);

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
                  <span className="text-xs font-medium text-blue-400">
                    {displaySource(m.sourceAgent)}
                  </span>

                  {/* Arrow */}
                  <svg className="h-3 w-3 flex-shrink-0 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>

                  {/* Target agent */}
                  <span className={`text-xs font-medium ${m.targetType === 'human' ? 'text-amber-400' : 'text-purple-400'}`}>
                    {m.targetType === 'human' ? `@${m.targetAgent}` : m.targetAgent}
                  </span>

                  {m.targetType === 'human' && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[9px] font-medium text-amber-400">
                      human
                    </span>
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Play button — only for non-resolved agent mentions */}
                  {m.targetType === 'agent' && m.status !== 'resolved' && personaByName.has(m.targetAgent) && (
                    <button
                      className={`rounded p-0.5 transition-all ${
                        executing.has(m.targetAgent)
                          ? 'animate-pulse text-emerald-400'
                          : 'text-[var(--theme-text-faint)] opacity-0 hover:bg-emerald-500/15 hover:text-emerald-400 group-hover:opacity-100'
                      }`}
                      onClick={() => handleExecute(m.targetAgent)}
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
                    className="rounded p-0.5 text-[var(--theme-text-faint)] opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                    onClick={() => handleDelete(m.id)}
                    title="Delete mention"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>

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
    </div>
  );
}
