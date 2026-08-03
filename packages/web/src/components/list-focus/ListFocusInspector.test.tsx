import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

import type { Board, Ticket } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';

import { appWs } from '../../services/websocket';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';

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

// floating-ui popovers (the header's SmartSessionButton dropdown) need
// observers jsdom lacks (same stub as ListFocusRow.test).
beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Obs);
  vi.stubGlobal('IntersectionObserver', Obs);
});

const board: Board = { id: 'b1', name: 'Fleex Core', emoji: '🧭' } as Board;

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
      onPrev={() => {}}
      onNext={() => {}}
      canPrev
      canNext
      {...props}
    />,
  );
}

describe('ListFocusInspector', () => {
  let loadForTicket: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // SmartSessionButton (now in the header) refreshes templates on mount —
    // stub it so the inspector never reaches the network.
    useWorkflowTemplateStore.setState({
      templates: [],
      refresh: vi.fn().mockResolvedValue(undefined),
    });
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

describe('ListFocusInspector header (cockpit usability redesign, #407)', () => {
  beforeEach(() => {
    useWorkflowTemplateStore.setState({
      templates: [],
      refresh: vi.fn().mockResolvedValue(undefined),
    });
    useWorkflowRunStore.setState({ loadForTicket: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(cleanup);

  it('leads visually with the ticket title + id as the primary heading', () => {
    // WHY: NaS — the TITLE (+ its id) is the sidebar's primary element and owns
    // the <h2>. The board is now quiet metadata that lives in the faint top meta
    // bar (round 4), so it must NOT be part of the title heading.
    renderInspector({ board });
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('Fix auth loop');
    expect(heading.textContent).toContain('#412');
    expect(heading.textContent).not.toContain('Fleex Core');
  });

  it('puts the board in the top meta bar, ahead of the title (round 4)', () => {
    // WHY: round 4 — the board is demoted to quiet metadata that rides in the top
    // meta bar next to the list position, so it stops competing with the status
    // control below. Only its DOM position moved up; the title stays the primary
    // <h2>. This is the deliberate reversal of the round-1 "title-before-board".
    const { container } = renderInspector({ board });
    const text = container.textContent ?? '';
    expect(text.indexOf('Fleex Core')).toBeLessThan(text.indexOf('Fix auth loop'));
  });

  it('keeps the board and position visible as secondary info', () => {
    // The board renders as "{emoji} {name}" in one node, so match a substring.
    renderInspector({ board });
    expect(screen.getByText(/Fleex Core/)).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('exposes the Smart Session launcher in the header (mouse-only skill start)', () => {
    // WHY: NaS — the launcher must be reachable from the sidebar itself, not
    // only via the main-panel button hidden behind the sidebar. With zero
    // sessions and no skills it renders its "Start" state.
    renderInspector({ board });
    expect(screen.getByText('Start')).toBeTruthy();
  });

  it('uses a colored status dropdown and changes status on select (round 5)', () => {
    // WHY: NaS round 5 — the prototype swaps the micro-kanban for a status-tinted
    // dropdown ("un dropdown pour le statut avec la coloration qui va bien"). The
    // trigger shows the current status; opening it and picking another calls back.
    const onStatusChange = vi.fn();
    renderInspector({ board, onStatusChange }); // ticket status defaults to 'doing'
    const trigger = screen.getByText(TICKET_STATUS_LABELS['doing']!);
    fireEvent.click(trigger);
    const reviewingOption = screen.getByText(TICKET_STATUS_LABELS['reviewing']!);
    fireEvent.click(reviewingOption);
    expect(onStatusChange).toHaveBeenCalledWith('reviewing');
  });

  it('shows the list position at the very top-left, ahead of the title (round 2)', () => {
    // WHY: NaS — the "n / total" is the cursor into the frozen list (↑/↓ moves
    // it), so it belongs top-left as an index. Buried mid-line next to the board
    // it "ne veut rien dire". It must therefore precede the title in the DOM.
    const { container } = renderInspector({ board, positionLabel: '10 / 12' });
    const text = container.textContent ?? '';
    expect(text.indexOf('10 / 12')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('10 / 12')).toBeLessThan(text.indexOf('Fix auth loop'));
  });

  it('pairs "Open full" with the close button in the top-right (round 5 label)', () => {
    // WHY: NaS — the action shortened to "Open full ↗" (round 5) and stays paired
    // with the ✕ so the header actions cluster in the corner. Same parent =
    // same cluster.
    const onOpenFull = vi.fn();
    renderInspector({ board, onOpenFull });
    const openFull = screen.getByRole('button', { name: /open full/i });
    const close = screen.getByRole('button', { name: /close/i });
    expect(openFull.parentElement).toBe(close.parentElement);
    fireEvent.click(openFull);
    expect(onOpenFull).toHaveBeenCalled();
  });

  it('places the status dropdown BEFORE the Smart Session launcher on line 3 (round 5)', () => {
    // WHY: NaS round 5 — the prototype puts the status control on the left of the
    // last header line and the launcher on its right, so status must DOM-precede
    // the launcher.
    renderInspector({ board });
    const status = screen.getByText(TICKET_STATUS_LABELS['doing']!);
    const launcher = screen.getByText('Start');
    expect(
      status.compareDocumentPosition(launcher) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the Smart Session launcher at its usual compact size (round 5)', () => {
    // WHY: NaS round 5 — the launcher shares line 3 with the status dropdown at
    // its normal dashboard size (not the full-width / 250×50 experiments).
    renderInspector({ board });
    const trigger = screen.getByText('Start').closest('button')!;
    expect(trigger.className).not.toContain('w-full');
    expect(trigger.className).not.toContain('w-[250px]');
  });

  it('steps to the previous/next ticket via the < > chevrons (round 5)', () => {
    // WHY: NaS round 5 — the position sits in a [< n/total >] stepper; the
    // chevrons move the cursor in the frozen list (same as ↑/↓).
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderInspector({ board, onPrev, onNext });
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPrev).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
  });

  it('disables the chevrons at the list bounds (round 5)', () => {
    // WHY: at the first/last ticket there is nowhere to step, so the matching
    // chevron must be disabled rather than silently no-op.
    renderInspector({ board, canPrev: false, canNext: true });
    expect((screen.getByRole('button', { name: /previous/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
