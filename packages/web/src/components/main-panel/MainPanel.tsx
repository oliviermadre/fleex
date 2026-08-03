import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Session } from '@fleex/shared';

import { useCapabilities } from '../../hooks/useCapabilities';
import { usePanelStore } from '../../stores/panelStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { AssistantConversation } from '../assistant/AssistantConversation';
import { DashboardView } from '../dashboard/DashboardView';
import { ListFocusView } from '../list-focus/ListFocusView';
import { RepositoryEmptyState } from '../repository-dashboard/RepositoryEmptyState';
import { ScratchpadEmptyState } from '../scratchpad/ScratchpadEmptyState';
import { KanbanBoard } from '../tickets/KanbanBoard';
import { TicketDetail } from '../tickets/TicketDetail';
import { WorkflowsUnavailableState } from '../workflows/WorkflowsUnavailableState';

import { EmptyState } from './EmptyState';
import { PanelFallback } from './PanelFallback';
import { UnifiedWorktreePanel } from './UnifiedWorktreePanel';

// ── Lazy panels ───────────────────────────────────────────────────────────────
//
// One chunk per rarely-opened branch of `activePanel`. AnalyticsPanel carries
// recharts and WorkflowEditorView carries @xyflow/react; the rest is app code
// for panels most sessions never open.
//
// Kept eager on purpose: KanbanBoard and TicketDetail (activePanel defaults to
// 'tickets', so they are the hot path), UnifiedWorktreePanel, DashboardView,
// ListFocusView, AssistantConversation (all small and commonly the first view
// after the board), and the *EmptyState components.
const SettingsPanel = lazy(() =>
  import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);
const RepositoryDashboard = lazy(() =>
  import('../repository-dashboard/RepositoryDashboard').then((m) => ({
    default: m.RepositoryDashboard,
  })),
);
const ClaudeConfigEditor = lazy(() =>
  import('../claude-config/ClaudeConfigEditor').then((m) => ({ default: m.ClaudeConfigEditor })),
);
const ScratchpadMainView = lazy(() =>
  import('../scratchpad/ScratchpadMainView').then((m) => ({ default: m.ScratchpadMainView })),
);
const AgentPersonaView = lazy(() =>
  import('../agents/AgentPersonaView').then((m) => ({ default: m.AgentPersonaView })),
);
const SkillEditor = lazy(() =>
  import('../agents/SkillEditor').then((m) => ({ default: m.SkillEditor })),
);
const PanelDetailView = lazy(() =>
  import('../agents/PanelDetailView').then((m) => ({ default: m.PanelDetailView })),
);
const WorkflowEditorView = lazy(() =>
  import('../workflows/WorkflowEditorView').then((m) => ({ default: m.WorkflowEditorView })),
);
const AnalyticsPanel = lazy(() =>
  import('../analytics/AnalyticsPanel').then((m) => ({ default: m.AnalyticsPanel })),
);
const ExecutionLogPage = lazy(() =>
  import('../execution-log/ExecutionLogPage').then((m) => ({ default: m.ExecutionLogPage })),
);
const DocumentsPage = lazy(() =>
  import('../documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);

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
  return (
    <Suspense fallback={<PanelFallback />}>
      <MainPanelRoutes />
    </Suspense>
  );
}

function MainPanelRoutes() {
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
  const sessionTicketId = useSessionStore((s) => s.selectedTicketId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const selectedPanelId = usePanelStore((s) => s.selectedPanelId);
  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);
  const workflowTemplates = useWorkflowTemplateStore((s) => s.templates);
  const selectWorkflow = useWorkflowTemplateStore((s) => s.selectWorkflow);
  const { workflowsAvailable } = useCapabilities();
  const navigate = useNavigate();
  const splitSession = splitSessionId
    ? (sessions.find((s) => s.id === splitSessionId) ?? null)
    : null;

  if (activePanel === 'dashboard') {
    return <DashboardView />;
  }

  if (activePanel === 'list-focus') {
    return <ListFocusView />;
  }

  if (activePanel === 'assistant') {
    return <AssistantConversation />;
  }

  if (activePanel === 'settings') {
    return <SettingsPanel />;
  }

  if (activePanel === 'documents') {
    return <DocumentsPage />;
  }

  if (activePanel === 'execution-log') {
    return <ExecutionLogPage />;
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
    if (selectedPanelId) {
      return <PanelDetailView />;
    }
    if (selectedSkillId) {
      return <SkillEditor />;
    }
    if (selectedWorkflowId) {
      // The driver has no workflow support: explain it in place. Never redirect
      // silently — a deep link to /agents/workflow/:id must say why it's dead.
      if (!workflowsAvailable) {
        return <WorkflowsUnavailableState />;
      }
      const template = workflowTemplates.find((t) => t.id === selectedWorkflowId);
      if (template) {
        return (
          <WorkflowEditorView
            template={template}
            onBack={() => {
              selectWorkflow(null);
              navigate('/agents', { replace: true });
            }}
          />
        );
      }
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

  // Agent worktree view (legacy route)
  if (activePanel === 'sessions' && selectedAgentWorktreeTicketId) {
    return (
      <UnifiedWorktreePanel
        entry={{ kind: 'agent', ticketId: selectedAgentWorktreeTicketId }}
        focused
      />
    );
  }

  // Ticket-based session view
  if (activePanel === 'sessions' && sessionTicketId) {
    if (sessionTicketId === 'system') {
      return <UnifiedWorktreePanel entry={{ kind: 'system' }} focused />;
    }
    return <UnifiedWorktreePanel entry={{ kind: 'ticket', ticketId: sessionTicketId }} focused />;
  }

  // Grouped view
  if (selectedGroupId) {
    const group = layoutGroups.find((g) => g.id === selectedGroupId);
    if (group) {
      const cellSessions = group.cells.map((cellId) =>
        cellId ? (sessions.find((s) => s.id === cellId) ?? null) : null,
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
