import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AgendaItem, BoardWithCounts, Ticket, TicketDeliverable } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgendaTicket: vi.fn(),
  fetchAgendaTicketDeliverables: vi.fn(),
  fetchAgendaRunDeliverables: vi.fn(),
}));

import * as api from '../../services/api';
import { AgendaItemDetails } from './AgendaItemDetails';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';

const NOW = new Date(2026, 10, 5, 11, 30);

const deliv = (id: string, title: string, over: Partial<TicketDeliverable> = {}): TicketDeliverable => ({
  id, title, ticketId: null, agentName: 'agent', type: 'report', content: '# x', version: 1, status: 'final',
  mentionId: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
});

const ticket = {
  id: 'tk-1', boardId: 'b1', displayId: 642, title: 'vue agenda dans routines', description: '', status: 'done',
  priority: 'high', complexity: null, type: null, position: 0, tags: ['ux'], links: [], blocked: false, favorite: false,
  dueDate: null, assignee: 'olivier', agentClaimedAt: null, githubMetadata: null, archivedAt: null, firstDoingAt: null,
  statusChangedAt: NOW.toISOString(), conversationMode: 'plan', modelOverride: null, effortOverride: null, fastMode: false,
  createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z',
  epics: [{ id: 'e1', name: 'Agenda', emoji: '', color: 'blue', timeframe: '', groupStatus: 'active' }],
} as unknown as Ticket;

