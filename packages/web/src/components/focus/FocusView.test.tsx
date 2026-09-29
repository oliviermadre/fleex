import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FocusItem, Ticket, BoardWithCounts } from '@fleex/shared';

vi.mock('../../services/api', async (orig) => ({
  ...(await orig<typeof import('../../services/api')>()),
  fetchFocus: vi.fn(),
  resolveWorkflowGate: vi.fn().mockResolvedValue(undefined),
  postTicketComment: vi.fn().mockResolvedValue(undefined),
  fetchTicketDeliverables: vi.fn().mockResolvedValue([]),
  fetchSeenDeliverables: vi.fn().mockResolvedValue([]),
  fetchPersonas: vi.fn().mockResolvedValue([]),
  fetchPanels: vi.fn().mockResolvedValue([]),
  fetchSkills: vi.fn().mockResolvedValue([]),
}));

import * as api from '../../services/api';
import { useTicketStore } from '../../stores/ticketStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useFocusStore, UNDO_MS } from '../../stores/focusStore';
import { useWorkStore } from '../../stores/workStore';
import { useUIStore } from '../../stores/uiStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { FocusView } from './FocusView';

beforeAll(() => {
  class Obs { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', Obs);
  vi.stubGlobal('IntersectionObserver', Obs);
  Element.prototype.scrollIntoView = vi.fn();
});

function ticket(id: string, displayId: number, title: string): Ticket {
  return {
    id, boardId: 'b1', displayId, title, description: '', status: 'doing', priority: 'high', type: null, position: 0,
    tags: [], links: [], blocked: false, favorite: false, dueDate: null, assignee: null, agentClaimedAt: null,
    githubMetadata: null, archivedAt: null, firstDoingAt: null, statusChangedAt: '2026-09-28T08:00:00Z',
    conversationMode: 'talk', modelOverride: null, effortOverride: null, fastMode: false,
    createdAt: '2026-09-28T08:00:00Z', updatedAt: '2026-09-28T08:00:00Z',
  } as Ticket;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const GATE: FocusItem = {
  key: 'gate:s1', kind: 'gate', ticketId: 't1', since: minutesAgo(42),
  workflow: { runId: 'r1', name: 'Feature', emoji: '🚀', steps: [
    { id: 'plan', name: 'Plan', state: 'done', isGate: false },
    { id: 'gate', name: 'Validate plan', state: 'current', isGate: true },
  ] },
  gate: { runId: 'r1', stepRunId: 's1', stepName: 'Validate plan', mode: 'outcome', context: 'Plan in 4 steps', options: [
    { value: 'approve', label: 'approve', targetStepName: 'Build' },
    { value: 'rework', label: 'rework', targetStepName: 'Plan' },
  ] },
  question: null, error: null, idle: null, lastAgentComment: null, costUsd: 1.84,
};
const QUESTION: FocusItem = {
  key: 'question:m1', kind: 'question', ticketId: 't2', since: minutesAgo(300),
  workflow: null, gate: null, error: null, idle: null, costUsd: 0,
  question: { source: 'mention', mentionId: 'm1', runId: null, stepRunId: null, askedBy: 'Dev', text: 'Global or per board?' },
  lastAgentComment: { authorName: 'Dev', body: 'Global or per board?', createdAt: minutesAgo(300) },
};

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/focus']}>
      <Routes>
        <Route path="/focus" element={<FocusView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useWorkflowTemplateStore.setState({ templates: [], refresh: vi.fn().mockResolvedValue(undefined) });
  useUnreadStore.setState({ loadSeenDeliverables: vi.fn().mockResolvedValue(undefined) } as never);
  useTicketStore.setState({
    tickets: [ticket('t1', 1284, 'Refonte du flux New task'), ticket('t2', 1291, 'Timeout configurable')],
    boards: [{ id: 'b1', name: 'Fleex', emoji: '⚡', createdAt: '', updatedAt: '', ticketCounts: {} } as BoardWithCounts],
  });
  vi.mocked(api.fetchFocus).mockResolvedValue({ items: [GATE, QUESTION], running: [] });
  useFocusStore.setState({
    items: [GATE, QUESTION], running: [], loaded: true, pending: {}, settled: {}, snoozed: {},
    log: [], clearedAt: [], prefs: { zen: false, chain: true, showIdle: true, showRunning: false },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FocusView', () => {
  it('sums up the tickets in flight under the queue, collapsed until clicked', () => {
    useFocusStore.setState({
      items: [QUESTION],
      running: [{ ticketId: 't1', source: 'agent', label: 'Dev', since: null, executionId: 'x1', workflow: null, costUsd: 0 }],
    });
    renderView();
    const toggle = screen.getByRole('button', { name: /1 ticket.*avance en autonomie/ });
    expect(screen.queryByText('Dev travaille dessus')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Dev travaille dessus')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Suivre les logs' })).toBeTruthy();
    expect(useFocusStore.getState().prefs.showRunning).toBe(true);
  });

  it('lists the waiting tickets oldest first, with their direct actions', () => {
    renderView();
    expect(screen.getByText('2 en attente')).toBeTruthy();
    const rows = document.querySelectorAll('[data-focus-key]');
    expect([...rows].map((r) => r.getAttribute('data-focus-key'))).toEqual(['question:m1', 'gate:s1']);
    const gateRow = rows[1] as HTMLElement;
    expect(within(gateRow).getByRole('button', { name: /approve/ })).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByPlaceholderText('Répondre à @Dev…')).toBeTruthy();
  });

  it('a direct action hides the row, offers Annuler, and resolves the gate after the undo window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView();
    const gateRow = document.querySelector('[data-focus-key="gate:s1"]') as HTMLElement;
    fireEvent.click(within(gateRow).getByRole('button', { name: /approve/ }));
    expect(document.querySelector('[data-focus-key="gate:s1"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy();
    expect(api.resolveWorkflowGate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS); });
    expect(api.resolveWorkflowGate).toHaveBeenCalledWith('r1', 's1', { outcome: 'approve', notes: undefined });
  });

  it('answers a question from the row with Enter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView();
    const input = screen.getByPlaceholderText('Répondre à @Dev…');
    fireEvent.change(input, { target: { value: 'Global' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS); });
    expect(api.postTicketComment).toHaveBeenCalledWith('t2', 'Global');
  });

  it('opens the detail popup on click and sends "Ouvrir dans Tasks" to the Tasks view', () => {
    renderView();
    fireEvent.click(screen.getByText('Refonte du flux New task'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Ce qui t’attend · Validate plan/)).toBeTruthy();
    expect(within(dialog).getByText('→ Build')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Ouvrir dans Tasks/ }));
    expect(useWorkStore.getState().selectedTicketId).toBe('t1');
    // The Tasks view (RouterSync turns this into /work/t1), and t1 is revealed in
    // its queue even when the queue filters would hide it.
    expect(useUIStore.getState().activePanel).toBe('work');
    expect(useWorkStore.getState().revealTicketId).toBe('t1');
  });

  it('shows the empty state when nothing waits', () => {
    useFocusStore.setState({ items: [] });
    renderView();
    expect(screen.getByText('Rien n’attend ton intervention')).toBeTruthy();
    expect(screen.getByText('liste vide')).toBeTruthy();
  });
});
