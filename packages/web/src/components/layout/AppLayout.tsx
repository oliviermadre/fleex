import { useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSessions } from '../../hooks/useSessions';
import { useRepositoryDashboard } from '../../hooks/useRepositoryDashboard';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useHotkeyReveal } from '../../hooks/useHotkeyReveal';
import { usePullRequestPolling } from '../../hooks/usePullRequestPolling';
import { useTickets } from '../../hooks/useTickets';
import { useTicketActivity } from '../../hooks/useTicketActivity';
import { useNotifications } from '../../hooks/useNotifications';
import { useAgentPersonas } from '../../hooks/useAgentPersonas';
import { useSkills } from '../../hooks/useSkills';
import { useCapabilities } from '../../hooks/useCapabilities';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { NavSidebar } from '../sidebar/NavSidebar';
import { ContentPanel } from '../sidebar/ContentPanel';
import { MainPanel } from '../main-panel/MainPanel';
import { ResizeHandle } from './ResizeHandle';
import { ScratchpadPanel } from '../scratchpad/ScratchpadPanel';
import { ScratchpadHint } from '../scratchpad/ScratchpadHint';
import { FloatingSessionOverlay } from '../main-panel/FloatingSessionOverlay';
import { FloatingDeliverableOverlay } from '../tickets/FloatingDeliverableOverlay';
import { DeliverableReadingOverlay } from '../tickets/DeliverableReadingOverlay';

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
  const { workflowsAvailable } = useCapabilities();

  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;
  // Hide the content panel when editing a workflow so the editor takes the full
  // viewport width. On a driver without workflow support the route renders an
  // explanation instead of an editor, so the panel stays — otherwise a deep link
  // would strand the user on a full-screen dead end with nothing to click.
  const editingWorkflow = activePanel === 'agents' && !!selectedWorkflowId && workflowsAvailable;
  const hideContentPanel = activePanel === 'dashboard' || activePanel === 'cluster' || activePanel === 'tickets' || activePanel === 'list-focus' || activePanel === 'execution-log' || activePanel === 'documents' || editingWorkflow;
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
