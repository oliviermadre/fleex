import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import type { FocusItem, Ticket, BoardWithCounts } from '@fleex/shared';

vi.mock('../services/api', async (orig) => ({
  ...(await orig<typeof import('../services/api')>()),
  fetchFocus: vi.fn(),
  resolveWorkflowGate: vi.fn().mockResolvedValue(undefined),
  postTicketComment: vi.fn().mockResolvedValue(undefined),
  updateTicketExecutionConfig: vi.fn().mockResolvedValue(undefined),
  fetchPanels: vi.fn().mockResolvedValue([]),
  fetchSkills: vi.fn().mockResolvedValue([]),
}));

// The thread (live conversation stream) is out of scope here.
vi.mock('../components/focus/FocusThread', () => ({ FocusThread: () => null }));

import * as api from '../services/api';
import { useTicketStore } from '../stores/ticketStore';
import { useFocusStore, UNDO_MS } from '../stores/focusStore';
import { useMobileNavStore } from './mobileNavStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
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

const ERROR: FocusItem = {
  key: 'error:e1', kind: 'error', ticketId: 't2', since: minutesAgo(10), workflow: null, gate: null, question: null,
  error: { source: 'step', label: 'Build', message: 'boom', runId: 'r2', stepRunId: 's2', executionId: null },
  idle: null, lastAgentComment: null, costUsd: 0,
} as FocusItem;

/** A horizontal drag on an element, from x=200 to x=200+dx. */
function swipe(el: Element, dx: number) {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 200 + dx / 2, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 200 + dx, clientY: 100 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 100 }] });
}

describe('MobileFocus', () => {
  it('lists items as compact rows — no action buttons until one is opened', () => {
    render(<MobileFocus />);
    expect(screen.getByText('Refonte du flux New task')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'approve' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the sheet on a tap, not the ticket', () => {
    render(<MobileFocus />);
    fireEvent.click(screen.getByText('Refonte du flux New task'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'approve' })).toBeTruthy();
    expect(useTicketStore.getState().selectedTicketId).toBeNull();
  });

  it('opens the ticket on its Workflow tab from the sheet', () => {
    render(<MobileFocus />);
    fireEvent.click(screen.getByText('Refonte du flux New task'));
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir le ticket/ }));
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
    expect(useMobileNavStore.getState().requestedDetailTab).toBe('workflow');
  });

  it('holds a gate decision for the undo window, then sends it', async () => {
    vi.useFakeTimers();
    render(<MobileFocus />);
    fireEvent.click(screen.getByText('Refonte du flux New task'));
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
    fireEvent.click(screen.getByText('Refonte du flux New task'));
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
    });
    expect(api.resolveWorkflowGate).not.toHaveBeenCalled();
  });

  it('swiping left uncovers "1 h"; snoozing takes a tap on it', () => {
    render(<MobileFocus />);
    swipe(screen.getByText('Refonte du flux New task'), -120);
    expect(useFocusStore.getState().snoozed['gate:s1']).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard : 1 h' }));
    const until = useFocusStore.getState().snoozed['gate:s1']!;
    expect(until - Date.now()).toBeGreaterThan(3500_000);
    expect(until - Date.now()).toBeLessThanOrEqual(3600_000);
    expect(screen.getByText(/1 en pause/)).toBeTruthy();
  });

  it('swiping right uncovers "Demain 9 h"', () => {
    render(<MobileFocus />);
    swipe(screen.getByText('Refonte du flux New task'), 120);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard : Demain 9 h' }));
    const until = new Date(useFocusStore.getState().snoozed['gate:s1']!);
    expect(until.getHours()).toBe(9);
    expect(until.getDate()).toBe(new Date(Date.now() + 86400_000).getDate());
  });

  it('the click ending a swipe does not open the sheet', () => {
    render(<MobileFocus />);
    const row = screen.getByText('Refonte du flux New task');
    swipe(row, -120);
    fireEvent.click(row);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('with two items', () => {
    beforeEach(() => {
      useTicketStore.setState({
        tickets: [ticket('t1', 1284, 'Refonte du flux New task'), ticket('t2', 1300, 'Fix login')],
      });
      useFocusStore.setState({ items: [GATE, ERROR] });
    });

    const front = () => document.querySelector('[data-focus-sheet-page]:not([aria-hidden="true"])');

    it('a sideways swipe in the sheet moves to the next item', () => {
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      expect(front()?.getAttribute('data-focus-sheet-page')).toBe('gate:s1');
      swipe(screen.getByRole('dialog'), -200);
      expect(front()?.getAttribute('data-focus-sheet-page')).toBe('error:e1');
      swipe(screen.getByRole('dialog'), 200);
      expect(front()?.getAttribute('data-focus-sheet-page')).toBe('gate:s1');
    });

    it('acting on an item slides the next one in', () => {
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      fireEvent.click(screen.getByRole('button', { name: 'approve' }));
      expect(front()?.getAttribute('data-focus-sheet-page')).toBe('error:e1');
    });
  });

  describe('commenting an idle ticket', () => {
    const IDLE: FocusItem = {
      key: 'idle:t1', kind: 'idle', ticketId: 't1', since: minutesAgo(90), workflow: null, gate: null, question: null,
      error: null, idle: { lastActivityAt: minutesAgo(90) }, lastAgentComment: null, costUsd: 0,
    } as FocusItem;

    beforeEach(() => {
      useFocusStore.setState({ items: [IDLE] });
      useAgentPersonaStore.setState({
        personas: [{ id: 'p1', name: 'builder', displayName: 'The Builder' }] as never,
        loaded: true,
      });
    });

    it('offers Commenter first; the composer opens once it is picked', () => {
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      expect(screen.queryByPlaceholderText(/Ton commentaire/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Commenter' }));
      expect(screen.getByPlaceholderText(/Ton commentaire/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Envoyer le commentaire' })).toBeTruthy();
    });

    it('opens the composer right away on a ticket that has a draft', () => {
      localStorage.setItem('comment_draft_t1', 'déjà commencé');
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      expect((screen.getByPlaceholderText(/Ton commentaire/) as HTMLTextAreaElement).value).toBe('déjà commencé');
    });

    it('sends the comment through the undo window and clears the draft', async () => {
      vi.useFakeTimers();
      localStorage.setItem('comment_draft_t1', 'relance stp');
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      fireEvent.click(screen.getByRole('button', { name: 'Envoyer le commentaire' }));
      expect(localStorage.getItem('comment_draft_t1') ?? '').toBe('');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
      });
      expect(api.postTicketComment).toHaveBeenCalledWith('t1', 'relance stp');
    });

    it('has the conversation composer: mode, config, @ mentions', () => {
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      fireEvent.click(screen.getByRole('button', { name: 'Commenter' }));
      expect(screen.getByRole('button', { name: /Plan/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Config d'exécution/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Joindre/ })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /Mentionner/ }));
      fireEvent.mouseDown(screen.getByText('The Builder'));
      expect((screen.getByPlaceholderText(/Ton commentaire/) as HTMLTextAreaElement).value).toBe('@agent:builder ');
    });

    it('switches the conversation mode of the ticket', () => {
      render(<MobileFocus />);
      fireEvent.click(screen.getByText('Refonte du flux New task'));
      fireEvent.click(screen.getByRole('button', { name: 'Commenter' }));
      fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
      expect(api.updateTicketExecutionConfig).toHaveBeenCalledWith('t1', { conversationMode: 'plan' });
    });
  });
});
