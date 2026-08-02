import { useEffect, lazy, Suspense } from 'react';
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
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { NavSidebar } from '../sidebar/NavSidebar';
import { ContentPanel } from '../sidebar/ContentPanel';
import { MainPanel } from '../main-panel/MainPanel';
import { ResizeHandle } from './ResizeHandle';
import { ScratchpadHint } from '../scratchpad/ScratchpadHint';
import { warmMarkdown } from '../markdown/LazyMarkdown';

// Overlays and panels that are absent from the default view. Each one's own
// "render nothing" condition is hoisted to the call site below, so the chunk is
// never fetched for a component that would immediately return null.
// FloatingSessionOverlay in particular is the last static edge to @xterm/xterm.
const ScratchpadPanel = lazy(() =>
  import('../scratchpad/ScratchpadPanel').then((m) => ({ default: m.ScratchpadPanel }))
);
const FloatingSessionOverlay = lazy(() =>
  import('../main-panel/FloatingSessionOverlay').then((m) => ({ default: m.FloatingSessionOverlay }))
);
const FloatingDeliverableOverlay = lazy(() =>
  import('../tickets/FloatingDeliverableOverlay').then((m) => ({ default: m.FloatingDeliverableOverlay }))
);
const DeliverableReadingOverlay = lazy(() =>
  import('../tickets/DeliverableReadingOverlay').then((m) => ({ default: m.DeliverableReadingOverlay }))
);

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
    // The default panel is the kanban board, and any ticket renders markdown —
    // fetch that chunk while idle so the Suspense fallback never actually shows.
    warmMarkdown();
  }, [loadSettings, fetchRepositories, loadDeliverableTypes]);

  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);

  // Hoisted out of the lazy components themselves — see the comment on the
  // lazy() declarations above.
  const scratchpadOpen = useUIStore((s) => s.scratchpadOpen);
  const hasFloatingSessions = useUIStore((s) => s.floatingSessionIds.length > 0);
  const hasFloatingDeliverables = useUIStore((s) => s.floatingDeliverableIds.length > 0);
  const hasDeliverableOverlay = useUIStore((s) => s.deliverableOverlay !== null);

  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;
  // Hide the content panel when editing a workflow so the editor takes the full viewport width
  const editingWorkflow = activePanel === 'agents' && !!selectedWorkflowId;
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
      <ScratchpadHint />
      <Suspense fallback={null}>
        {scratchpadOpen && <ScratchpadPanel />}
        {hasFloatingSessions && <FloatingSessionOverlay />}
        {hasFloatingDeliverables && <FloatingDeliverableOverlay />}
        {hasDeliverableOverlay && <DeliverableReadingOverlay />}
      </Suspense>
    </div>
  );
}
