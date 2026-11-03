import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { TicketGroup } from '@fleex/shared';
import { EpicPicker } from './EpicPicker';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { fetchTicketGroups } from '../../services/api';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchTicketGroups: vi.fn(async () => [epic('e1', 'OdysAI - Beta Multi DMCs')]),
}));

const removeTicketFromGroup = vi.fn(async () => {});

let path = '';
function LocationSpy() {
  path = useLocation().pathname;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  path = '';
  useTicketGroupStore.setState({ groups: [], ticketGroupIds: { t1: ['e1'] }, removeTicketFromGroup });
});

afterEach(cleanup);

/** An epic is a place of its own — its detail page — reachable from any ticket that belongs to it. */
describe('EpicPicker — opening the epic', () => {
  async function renderPicker() {
    render(
      <MemoryRouter initialEntries={['/work']}>
        <LocationSpy />
        <EpicPicker ticketId="t1" boardId="b1" />
      </MemoryRouter>,
    );
    return screen.findByText('OdysAI - Beta Multi DMCs');
  }

  it("opens the epic's page on its own board when clicked", async () => {
    const chip = await renderPicker();

    fireEvent.click(chip);

    await waitFor(() => expect(path).toBe('/tickets/board/b1/epic/e1'));
  });

  it('removes the ticket from the epic without navigating when the × is clicked', async () => {
    await renderPicker();

    fireEvent.click(screen.getByTitle('Remove from epic'));

    await waitFor(() => expect(removeTicketFromGroup).toHaveBeenCalledWith('e1', 't1'));
    expect(path).toBe('/work');
  });
});

/**
 * Assigning an epic from a ticket must be quick: the dropdown only offers the
 * epics still in play (Now/Next/Later). Finished epics are noise there — a
 * ticket is attached to one of those from the epic's own page.
 */
describe('EpicPicker — which epics the dropdown offers', () => {
  function renderWithEpics(epics: TicketGroup[], assigned: string[]) {
    vi.mocked(fetchTicketGroups).mockResolvedValueOnce(epics);
    useTicketGroupStore.setState({ ticketGroupIds: { t1: assigned } });
    render(
      <MemoryRouter>
        <EpicPicker ticketId="t1" boardId="b1" />
      </MemoryRouter>,
    );
  }

  it('offers only active epics, whatever their timeframe — never done, cancelled or archived ones', async () => {
    renderWithEpics(
      [
        epic('now', 'Now epic', { timeframe: 'now' }),
        epic('next', 'Next epic', { timeframe: 'next' }),
        epic('later', 'Later epic', { timeframe: 'later' }),
        epic('done', 'Done epic', { groupStatus: 'done' }),
        epic('cancelled', 'Cancelled epic', { groupStatus: 'cancelled' }),
        epic('archived', 'Archived epic', { groupStatus: 'archived' }),
      ],
      [],
    );

    const select = await screen.findByRole('combobox');
    const offered = Array.from(select.querySelectorAll('option'))
      .map((o) => o.value)
      .filter(Boolean);
    expect(offered).toEqual(['now', 'next', 'later']);
  });

  it('still shows a done epic the ticket already belongs to, so it can be opened or removed', async () => {
    renderWithEpics([epic('done', 'Done epic', { groupStatus: 'done' }), epic('now', 'Now epic')], ['done']);

    expect(await screen.findByText('Done epic')).toBeTruthy();
    expect(screen.getByTitle('Remove from epic')).toBeTruthy();
  });

  it('does not offer an active epic the ticket already belongs to', async () => {
    renderWithEpics([epic('now', 'Now epic'), epic('next', 'Next epic', { timeframe: 'next' })], ['now']);

    const select = await screen.findByRole('combobox');
    const offered = Array.from(select.querySelectorAll('option'))
      .map((o) => o.value)
      .filter(Boolean);
    expect(offered).toEqual(['next']);
  });

  it('says there is no active epic rather than showing an empty block when every epic is finished', async () => {
    renderWithEpics([epic('done', 'Done epic', { groupStatus: 'done' })], []);

    expect(await screen.findByText('No active epics')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('No epics yet')).toBeNull();
  });

  it('still says there are no epics yet on a board without any', async () => {
    renderWithEpics([], []);

    expect(await screen.findByText('No epics yet')).toBeTruthy();
    expect(screen.queryByText('No active epics')).toBeNull();
  });
});

function epic(id: string, name: string, overrides: Partial<TicketGroup> = {}): TicketGroup {
  return {
    id,
    boardIds: ['b1'],
    name,
    emoji: '📌',
    color: 'blue',
    description: '',
    timeframe: 'now',
    groupStatus: 'active',
    blocked: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
