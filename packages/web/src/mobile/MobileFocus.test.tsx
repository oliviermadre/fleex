import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import type { FocusItem, Ticket, BoardWithCounts } from '@fleex/shared';

vi.mock('../services/api', async (orig) => ({
  ...(await orig<typeof import('../services/api')>()),
  fetchFocus: vi.fn(),
  resolveWorkflowGate: vi.fn().mockResolvedValue(undefined),
  postTicketComment: vi.fn().mockResolvedValue(undefined),
}));

import * as api from '../services/api';
import { useTicketStore } from '../stores/ticketStore';
import { useFocusStore, UNDO_MS } from '../stores/focusStore';
import { useMobileNavStore } from './mobileNavStore';
import { MobileFocus } from './MobileFocus';

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
  workflow: { runId: 'r1', name: 'Feature', emoji: '🚀', steps: [] },
  gate: { runId: 'r1', stepRunId: 's1', stepName: 'Validate plan', mode: 'outcome', context: 'Plan in 4 steps', options: [
    { value: 'approve', label: 'approve', targetStepName: 'Build' },
    { value: 'rework', label: 'rework', targetStepName: 'Plan' },
  ] },
  question: null, error: null, idle: null, lastAgentComment: null, costUsd: 0,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.resolveWorkflowGate).mockClear();
  useMobileNavStore.setState({ requestedDetailTab: null });
  useTicketStore.setState({
    tickets: [ticket('t1', 1284, 'Refonte du flux New task')],
    boards: [{ id: 'b1', name: 'Fleex', emoji: '⚡', createdAt: '', updatedAt: '', ticketCounts: {} } as BoardWithCounts],
    selectedTicketId: null,
  });
  vi.mocked(api.fetchFocus).mockResolvedValue({ items: [GATE], running: [] });
  useFocusStore.setState({
    items: [GATE], running: [], loaded: true, pending: {}, settled: {}, snoozed: {},
    log: [], clearedAt: [], prefs: { zen: false, chain: true, showIdle: true, showRunning: false, detailTab: 'thread' },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MobileFocus', () => {
  it('opens a gate card on the Workflow tab — one tap, not a hunt through tabs', () => {
    render(<MobileFocus />);
    fireEvent.click(screen.getByText('Refonte du flux New task'));
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
    expect(useMobileNavStore.getState().requestedDetailTab).toBe('workflow');
  });

  it('holds a gate decision for the undo window, then sends it', async () => {
    vi.useFakeTimers();
    render(<MobileFocus />);
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    expect(api.resolveWorkflowGate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
    });
    expect(api.resolveWorkflowGate).toHaveBeenCalledWith('r1', 's1', { outcome: 'approve', notes: undefined });
  });

  it('cancels the decision when the user undoes it', async () => {
    vi.useFakeTimers();
    render(<MobileFocus />);
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
    });
    expect(api.resolveWorkflowGate).not.toHaveBeenCalled();
  });

  it('snoozes by item key and says how many are paused', () => {
    render(<MobileFocus />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(useFocusStore.getState().snoozed['gate:s1']).toBeGreaterThan(Date.now());
    expect(screen.getByText(/1 en pause/)).toBeTruthy();
  });
});
