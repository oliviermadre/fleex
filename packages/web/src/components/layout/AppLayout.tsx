import { useEffect } from 'react';

import { useAgentPersonas } from '../../hooks/useAgentPersonas';
import { useHotkeyReveal } from '../../hooks/useHotkeyReveal';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useNotifications } from '../../hooks/useNotifications';
import { usePullRequestPolling } from '../../hooks/usePullRequestPolling';
import { useRepositoryDashboard } from '../../hooks/useRepositoryDashboard';
import { useSessions } from '../../hooks/useSessions';
import { useSkills } from '../../hooks/useSkills';
import { useTicketActivity } from '../../hooks/useTicketActivity';
import { useTickets } from '../../hooks/useTickets';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { FloatingSessionOverlay } from '../main-panel/FloatingSessionOverlay';
import { MainPanel } from '../main-panel/MainPanel';
import { ScratchpadHint } from '../scratchpad/ScratchpadHint';
import { ScratchpadPanel } from '../scratchpad/ScratchpadPanel';
import { ContentPanel } from '../sidebar/ContentPanel';
import { NavSidebar } from '../sidebar/NavSidebar';
import { DeliverableReadingOverlay } from '../tickets/DeliverableReadingOverlay';
import { FloatingDeliverableOverlay } from '../tickets/FloatingDeliverableOverlay';

import { ResizeHandle } from './ResizeHandle';

const NAV_COLLAPSED_WIDTH = 64;
const NAV_EXPANDED_WIDTH = 200;
const CONTENT_PANEL_COLLAPSED_WIDTH = 55;

export function AppLayout() {
  useWebSocket();
  useSessions();
  useRepositoryDashboard();
  useKeyboardShortcuts();
  useHotkeyReveal();
  usePullRequestPolling();
  useTickets();
  useTicketActivity();
  useNotifications();
  useAgentPersonas();
  useSkills();

  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const activePanel = useUIStore((s) => s.activePanel);
  const contentPanelWidth = useUIStore((s) => s.contentPanelWidth);
  const contentPanelCollapsed = useUIStore((s) => s.contentPanelCollapsed);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);
  const loadDeliverableTypes = useDeliverableTypesStore((s) => s.load);

  useEffect(() => {
    loadSettings();
    fetchRepositories();
    loadDeliverableTypes();
  }, [loadSettings, fetchRepositories, loadDeliverableTypes]);

  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);

  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;
  // Hide the content panel when editing a workflow so the editor takes the full viewport width
  const editingWorkflow = activePanel === 'agents' && !!selectedWorkflowId;
  const hideContentPanel =
    activePanel === 'dashboard' ||
    activePanel === 'cluster' ||
    activePanel === 'tickets' ||
    activePanel === 'list-focus' ||
    activePanel === 'execution-log' ||
    activePanel === 'documents' ||
    editingWorkflow;
  const effectiveContentWidth = hideContentPanel
    ? 0
    : contentPanelCollapsed
      ? CONTENT_PANEL_COLLAPSED_WIDTH
      : contentPanelWidth;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--theme-bg-base)]"
      style={{
        display: 'grid',
        gridTemplateColumns: `${navWidth}px ${effectiveContentWidth}px 1fr`,
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      <div className="overflow-hidden">
        <NavSidebar />
      </div>
      <div className={contentPanelCollapsed ? 'overflow-visible' : 'overflow-hidden'}>
        <ContentPanel />
      </div>
      <div className="relative flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        {!hideContentPanel && <ResizeHandle />}
        <MainPanel />
      </div>
      <ScratchpadPanel />
      <ScratchpadHint />
      <FloatingSessionOverlay />
      <FloatingDeliverableOverlay />
      <DeliverableReadingOverlay />
    </div>
  );
}
