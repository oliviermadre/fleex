import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { __resetErrorReporterForTests } from '../../services/errorReporter';
import { useUIStore } from '../../stores/uiStore';

/**
 * The ticket's acceptance criterion: "a forced exception in the Analytics view
 * must affect only that view."
 *
 * Before this change the whole tree unmounted and the user got a blank page.
 * This test renders the real AppLayout with a genuinely throwing AnalyticsPanel
 * and asserts the nav and content columns are still mounted next to the crash
 * screen.
 */

// The panel under test throws for real; everything else in the layout is
// stubbed down to identifiable markers so the assertions are about isolation,
// not about the panels' own behaviour.
vi.mock('../analytics/AnalyticsPanel', () => ({
  AnalyticsPanel: function AnalyticsPanel(): never {
    throw new Error('analytics exploded');
  },
}));
vi.mock('../sidebar/NavSidebar', () => ({
  NavSidebar: () => <nav data-testid="nav-sidebar">nav</nav>,
}));
vi.mock('../sidebar/ContentPanel', () => ({
  ContentPanel: () => <div data-testid="content-panel">content</div>,
}));
vi.mock('../scratchpad/ScratchpadPanel', () => ({ ScratchpadPanel: () => null }));
vi.mock('../scratchpad/ScratchpadHint', () => ({ ScratchpadHint: () => null }));
vi.mock('../main-panel/FloatingSessionOverlay', () => ({ FloatingSessionOverlay: () => null }));
vi.mock('../tickets/FloatingDeliverableOverlay', () => ({ FloatingDeliverableOverlay: () => null }));
vi.mock('../tickets/DeliverableReadingOverlay', () => ({ DeliverableReadingOverlay: () => null }));
vi.mock('./ResizeHandle', () => ({ ResizeHandle: () => null }));

// AppLayout mounts 11 data-loading hooks on mount; none are under test here.
vi.mock('../../hooks/useWebSocket', () => ({ useWebSocket: () => {} }));
vi.mock('../../hooks/useSessions', () => ({ useSessions: () => {} }));
vi.mock('../../hooks/useRepositoryDashboard', () => ({ useRepositoryDashboard: () => {} }));
vi.mock('../../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../../hooks/useHotkeyReveal', () => ({ useHotkeyReveal: () => {} }));
vi.mock('../../hooks/usePullRequestPolling', () => ({ usePullRequestPolling: () => {} }));
vi.mock('../../hooks/useTickets', () => ({ useTickets: () => {} }));
vi.mock('../../hooks/useTicketActivity', () => ({ useTicketActivity: () => {} }));
vi.mock('../../hooks/useNotifications', () => ({ useNotifications: () => {} }));
vi.mock('../../hooks/useAgentPersonas', () => ({ useAgentPersonas: () => {} }));
vi.mock('../../hooks/useSkills', () => ({ useSkills: () => {} }));

const { AppLayout } = await import('./AppLayout');

describe('AppLayout error isolation', () => {
  beforeEach(() => {
    __resetErrorReporterForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useUIStore.setState({ activePanel: 'analytics' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('contains a crashing Analytics view without taking down the rest of the app', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    // The crash screen replaced only the main view…
    expect(screen.getByText('This view crashed')).toBeTruthy();

    // …while the surrounding chrome is still mounted, so the user can navigate
    // away instead of reloading the page.
    expect(screen.getByTestId('nav-sidebar')).toBeTruthy();
    expect(screen.getByTestId('content-panel')).toBeTruthy();
  });

  it('reports the crash with the view key that identifies the dead branch', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const report = fetchMock.mock.calls.find((c) => c[0] === '/api/client-errors');
    expect(report).toBeTruthy();

    const body = JSON.parse((report![1] as RequestInit).body as string);
    expect(body.boundary).toBe('main-view');
    expect(body.viewKey).toBe('analytics');
    expect(body.message).toBe('analytics exploded');
  });
});
