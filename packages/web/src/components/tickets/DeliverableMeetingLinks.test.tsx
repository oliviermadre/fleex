import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_AGENDA_PREFS, type AgendaExternalLink, type TicketDeliverable } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  fetchAgendaExternalLinks: vi.fn(),
  fetchAgenda: vi.fn(),
  saveAgendaPrefs: vi.fn(),
}));

import * as api from '../../services/api';
import { DeliverableReadingOverlay } from './DeliverableReadingOverlay';
import { useUIStore } from '../../stores/uiStore';
import { useAgendaStore } from '../../stores/agendaStore';

const START = new Date(2026, 9, 20, 14, 0).toISOString();
const link: AgendaExternalLink = {
  id: 'l1', provider: 'google', eventKey: 'k', deliverableId: 'd1', deliverableTitle: 'Notes', eventTitle: 'Sprint review',
  eventStart: START, source: 'manual', createdAt: START,
};
const deliverable = { id: 'd1', ticketId: 't1', agentName: 'a', type: 'report', title: 'Notes', content: '# hi', version: 1,
  status: 'final', mentionId: null, createdAt: START, updatedAt: START } as TicketDeliverable;

function renderOverlay() {
  return render(
    <MemoryRouter initialEntries={['/work/t1']}>
      <Routes>
        <Route path="/work/:id" element={<DeliverableReadingOverlay />} />
        <Route path="/agenda" element={<div>agenda page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.fetchAgenda).mockResolvedValue({ from: '', to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} });
  useAgendaStore.setState({ prefs: DEFAULT_AGENDA_PREFS, prefsLoaded: true, prefsFromServer: false });
  useUIStore.setState({ deliverableOverlay: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeliverableReadingOverlay · Meeting line', () => {
  it('shows one line per attached meeting and opens that day in the agenda, Day view', async () => {
    vi.mocked(api.fetchAgendaExternalLinks).mockResolvedValue([link]);
    renderOverlay();
    act(() => useUIStore.getState().openDeliverableOverlay(deliverable));
    const line = await screen.findByRole('button', { name: /Meeting: Sprint review/ });
    expect(api.fetchAgendaExternalLinks).toHaveBeenCalledWith({ deliverableId: 'd1' });
    fireEvent.click(line);
    await waitFor(() => expect(screen.getByText('agenda page')).toBeTruthy());
    expect(useUIStore.getState().deliverableOverlay).toBeNull();
    const s = useAgendaStore.getState();
    expect(s.prefs.view).toBe('day');
    expect(s.anchor.getDate()).toBe(20);
    expect(s.anchor.getMonth()).toBe(9);
  });

  it('shows nothing when the links cannot be read (501, older server)', async () => {
    vi.mocked(api.fetchAgendaExternalLinks).mockRejectedValue(new Error('501'));
    renderOverlay();
    act(() => useUIStore.getState().openDeliverableOverlay(deliverable));
    await waitFor(() => expect(api.fetchAgendaExternalLinks).toHaveBeenCalled());
    expect(screen.queryByTestId('deliverable-meetings')).toBeNull();
    expect(document.querySelector('.deliverable-overlay-panel')).toBeTruthy();
  });
});
