import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import type { AgendaExternalLink, AgendaItem, DeliverableListItem, TicketDeliverable } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgenda: vi.fn(),
  fetchDeliverable: vi.fn(),
  createAgendaExternalLink: vi.fn(),
  deleteAgendaExternalLink: vi.fn(),
}));
vi.mock('../../services/documentsService', () => ({ documentsService: { list: vi.fn() } }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as api from '../../services/api';
import { documentsService } from '../../services/documentsService';
import { toast } from '../../lib/toast';
import { AgendaEventLinks, AgendaMeetingLinks, normalizeTitle, rankDeliverables } from './AgendaMeetingLinks';
import { useUIStore } from '../../stores/uiStore';

const START = '2026-11-05T09:00:00.000Z';

const deliv = (id: string, title: string, createdAt: string): DeliverableListItem => ({
  id, title, createdAt, updatedAt: createdAt, ticketId: null, agentName: 'a', type: 'report', content: '', version: 1,
  status: 'final', mentionId: null, origin: null,
}) as DeliverableListItem;

const link = (over: Partial<AgendaExternalLink> = {}): AgendaExternalLink => ({
  id: 'l1', provider: 'google', eventKey: 'ical-1', deliverableId: 'd-linked', deliverableTitle: 'Notes of last week',
  eventTitle: 'Sprint review', eventStart: START, source: 'cli', createdAt: START, ...over,
});

const meeting = (links: AgendaExternalLink[] = []): AgendaItem => ({
  id: 'external:1', type: 'external', shape: 'block', start: START, end: '2026-11-05T10:00:00.000Z', title: 'Sprint Review',
  external: { calendarId: 'primary', eventKey: 'ical-1', htmlLink: null, attendees: 4, location: null, eventType: 'default', links },
});

const list = [
  deliv('d-old', 'Roadmap Q4', '2026-10-01T10:00:00.000Z'),
  deliv('d-after', 'PR summary', '2026-11-05T12:30:00.000Z'),
  deliv('d-late', 'Something else', '2026-11-05T16:00:00.000Z'),
  deliv('d-title', 'Sprint review — décisions', '2026-09-01T10:00:00.000Z'),
];

beforeEach(() => {
  vi.mocked(documentsService.list).mockResolvedValue({ items: list, total: list.length, limit: 50, offset: 0 });
  vi.mocked(api.fetchAgenda).mockResolvedValue({ from: '', to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} });
  vi.mocked(api.createAgendaExternalLink).mockImplementation(async (input) => link({ id: 'new', deliverableId: input.deliverableId, deliverableTitle: 'x', source: 'manual' }));
  vi.mocked(api.deleteAgendaExternalLink).mockResolvedValue();
  useUIStore.setState({ deliverableOverlay: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('rankDeliverables', () => {
  it('suggests what was created within 6 h after the start, or titled after the meeting', () => {
    expect(normalizeTitle('  Sprint Review — Décisions!')).toBe('sprint review decisions');
    const { suggested, others } = rankDeliverables(list, { title: 'Sprint Review', start: START });
    expect(suggested.map((d) => d.id)).toEqual(['d-after', 'd-title']);
    expect(others.map((d) => d.id)).toEqual(['d-old', 'd-late']);
  });
});

describe('<AgendaMeetingLinks/>', () => {
  it('lists the links with their source, and says the link lives in Fleex only', () => {
    render(<AgendaMeetingLinks item={meeting([link()])} onClose={() => {}} />);
    expect(screen.getByText('Notes of last week')).toBeTruthy();
    expect(screen.getByText('cli')).toBeTruthy();
    expect(screen.getByText(/nothing is written to Google Calendar/)).toBeTruthy();
  });

  it('opens a linked deliverable in the reading overlay', async () => {
    const d = { id: 'd-linked', title: 'Notes of last week' } as TicketDeliverable;
    vi.mocked(api.fetchDeliverable).mockResolvedValue(d);
    const onClose = vi.fn();
    render(<AgendaMeetingLinks item={meeting([link()])} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(useUIStore.getState().deliverableOverlay).toBe(d));
    expect(api.fetchDeliverable).toHaveBeenCalledWith('d-linked');
    expect(onClose).toHaveBeenCalled();
  });

  it('unlinks with an Undo that recreates the link', async () => {
    render(<AgendaMeetingLinks item={meeting([link()])} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Notes of last week' }));
    await waitFor(() => expect(api.deleteAgendaExternalLink).toHaveBeenCalledWith('l1'));
    await waitFor(() => expect(screen.queryByText('Notes of last week')).toBeNull());
    const [, opts] = vi.mocked(toast.info).mock.calls[0]!;
    await act(async () => opts!.action!.onClick());
    expect(api.createAgendaExternalLink).toHaveBeenCalledWith({ eventKey: 'ical-1', deliverableId: 'd-linked', eventTitle: 'Sprint review', eventStart: START });
    await waitFor(() => expect(screen.getByText('x')).toBeTruthy());
  });

  it('lists the suggestions first in the picker, without what is already linked, and attaches with the right body', async () => {
    vi.mocked(documentsService.list).mockResolvedValue({ items: [...list, deliv('d-linked', 'Notes of last week', START)], total: 5, limit: 50, offset: 0 });
    render(<AgendaMeetingLinks item={meeting([link()])} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Attach deliverable/ }));
    const box = await screen.findByRole('listbox', { name: 'Deliverables' });
    await waitFor(() => expect(within(box).getAllByRole('option')).toHaveLength(4));
    expect(within(box).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('PR summary'),
      expect.stringContaining('Sprint review — décisions'),
      expect.stringContaining('Roadmap Q4'),
      expect.stringContaining('Something else'),
    ]);
    expect(within(box).getByText('Suggested')).toBeTruthy();
    // With no search, the meeting title is also queried.
    expect(vi.mocked(documentsService.list).mock.calls.map((c) => c[0].search)).toEqual(['', 'Sprint Review']);

    fireEvent.click(within(box).getByRole('option', { name: /PR summary/ }));
    await waitFor(() => expect(api.createAgendaExternalLink).toHaveBeenCalledWith({
      eventKey: 'ical-1', deliverableId: 'd-after', eventTitle: 'Sprint Review', eventStart: START,
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.fetchAgenda).toHaveBeenCalled();
  });

  it('searches deliverables as the user types', async () => {
    render(<AgendaMeetingLinks item={meeting()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Attach deliverable/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search deliverables' }), { target: { value: 'roadmap' } });
    await waitFor(() => expect(vi.mocked(documentsService.list).mock.calls.some((c) => c[0].search === 'roadmap')).toBe(true));
  });
});

describe('<AgendaEventLinks/> — deliverables on a free event (E1)', () => {
  const freeEvent = (over: Partial<AgendaItem> = {}, recurrence: 'weekly' | null = null): AgendaItem => ({
    id: recurrence ? `event:ev1:${START}` : 'event:ev1', type: 'event', shape: 'block', start: START, end: '2026-11-05T10:00:00.000Z', title: 'Planning',
    event: {
      id: 'ev1', title: 'Planning', description: null, allDay: false, start: START, end: '2026-11-05T10:00:00.000Z', color: null,
      ticketId: null, epicId: null, recurrence, recurrenceUntil: null, createdAt: '', updatedAt: '',
    },
    eventLinks: [],
    ...over,
  });

  it('attaches a deliverable to a one-off event under its Fleex key', async () => {
    render(<AgendaEventLinks item={freeEvent()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Attach deliverable/ }));
    const box = await screen.findByRole('listbox', { name: 'Deliverables' });
    fireEvent.click(await within(box).findByRole('option', { name: /Roadmap Q4/ }));
    await waitFor(() => expect(api.createAgendaExternalLink).toHaveBeenCalledWith({
      eventKey: 'fleex-event:ev1', deliverableId: 'd-old', eventTitle: 'Planning', eventStart: START,
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Roadmap Q4" attached to the event'));
    expect(screen.queryByText(/Google Calendar/)).toBeNull();
  });

  it('attaches to the clicked occurrence of a recurring event, not the whole series', async () => {
    render(<AgendaEventLinks item={freeEvent({}, 'weekly')} onClose={() => {}} />);
    expect(screen.getByText('Attached to this occurrence only.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Attach deliverable/ }));
    const box = await screen.findByRole('listbox', { name: 'Deliverables' });
    fireEvent.click(await within(box).findByRole('option', { name: /Roadmap Q4/ }));
    await waitFor(() => expect(api.createAgendaExternalLink).toHaveBeenCalledWith(expect.objectContaining({ eventKey: `fleex-event:ev1|${START}` })));
  });

  it('lists what is already attached', () => {
    render(<AgendaEventLinks item={freeEvent({ eventLinks: [link({ provider: 'fleex', eventKey: 'fleex-event:ev1' })] })} onClose={() => {}} />);
    expect(screen.getByText('Notes of last week')).toBeTruthy();
  });
});
