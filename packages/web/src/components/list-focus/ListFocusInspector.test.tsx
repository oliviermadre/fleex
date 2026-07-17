import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { appWs } from '../../services/websocket';
import { ListFocusInspector } from './ListFocusInspector';

// The inspector embeds the full comment thread / deliverable list; those own
// their data-loading and are covered elsewhere. Stub them so this test focuses
// on what the INSPECTOR owns: tab order/default and workflow-run loading.
vi.mock('../tickets/TicketComments', () => ({
  TicketComments: ({ ticketId }: { ticketId: string }) => (
    <div data-testid="comments-stub">{ticketId}</div>
  ),
}));
vi.mock('../tickets/TicketDeliverables', () => ({
  TicketDeliverables: ({ ticketId }: { ticketId: string }) => (
    <div data-testid="deliverables-stub">{ticketId}</div>
  ),
}));
vi.mock('../../services/websocket', () => ({
  appWs: { onChannel: vi.fn(() => () => {}) },
}));

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    boardId: 'b1',
    displayId: 412,
    title: 'Fix auth loop',
    description: '',
    status: 'doing',
    priority: 'none',
    type: null,
    position: 0,
    tags: [],
    links: [],
    blocked: false,
    favorite: false,
    dueDate: null,
    assignee: null,
    agentClaimedAt: null,
    githubMetadata: null,
    archivedAt: null,
    firstDoingAt: null,
    statusChangedAt: '2026-07-01T00:00:00.000Z',
    conversationMode: 'plan',
    modelOverride: null,
    effortOverride: null,
    fastMode: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as Ticket;
}

function renderInspector(props: Partial<Parameters<typeof ListFocusInspector>[0]> = {}) {
  return render(
    <ListFocusInspector
      ticket={makeTicket()}
      focus={null}
      positionLabel="1 / 3"
      parentRef={{ current: null }}
      onClose={() => {}}
      onStatusChange={() => {}}
      onOpenFull={() => {}}
      {...props}
    />,
  );
}

describe('ListFocusInspector', () => {
  let loadForTicket: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadForTicket = vi.fn().mockResolvedValue(undefined);
    useWorkflowRunStore.setState({ runsByTicket: {}, detail: {}, loadForTicket });
  });
  afterEach(cleanup);

  it('defaults to the Comment tab, listed first (review remark 2)', () => {
    // WHY: the cockpit's primary triage action is reading/answering the thread
    // (relaunching an agent). Deliverables-first buried the main action.
    renderInspector();
    expect(screen.getByTestId('comments-stub')).toBeTruthy();
    expect(screen.queryByTestId('deliverables-stub')).toBeNull();

    const commentTab = screen.getByRole('button', { name: /comment/i });
    const deliverablesTab = screen.getByRole('button', { name: /deliverables/i });
    // Comment tab must come BEFORE the deliverables tab in the DOM.
    expect(
      commentTab.compareDocumentPosition(deliverablesTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('still opens the deliverables tab when a deliverables badge was clicked', () => {
    renderInspector({ focus: 'deliverables' });
    expect(screen.getByTestId('deliverables-stub')).toBeTruthy();
    expect(screen.queryByTestId('comments-stub')).toBeNull();
  });

  it('loads the workflow runs for the ticket on open (review remark 1)', () => {
    // WHY: the human-gate card in the comment thread reads workflowRunStore but
    // relies on its PARENT to load the runs (TicketDetail does). The cockpit
    // inspector didn't, so the validation encart only appeared after visiting
    // the full ticket once (which populated the store as a side effect).
    renderInspector();
    expect(loadForTicket).toHaveBeenCalledWith('t1');
  });

  it('refreshes the runs when a workflow:* event lands for this ticket', () => {
    // WHY: same wiring as TicketDetail — resolving the gate (or a step
    // completing) must update the card while the inspector stays open.
    renderInspector();
    const handler = vi.mocked(appWs.onChannel).mock.calls[0]?.[1];
    expect(handler).toBeTypeOf('function');
    loadForTicket.mockClear();

    handler!({ type: 'workflow:step:completed', data: { ticketId: 't1' } });
    expect(loadForTicket).toHaveBeenCalledWith('t1');

    loadForTicket.mockClear();
    handler!({ type: 'workflow:step:completed', data: { ticketId: 'other' } });
    expect(loadForTicket).not.toHaveBeenCalled();
  });
});
