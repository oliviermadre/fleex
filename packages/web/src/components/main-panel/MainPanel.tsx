import type { Session, Ticket } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { UnifiedWorktreePanel } from './UnifiedWorktreePanel';
import { EmptyState } from './EmptyState';
import { SettingsPanel } from '../settings/SettingsPanel';
import { RepositoryDashboard } from '../repository-dashboard/RepositoryDashboard';
import { RepositoryEmptyState } from '../repository-dashboard/RepositoryEmptyState';
import { ClaudeConfigEditor } from '../claude-config/ClaudeConfigEditor';
import { ScratchpadMainView } from '../scratchpad/ScratchpadMainView';
import { ScratchpadEmptyState } from '../scratchpad/ScratchpadEmptyState';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { KanbanBoard } from '../tickets/KanbanBoard';
import { TicketDetail } from '../tickets/TicketDetail';
import { useTicketStore } from '../../stores/ticketStore';
import { AgentPersonaView } from '../agents/AgentPersonaView';
import { SkillEditor } from '../agents/SkillEditor';
import { useSkillStore } from '../../stores/skillStore';
import { AnalyticsPanel } from '../analytics/AnalyticsPanel';
import { DashboardView } from '../dashboard/DashboardView';
import { findSessionsForTicket } from '../dashboard/dashboard-helpers';
import { Button } from '../ui/Button';
import * as api from '../../services/api';
import { useState } from 'react';

function WorkspaceNoSession({ ticket }: { ticket: Ticket | undefined }) {
  const openSessionFromTicket = useTicketStore((s) => s.openSessionFromTicket);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const [loading, setLoading] = useState(false);

  const handleStartWork = async () => {
    if (!ticket || loading) return;
    setLoading(true);
    try {
      await openSessionFromTicket(ticket.id);
      await Promise.all([
        api.fetchSessionGroups().then(setSessionGroups).catch(() => {}),
        fetchTickets(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--theme-text-muted)]">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
      {ticket && (
        <p className="max-w-xs text-center text-sm font-medium text-[var(--theme-text-secondary)]">
          #{ticket.displayId} {ticket.title}
        </p>
      )}
      <p className="text-sm">No active session for this ticket</p>
      <Button variant="primary" size="sm" onClick={handleStartWork} disabled={loading}>
        {loading ? 'Starting…' : 'Start Work'}
      </Button>
    </div>
  );
}

function GroupEmptyCell() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-primary)] text-[var(--theme-text-faint)]">
      <span className="text-xs">No session bound</span>
    </div>
  );
}

interface GroupCellProps {
  session: Session | null;
  focused: boolean;
  onFocus: () => void;
}

function GroupCell({ session, focused, onFocus }: GroupCellProps) {
  if (!session) return <GroupEmptyCell />;
  return (
    <UnifiedWorktreePanel
      entry={{ kind: 'session', sessionId: session.id }}
      focused={focused}
      isSplit={true}
      onFocus={onFocus}
    />
  );
}

