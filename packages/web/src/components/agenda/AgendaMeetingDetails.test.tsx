import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import type { AgendaItem, AgendaResponse } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  respondToAgendaMeeting: vi.fn(),
  fetchAgenda: vi.fn(),
}));

import * as api from '../../services/api';
import { AgendaMeetingDetails, attendeeSummary } from './AgendaMeetingDetails';
import { AgendaChip } from './AgendaChip';
import { chipStyle } from './agendaLabels';
import { useAgendaStore, withRsvp } from '../../stores/agendaStore';

const meeting = (over: Partial<NonNullable<AgendaItem['external']>> = {}): AgendaItem => ({
  id: 'external:weekly@google.com',
  type: 'external',
  shape: 'block',
  start: '2099-11-05T09:00:00.000Z',
  end: '2099-11-05T10:00:00.000Z',
  title: 'Weekly sync',
  status: 'needsAction',
  external: {
    calendarId: 'primary',
    eventKey: 'weekly@google.com',
    eventId: 'evt_1',
    htmlLink: null,
    attendees: 3,
    location: null,
    meetUrl: 'https://meet.google.com/abc-defg-hij',
    description: 'Agenda:\nRoadmap — see https://docs.example/x',
    organizer: { email: 'alex@example.com', name: 'Alex', self: false },
    attendeeList: [
      { email: 'alex@example.com', name: 'Alex', response: 'accepted', organizer: true, self: false, optional: false },
      { email: 'me@example.com', name: null, response: 'needsAction', organizer: false, self: true, optional: false },
      { email: 'zoe@example.com', name: 'Zoé', response: 'declined', organizer: false, self: false, optional: true },
    ],
    rsvp: 'needsAction',
    canRespond: true,
    eventType: 'default',
    links: [],
    ...over,
  },
});

const dataWith = (item: AgendaItem): AgendaResponse => ({
  from: '2099-11-02T00:00:00.000Z', to: '2099-11-09T00:00:00.000Z', generatedAt: '', items: [item],
  routines: [], truncated: [], epics: [], errors: {},
});

beforeEach(() => {
  vi.mocked(api.fetchAgenda).mockImplementation(async () => useAgendaStore.getState().data!);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAgendaStore.setState({ data: null });
});

describe('<AgendaMeetingDetails/>', () => {
  it('shows the Meet join link, the notes with live links, and every guest with their answer', () => {
    render(<AgendaMeetingDetails item={meeting()} />);
    const join = screen.getByRole('link', { name: /Join Google Meet/ });
    expect(join.getAttribute('href')).toBe('https://meet.google.com/abc-defg-hij');
    expect(join.getAttribute('target')).toBe('_blank');

    const notes = screen.getByTestId('agenda-meeting-notes');
    expect(notes.textContent).toContain('Roadmap');
    expect(within(notes).getByRole('link').getAttribute('href')).toBe('https://docs.example/x');

    const guests = screen.getByTestId('agenda-meeting-guests');
    expect(guests.textContent).toContain('Alex');
    expect(guests.textContent).toContain('organizer');
    expect(guests.textContent).toContain('me@example.com (you)');
    expect(guests.textContent).toContain('Zoé');
    expect(screen.getByText('1 going · 1 declined · 1 awaiting')).toBeTruthy();
  });

  it('answering shows at once, is sent to Google, and the chip switches from outlined to filled', async () => {
    const item = meeting();
    useAgendaStore.setState({ data: dataWith(item) });
    vi.mocked(api.respondToAgendaMeeting).mockResolvedValue(undefined);
    const outlined = chipStyle(useAgendaStore.getState().data!.items[0]!);
    expect(outlined.background).toBe('transparent');

    render(<AgendaMeetingDetails item={item} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('true');
    expect(api.respondToAgendaMeeting).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'evt_1', status: 'accepted' });
    const after = useAgendaStore.getState().data!.items[0]!;
    expect(after.external!.rsvp).toBe('accepted');
    expect(after.external!.attendeeList!.find((a) => a.self)!.response).toBe('accepted');
    expect(chipStyle(after).background).not.toBe('transparent');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' }).hasAttribute('disabled')).toBe(false));
  });

  it('puts the previous answer back when Google refuses (e.g. gog only has read-only access)', async () => {
    const item = meeting({ rsvp: 'tentative' });
    useAgendaStore.setState({ data: dataWith(item) });
    vi.mocked(api.respondToAgendaMeeting).mockRejectedValue(new Error('API error 409'));
    render(<AgendaMeetingDetails item={item} />);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    await waitFor(() => expect(useAgendaStore.getState().data!.items[0]!.external!.rsvp).toBe('tentative'));
    expect(screen.getByRole('button', { name: 'Maybe' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers no answer on a meeting I organize or am not invited to', () => {
    render(<AgendaMeetingDetails item={meeting({ rsvp: null, canRespond: false })} />);
    expect(screen.queryByTestId('agenda-rsvp')).toBeNull();
    expect(screen.getByRole('link', { name: /Join Google Meet/ })).toBeTruthy();
  });
});

describe('a meeting chip follows my answer', () => {
  it('outlined while unanswered, hatched for maybe, faded and struck through when declined, filled when going', () => {
    expect(chipStyle(meeting({ rsvp: 'needsAction' })).background).toBe('transparent');
    expect(String(chipStyle(meeting({ rsvp: 'tentative' })).background)).toContain('repeating-linear-gradient');
    const declined = chipStyle(meeting({ rsvp: 'declined' }));
    expect(declined.opacity).toBe(0.6);
    expect(String(chipStyle(meeting({ rsvp: 'accepted' })).background)).toContain('var(--');
    expect(String(chipStyle(meeting({ rsvp: null })).background)).toContain('var(--');

    render(<AgendaChip item={meeting({ rsvp: 'declined' })} onOpen={() => {}} />);
    expect(screen.getByText('Weekly sync').className).toContain('line-through');
  });

  it('has a join shortcut that opens the call without opening the card', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onOpen = vi.fn();
    render(<AgendaChip item={meeting({ rsvp: 'accepted' })} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('link', { name: 'Join the video call' }));
    expect(open).toHaveBeenCalledWith('https://meet.google.com/abc-defg-hij', '_blank', 'noopener');
    expect(onOpen).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('drops the join shortcut once the meeting is over or declined', () => {
    render(<AgendaChip item={{ ...meeting(), start: '2020-01-01T09:00:00Z', end: '2020-01-01T10:00:00Z' }} onOpen={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Join the video call' })).toBeNull();
    cleanup();
    render(<AgendaChip item={meeting({ rsvp: 'declined' })} onOpen={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Join the video call' })).toBeNull();
  });
});

describe('helpers', () => {
  it('withRsvp only touches the meeting answered', () => {
    const other = { ...meeting(), id: 'external:other' };
    const data = { ...dataWith(meeting()), items: [meeting(), other] };
    const next = withRsvp(data, 'external:weekly@google.com', 'declined');
    expect(next.items[0]!.external!.rsvp).toBe('declined');
    expect(next.items[0]!.status).toBe('declined');
    expect(next.items[1]).toBe(other);
  });

  it('attendeeSummary skips empty answers', () => {
    expect(attendeeSummary([])).toBe('');
  });
});
