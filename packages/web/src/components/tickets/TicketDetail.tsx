import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Session, TicketComment, TicketDeliverable, TicketMention, TicketWsMessage } from '@fleex/shared';
import { appWs } from '../../services/websocket';
import { useTicketStore, type TicketTab } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { TicketDetailHeader } from './TicketDetailHeader';
import { TicketMetaSidebar } from './TicketMetaSidebar';
import { TicketActivityTimeline } from './TicketActivityTimeline';
import { TicketComments } from './TicketComments';
import { TicketDeliverables } from './TicketDeliverables';
import { TicketMentions } from './TicketMentions';
import { TerminalOverlay } from '../main-panel/FloatingSessionOverlay';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import * as api from '../../services/api';
import { findSessionsForTicket } from '../dashboard/dashboard-helpers';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';

type DescriptionMode = 'write' | 'preview' | 'split';

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const tickets = useTicketStore((s) => s.tickets);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const openSessionFromTicket = useTicketStore((s) => s.openSessionFromTicket);
  const mainTab = useTicketStore((s) => s.ticketTab);
  const setMainTab = useTicketStore((s) => s.setTicketTab);
  const sessions = useSessionStore((s) => s.sessions);
  const ticket = tickets.find((t) => t.id === ticketId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [descMode, setDescMode] = useState<DescriptionMode>('split');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlaySession, setOverlaySession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [deliverableCount, setDeliverableCount] = useState(0);
  const [mentionCount, setMentionCount] = useState(0);

  // Track initial description to know if it changed when leaving
  const initialDescRef = useRef('');
  const descriptionRef = useRef('');

  useEffect(() => {
    if (ticket) {
      setTitle(ticket.title);
      setDescription(ticket.description);
      initialDescRef.current = ticket.description;
      descriptionRef.current = ticket.description;
    }
  }, [ticket?.id]); // Reset on ticket change, not on every ticket update

  // Fetch comment, deliverable & mention counts
  useEffect(() => {
    api.fetchTicketComments(ticketId).then((c) => setCommentCount(c.length)).catch(() => {});
    api.fetchTicketDeliverables(ticketId).then((d) => setDeliverableCount(d.length)).catch(() => {});
    api.fetchTicketMentions(ticketId).then((m) => setMentionCount(m.length)).catch(() => {});
  }, [ticketId]);

  // Track deliverable & mention counts via WebSocket
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        const msg = raw as TicketWsMessage;
        if (msg.type === 'comment:created') {
          const c = msg.data as TicketComment;
          if (c.ticketId === ticketId) setCommentCount((n) => n + 1);
        } else if (msg.type === 'deliverable:created') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) setDeliverableCount((c) => c + 1);
        } else if (msg.type === 'deliverable:deleted') {
          const { ticketId: tid } = msg.data as { ticketId: string };
          if (tid === ticketId) setDeliverableCount((c) => Math.max(0, c - 1));
        } else if (msg.type === 'mention:created') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) setMentionCount((c) => c + 1);
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, [ticketId]);

  // Flush pending description changes and log activity on unmount / ticket switch
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (descriptionRef.current !== initialDescRef.current) {
        // Fire a normal (non-silent) update to create a single activity entry
        updateTicket(ticketId, { description: descriptionRef.current });
      }
    };
  }, [ticketId, updateTicket]);

  // ESC to go back to board view (only when overlay is NOT open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !overlaySession) {
        selectTicket(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectTicket, overlaySession]);

  // Debounced silent save — persists data without creating activity entries
  const debouncedSilentDescription = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        api.updateTicketSilent(ticketId, { description: value }).then((updated) => {
          useTicketStore.setState((s) => ({
            tickets: s.tickets.map((t) => (t.id === ticketId ? updated : t)),
          }));
        });
      }, 500);
    },
    [ticketId],
  );

  const handleDescToggleCheckbox = useCallback(
    (lineIndex: number) => {
      const lines = descriptionRef.current.split('\n');
      const line = lines[lineIndex];
      if (!line) return;
      if (line.includes('[ ]')) {
        lines[lineIndex] = line.replace('[ ]', '[x]');
      } else if (/\[[xX]\]/.test(line)) {
        lines[lineIndex] = line.replace(/\[[xX]\]/, '[ ]');
      }
      const updated = lines.join('\n');
      setDescription(updated);
      descriptionRef.current = updated;
      debouncedSilentDescription(updated);
    },
    [debouncedSilentDescription],
  );

  const debouncedUpdate = useCallback(
    (field: 'title' | 'description', value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateTicket(ticketId, { [field]: value });
      }, 500);
    },
    [ticketId, updateTicket],
  );

  // Find an existing running session for this ticket
  const findSessionForTicket = useCallback((): Session | null => {
    if (!ticket) return null;
    const sessions = useSessionStore.getState().sessions;

    // Check session links first
    const sessionLink = ticket.links.find((l) => l.type === 'session');
    if (sessionLink) {
      const session = sessions.find((s) => s.id === sessionLink.ref && s.status === 'running');
      if (session) return session;
    }

    // Check worktree link and find matching session
    const wtLink = ticket.links.find((l) => l.type === 'worktree');
    if (wtLink) {
      const colonIdx = wtLink.ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = wtLink.ref.substring(0, colonIdx);
        const branch = wtLink.ref.substring(colonIdx + 1);
        const [org, name] = repoKey.split('/');
        const session = sessions.find(
          (s) =>
            s.status === 'running' &&
            s.type === 'claude' &&
            s.repositoryOrg === org &&
            s.repositoryName === name &&
            s.worktreeBranch === branch,
        );
        if (session) return session;
      }
    }

    return null;
  }, [ticket]);

  const ticketSessions = useMemo(
    () => ticket ? findSessionsForTicket(ticket, sessions) : [],
    [ticket, sessions],
  );

  const openCreateModalForTicket = useUIStore((s) => s.openCreateModalForTicket);

  const handleOpenSession = useCallback(async () => {
    if (!ticket) return;

    // Try to find existing active session
    const existing = findSessionForTicket();
    if (existing) {
      setOverlaySession(existing);
      return;
    }

    // If ticket has a worktree link → auto-create via API (existing behavior)
    const wtLink = ticket.links.find((l) => l.type === 'worktree');
    if (wtLink) {
      setSessionLoading(true);
      try {
        const { sessionId } = await openSessionFromTicket(ticketId);
        const tryOpen = () => {
          const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
          if (session) {
            setOverlaySession(session);
            setSessionLoading(false);
          } else {
            setTimeout(tryOpen, 300);
          }
        };
        tryOpen();
      } catch {
        setSessionLoading(false);
      }
      return;
    }

    // No worktree → open CreateSessionModal with prefilled context
    const repoLink = ticket.links.find((l) => l.type === 'repository');
    const prompt = [ticket.title, ticket.description].filter(Boolean).join('\n\n');
    openCreateModalForTicket({
      ticketId: ticket.id,
      repo: repoLink?.ref ?? null,
      prompt,
    });
  }, [ticket, ticketId, findSessionForTicket, openSessionFromTicket, openCreateModalForTicket]);

  if (!ticket) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-base)]">
        <span className="text-sm text-[var(--theme-text-muted)]">Ticket not found</span>
      </div>
    );
  }

  const mainTabs: { key: TicketTab; label: string }[] = [
    { key: 'description', label: 'Description' },
    { key: 'comments', label: `Comments${commentCount > 0 ? ` (${commentCount})` : ''}` },
    { key: 'mentions', label: `Mentions${mentionCount > 0 ? ` (${mentionCount})` : ''}` },
    { key: 'deliverables', label: `Deliverables${deliverableCount > 0 ? ` (${deliverableCount})` : ''}` },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      <TicketDetailHeader ticket={ticket} />
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden p-6">
          {/* Title + Session button */}
          <div className="flex flex-shrink-0 items-center gap-3">
            <input
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                debouncedUpdate('title', e.target.value);
              }}
              placeholder="Ticket title..."
            />
            <SmartSessionButton
              sessions={ticketSessions}
              creating={sessionLoading}
              onCreateSession={handleOpenSession}
              ticketId={ticketId}
              onExecuteSkill={(skillId) => api.executeSkill(skillId, ticketId).catch(console.error)}
            />
          </div>

          {/* Main tabs */}
          <div className="mt-3 flex flex-shrink-0 items-center gap-1 border-b border-[var(--theme-border)]">
            {mainTabs.map((tab) => (
              <button
                key={tab.key}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mainTab === tab.key
                    ? 'border-b-2 border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                }`}
                onClick={() => setMainTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}

            {/* Description sub-tabs (only when description tab is active) */}
            {mainTab === 'description' && (
              <>
                <div className="mx-2 h-3 w-px bg-[var(--theme-border)]" />
                {(['write', 'preview', 'split'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`px-2 py-1.5 text-[11px] transition-colors ${
                      descMode === mode
                        ? 'text-[var(--theme-text-primary)]'
                        : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-text-muted)]'
                    }`}
                    onClick={() => setDescMode(mode)}
                  >
                    {mode === 'write' ? 'Write' : mode === 'preview' ? 'Preview' : 'Split'}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Tab content */}
          <div className="mt-3 flex min-h-0 flex-1 overflow-hidden">
            {/* Description tab */}
            {mainTab === 'description' && (
              <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
                {descMode !== 'preview' && (
                  <textarea
                    className={`resize-none rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-sm font-mono text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none ${
                      descMode === 'split' ? 'w-1/2' : 'w-full'
                    }`}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      descriptionRef.current = e.target.value;
                      debouncedSilentDescription(e.target.value);
                    }}
                    placeholder="Add a description (markdown supported)..."
                  />
                )}
                {descMode !== 'write' && (
                  <div
                    className={`overflow-y-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 ${
                      descMode === 'split' ? 'w-1/2' : 'w-full'
                    }`}
                  >
                    {description.trim() ? (
                      <MarkdownRenderer
                        content={description}
                        onToggleCheckbox={handleDescToggleCheckbox}
                      />
                    ) : (
                      <p className="text-sm italic text-[var(--theme-text-muted)]">Nothing to preview</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Comments tab */}
            {mainTab === 'comments' && (
              <TicketComments ticketId={ticketId} />
            )}

            {/* Mentions tab */}
            {mainTab === 'mentions' && (
              <TicketMentions ticketId={ticketId} />
            )}

            {/* Deliverables tab */}
            {mainTab === 'deliverables' && (
              <TicketDeliverables ticketId={ticketId} />
            )}

            {/* Activity tab */}
            {mainTab === 'activity' && (
              <div className="flex-1 overflow-y-auto">
                <TicketActivityTimeline ticketId={ticketId} />
              </div>
            )}
          </div>
        </div>

        {/* Meta sidebar */}
        <TicketMetaSidebar ticket={ticket} />
      </div>

      {/* Session terminal overlay */}
      {overlaySession && (
        <TerminalOverlay
          sessionId={overlaySession.id}
          onClose={() => setOverlaySession(null)}
        />
      )}
    </div>
  );
}
