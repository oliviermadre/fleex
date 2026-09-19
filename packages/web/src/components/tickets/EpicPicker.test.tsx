import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { TicketGroup } from '@fleex/shared';
import { EpicPicker } from './EpicPicker';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';

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

function epic(id: string, name: string): TicketGroup {
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
  };
}
