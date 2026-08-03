import { useEffect, lazy, Suspense } from 'react';

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
import { reportClientError } from '../../services/errorReporter';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { ErrorBoundary } from '../errors/ErrorBoundary';
import { MainPanel } from '../main-panel/MainPanel';
import { useMainViewKey } from '../main-panel/useMainViewKey';
import { warmMarkdown } from '../markdown/LazyMarkdown';
import { ScratchpadHint } from '../scratchpad/ScratchpadHint';
import { ContentPanel } from '../sidebar/ContentPanel';
import { NavSidebar } from '../sidebar/NavSidebar';

import { ResizeHandle } from './ResizeHandle';

// Overlays and panels that are absent from the default view. Each one's own
// "render nothing" condition is hoisted to the call site below, so the chunk is
// never fetched for a component that would immediately return null.
// FloatingSessionOverlay in particular is the last static edge to @xterm/xterm.
const ScratchpadPanel = lazy(() =>
  import('../scratchpad/ScratchpadPanel').then((m) => ({ default: m.ScratchpadPanel })),
);
const FloatingSessionOverlay = lazy(() =>
  import('../main-panel/FloatingSessionOverlay').then((m) => ({
    default: m.FloatingSessionOverlay,
  })),
);
const FloatingDeliverableOverlay = lazy(() =>
  import('../tickets/FloatingDeliverableOverlay').then((m) => ({
    default: m.FloatingDeliverableOverlay,
  })),
);
const DeliverableReadingOverlay = lazy(() =>
  import('../tickets/DeliverableReadingOverlay').then((m) => ({
    default: m.DeliverableReadingOverlay,
  })),
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
    // These were previously fire-and-forget: a rejection became an unhandled
    // rejection in the console and nothing else. Route them to the reporter so
    // a failed boot is visible in the server logs.
    const report = (what: string) => (error: unknown) =>
      reportClientError({ error, source: 'unhandledrejection', boundary: `AppLayout.${what}` });

    loadSettings().catch(report('loadSettings'));
    fetchRepositories().catch(report('fetchRepositories'));
    loadDeliverableTypes().catch(report('loadDeliverableTypes'));
    // The default panel is the kanban board, and any ticket renders markdown —
    // fetch that chunk while idle so the Suspense fallback never actually shows.
    warmMarkdown();
  }, [loadSettings, fetchRepositories, loadDeliverableTypes]);

  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);
  const mainViewKey = useMainViewKey();

  // Hoisted out of the lazy components themselves — see the comment on the
  // lazy() declarations above.
  const scratchpadOpen = useUIStore((s) => s.scratchpadOpen);
  const hasFloatingSessions = useUIStore((s) => s.floatingSessionIds.length > 0);
  const hasFloatingDeliverables = useUIStore((s) => s.floatingDeliverableIds.length > 0);
  const hasDeliverableOverlay = useUIStore((s) => s.deliverableOverlay !== null);

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
        <ErrorBoundary name="nav-sidebar" variant="inline">
          <NavSidebar />
        </ErrorBoundary>
      </div>
      <div className={contentPanelCollapsed ? 'overflow-visible' : 'overflow-hidden'}>
        <ErrorBoundary name="content-panel" variant="inline">
          <ContentPanel />
        </ErrorBoundary>
      </div>
      <div className="relative flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        {!hideContentPanel && <ResizeHandle />}
        {/*
          Keyed by view identity: a caught error sticks until the boundary is
          remounted, so without this key a crash on one ticket would keep
          showing the crash screen after navigating to a healthy one.
          `useMainViewKey` is called above — it must live OUTSIDE the boundary
          it drives.
        */}
        <ErrorBoundary key={mainViewKey} name="main-view" viewKey={mainViewKey}>
          <MainPanel />
        </ErrorBoundary>
      </div>
      <ErrorBoundary name="scratchpad" variant="inline">
        <ScratchpadHint />
        <Suspense fallback={null}>{scratchpadOpen && <ScratchpadPanel />}</Suspense>
      </ErrorBoundary>
      <ErrorBoundary name="overlays" variant="inline">
        <Suspense fallback={null}>
          {hasFloatingSessions && <FloatingSessionOverlay />}
          {hasFloatingDeliverables && <FloatingDeliverableOverlay />}
          {hasDeliverableOverlay && <DeliverableReadingOverlay />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