function renderCard(item: AgendaItem) {
  return render(
    <MemoryRouter>
      <AgendaItemDetails item={item} now={NOW} onClose={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.fetchAgendaTicket).mockResolvedValue(ticket);
  vi.mocked(api.fetchAgendaTicketDeliverables).mockResolvedValue([deliv('d-t', 'Spec of the agenda', { ticketId: 'tk-1', type: 'spec' })]);
  vi.mocked(api.fetchAgendaRunDeliverables).mockResolvedValue([deliv('d-r', 'Weekly digest')]);
  useTicketStore.setState({ boards: [{ id: 'b1', name: 'Fleex', emoji: '', createdAt: '' } as unknown as BoardWithCounts] });
  useUIStore.setState({ deliverableOverlay: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<AgendaItemDetails/>', () => {
  it('lists the deliverables a routine run produced, and opens one in the reading overlay', async () => {
    renderCard({
      id: 'routine.run:r1', type: 'routine.run', shape: 'block', start: new Date(2026, 10, 5, 9).toISOString(),
      end: new Date(2026, 10, 5, 9, 4).toISOString(), status: 'completed', title: 'Weekly digest', runId: 'run-1',
      triggeredFrom: 'manual', routine: { id: 'digest', name: 'Weekly digest', emoji: '' },
    });
    const row = await screen.findByRole('button', { name: /Weekly digest/ });
    expect(api.fetchAgendaRunDeliverables).toHaveBeenCalledWith('run-1');
    expect(screen.getByText('Deliverables of this run')).toBeTruthy();
    expect(screen.getByText('Launched manually')).toBeTruthy();
    expect(api.fetchAgendaTicket).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(useUIStore.getState().deliverableOverlay?.id).toBe('d-r');
  });

  it('shows nothing for the run deliverables when the endpoint has none (404 → [])', async () => {
    vi.mocked(api.fetchAgendaRunDeliverables).mockResolvedValue([]);
    renderCard({
      id: 'routine.run:r2', type: 'routine.run', shape: 'point', start: NOW.toISOString(), status: 'completed',
      title: 'Sync', runId: 'run-2', routine: { id: 's', name: 'Sync', emoji: '' },
    });
    await waitFor(() => expect(api.fetchAgendaRunDeliverables).toHaveBeenCalled());
    expect(screen.queryByText('Deliverables of this run')).toBeNull();
    expect(screen.queryByText(/Could not load/)).toBeNull();
  });

  it('orders a workflow run card: ticket header, then run, then all deliverables, then the buttons', async () => {
    renderCard({
      id: 'workflow.run:w1', type: 'workflow.run', shape: 'block', start: new Date(2026, 10, 5, 9).toISOString(),
      end: new Date(2026, 10, 5, 10).toISOString(), status: 'completed', title: 'vue agenda dans routines', runId: 'run-w',
      workflowName: 'Bugfix', ticket: { id: 'tk-1', displayId: 642, title: 'vue agenda dans routines', boardId: 'b1', status: 'done', tags: [], epicIds: [], repos: [] },
    } as unknown as AgendaItem);
    await screen.findByText('Spec of the agenda');
    await screen.findByText('Deliverables of this run');
    const order = [
      screen.getByTestId('agenda-ticket-strip'),
      ...['Workflow run', 'Deliverables of this run', 'Ticket deliverables', 'Open ticket'].map((t) => screen.getByText(t, { exact: true })),
    ];
    for (let i = 1; i < order.length; i++) {
      // Each heading must come after the previous one in the document.
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('gives a done ticket its status, board, metadata and deliverables', async () => {
    vi.mocked(api.fetchAgendaTicket).mockResolvedValue({ ...ticket, favorite: true, blocked: true } as Ticket);
    renderCard({
      id: 'ticket.done:tk-1', type: 'ticket.done', shape: 'point', start: NOW.toISOString(), title: ticket.title,
      ticket: { id: 'tk-1', displayId: 642, title: ticket.title, boardId: 'b1', status: 'done', tags: ['ux'], epicIds: ['e1'], repos: [] },
    });
    expect(await screen.findByText('Spec of the agenda')).toBeTruthy();
    // The ticket is a row of inline icons in the header, not a "label: value" grid.
    const strip = screen.getByTestId('agenda-ticket-strip');
    expect(screen.queryByText('Status')).toBeNull();
    expect(strip.textContent).toContain('Done');
    expect(within(strip).getByText('Fleex')).toBeTruthy();
    await waitFor(() => expect(within(strip).getByText('@olivier')).toBeTruthy());
    expect(within(strip).getByText('Agenda')).toBeTruthy();
    expect(within(strip).getByTitle('Priority: High')).toBeTruthy();
    expect(within(strip).getByTitle('Favorite')).toBeTruthy();
    expect(within(strip).getByTitle('Blocked')).toBeTruthy();
    expect(screen.getByText('#642')).toBeTruthy();
    expect(api.fetchAgendaTicketDeliverables).toHaveBeenCalledWith('tk-1');
    expect(api.fetchAgendaRunDeliverables).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open ticket' })).toBeTruthy();
  });

  it('says so when the ticket deliverables cannot be loaded', async () => {
    vi.mocked(api.fetchAgendaTicketDeliverables).mockRejectedValue(new Error('boom'));
    renderCard({
      id: 'ticket.created:tk-1', type: 'ticket.created', shape: 'point', start: NOW.toISOString(), title: ticket.title,
      ticket: { id: 'tk-1', displayId: 642, title: ticket.title, boardId: 'b1', status: 'done', tags: [], epicIds: [], repos: [] },
    });
    expect(await screen.findByText('Could not load the deliverables.')).toBeTruthy();
  });

  it('keeps the title and the buttons out of the scroll: fixed header, scrolling body, fixed footer', async () => {
    renderCard({
      id: 'ticket.done:tk-1', type: 'ticket.done', shape: 'point', start: NOW.toISOString(), title: ticket.title,
      ticket: { id: 'tk-1', displayId: 642, title: ticket.title, boardId: 'b1', status: 'done', tags: [], epicIds: [], repos: [] },
    });
    await screen.findByText('Spec of the agenda');
    const header = screen.getByTestId('agenda-card-header');
    const body = screen.getByTestId('agenda-card-body');
    const footer = screen.getByTestId('agenda-card-footer');
    expect(body.className).toContain('overflow-y-auto');
    expect(header.className).toContain('shrink-0');
    expect(footer.className).toContain('shrink-0');
    // Title and buttons live outside the scrolling part.
    expect(body.contains(screen.getByText(ticket.title))).toBe(false);
    expect(header.contains(screen.getByText(ticket.title))).toBe(true);
    expect(footer.contains(screen.getByRole('button', { name: 'Open ticket' }))).toBe(true);
    expect(body.contains(screen.getByText('Spec of the agenda'))).toBe(true);
  });

  it('gives every footer action the same Fleex button look, with exactly one primary', async () => {
    renderCard({
      id: 'pr.merged:1', type: 'pr.merged', shape: 'point', start: NOW.toISOString(), title: 'fleex#348', prRef: 'oliviermadre/fleex#348',
      ticket: { id: 'tk-1', displayId: 642, title: ticket.title, boardId: 'b1', status: 'done', tags: [], epicIds: [], repos: [] },
    } as unknown as AgendaItem);
    const footer = screen.getByTestId('agenda-card-footer');
    const open = within(footer).getByRole('button', { name: 'Open ticket' });
    const gh = within(footer).getByRole('button', { name: /Open on GitHub/ });
    expect(open.className).toContain('bg-[var(--theme-accent)]');
    expect(gh.className).toContain('bg-[var(--theme-bg-overlay)]');
    expect(footer.querySelectorAll('[class*="bg-[var(--theme-accent)]"]')).toHaveLength(1);
  });

  it('a Google meeting: Join Meet is the primary action, Open in Google Calendar a secondary Fleex button', () => {
    renderCard({
      id: 'external:x', type: 'external', shape: 'block', start: '2099-11-05T09:00:00Z', end: '2099-11-05T10:00:00Z', title: 'Weekly sync',
      external: { calendarId: 'primary', eventKey: 'x', eventId: 'e', htmlLink: 'https://calendar.google.com/e', attendees: 0, location: null,
        meetUrl: 'https://meet.google.com/abc', description: null, organizer: null, attendeeList: [], rsvp: null, canRespond: false, eventType: 'default', links: [] },
    } as unknown as AgendaItem);
    const footer = screen.getByTestId('agenda-card-footer');
    expect(within(footer).getByRole('link', { name: /Join Google Meet/ }).className).toContain('bg-[var(--theme-accent)]');
    expect(within(footer).getByRole('button', { name: /Open in Google Calendar/ }).className).toContain('bg-[var(--theme-bg-overlay)]');
  });
});