export function MainPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
  const layoutGroups = useSettingsStore((s) => s.settings.sessionLayoutGroups);

  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const selectedWorkspaceTicketId = useUIStore((s) => s.selectedWorkspaceTicketId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const tickets = useTicketStore((s) => s.tickets);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const splitSession = splitSessionId
    ? sessions.find((s) => s.id === splitSessionId) ?? null
    : null;

  if (activePanel === 'workspace') {
    if (selectedWorkspaceTicketId) {
      const ticket = tickets.find((t) => t.id === selectedWorkspaceTicketId);
      const linkedSessions = ticket ? findSessionsForTicket(ticket, sessions) : [];
      if (linkedSessions.length > 0) {
        return <UnifiedWorktreePanel entry={{ kind: 'session', sessionId: linkedSessions[0]!.id }} focused />;
      }
      return <WorkspaceNoSession ticket={ticket} />;
    }
    return <EmptyState />;
  }

  if (activePanel === 'dashboard') {
    return <DashboardView />;
  }

  if (activePanel === 'settings') {
    return <SettingsPanel />;
  }

  if (activePanel === 'analytics') {
    return <AnalyticsPanel />;
  }

  if (activePanel === 'claude-config') {
    return <ClaudeConfigEditor />;
  }

  if (activePanel === 'scratchpads') {
    if (!selectedScratchpadKey) return <ScratchpadEmptyState />;
    return <ScratchpadMainView scratchpadKey={selectedScratchpadKey} />;
  }

  if (activePanel === 'agents') {
    if (selectedSkillId) {
      return <SkillEditor />;
    }
    return <AgentPersonaView />;
  }

  if (activePanel === 'tickets') {
    if (selectedTicketId) {
      return <TicketDetail ticketId={selectedTicketId} />;
    }
    return <KanbanBoard />;
  }

  if (activePanel === 'repositories') {
    if (!selectedRepoKey) {
      return <RepositoryEmptyState />;
    }
    return <RepositoryDashboard repoKey={selectedRepoKey} />;
  }

  // Agent worktree view — unified panel with ticket context
  if (activePanel === 'sessions' && selectedAgentWorktreeTicketId) {
    return <UnifiedWorktreePanel entry={{ kind: 'agent', ticketId: selectedAgentWorktreeTicketId }} focused />;
  }

  // Grouped view
  if (selectedGroupId) {
    const group = layoutGroups.find((g) => g.id === selectedGroupId);
    if (group) {
      const cellSessions = group.cells.map(
        (cellId) => (cellId ? sessions.find((s) => s.id === cellId) ?? null : null)
      );

      if (group.type === '1x2') {
        return (
          <div className="flex flex-1 flex-row overflow-hidden">
            <GroupCell
              session={cellSessions[0] ?? null}
              focused={activeGroupCellIndex === null ? true : activeGroupCellIndex === 0}
              onFocus={() => setActiveGroupCellIndex(0)}
            />
            <div className="w-px bg-[var(--theme-border)]" />
            <GroupCell
              session={cellSessions[1] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 1}
              onFocus={() => setActiveGroupCellIndex(1)}
            />
          </div>
        );
      }

      // 2x2
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-row overflow-hidden">
            <GroupCell
              session={cellSessions[0] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 0}
              onFocus={() => setActiveGroupCellIndex(0)}
            />
            <div className="w-px bg-[var(--theme-border)]" />
            <GroupCell
              session={cellSessions[1] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 1}
              onFocus={() => setActiveGroupCellIndex(1)}
            />
          </div>
          <div className="h-px bg-[var(--theme-border)]" />
          <div className="flex flex-1 flex-row overflow-hidden">
            <GroupCell
              session={cellSessions[2] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 2}
              onFocus={() => setActiveGroupCellIndex(2)}
            />
            <div className="w-px bg-[var(--theme-border)]" />
            <GroupCell
              session={cellSessions[3] ?? null}
              focused={activeGroupCellIndex === null ? false : activeGroupCellIndex === 3}
              onFocus={() => setActiveGroupCellIndex(3)}
            />
          </div>
        </div>
      );
    }
  }

  if (!selectedSession) {
    return <EmptyState />;
  }

  // Split view: two unified panels side by side
  if (splitSession) {
    return (
      <div className="flex flex-1 flex-row overflow-hidden">
        <UnifiedWorktreePanel
          entry={{ kind: 'session', sessionId: selectedSession.id }}
          focused={focusedPane === 'primary'}
          isSplit={true}
          onFocus={() => setFocusedPane('primary')}
        />
        <div className="w-px bg-[var(--theme-border)]" />
        <UnifiedWorktreePanel
          entry={{ kind: 'session', sessionId: splitSession.id }}
          focused={focusedPane === 'split'}
          isSplit={true}
          onFocus={() => setFocusedPane('split')}
        />
      </div>
    );
  }

  // Single pane view
  return (
    <UnifiedWorktreePanel
      entry={{ kind: 'session', sessionId: selectedSession.id }}
      focused={true}
    />
  );
}
