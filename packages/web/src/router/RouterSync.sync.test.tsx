import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { RouterSync } from './RouterSync';
import { useTicketStore } from '../stores/ticketStore';
import { useTicketGroupStore } from '../stores/ticketGroupStore';
import { useUIStore } from '../stores/uiStore';

/**
 * These tests pin the *intent* of the history fix: the default detail tab
 * ('description') is omitted from the URL, so navigating Back onto the tab-less
 * ticket/epic URL must return the store to the description tab. A test that
 * could still pass while the store kept the previous tab (comments/deliverables)
 * would defeat the purpose — the "description" history entry would look like
 * "rien ne se passe" and get visually skipped, which is exactly the reported bug.
 */

// Capture the router's navigate so a test can drive Back/Forward-style URL changes.
let navigate: (to: string) => void = () => {};
function NavCapture() {
  navigate = useNavigate();
  return null;
}

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RouterSync />
      <NavCapture />
    </MemoryRouter>,
  );
}

describe('RouterSync URL→Store detail-tab sync', () => {
  beforeEach(() => {
    useTicketStore.setState({ selectedBoardId: null, selectedTicketId: null, ticketTab: 'description' });
    useTicketGroupStore.setState({ selectedEpicDetailId: null, epicDetailTab: 'description' });
    useUIStore.setState({ activePanel: 'dashboard' });
  });
  afterEach(() => cleanup());

  it('restores the description tab when navigating back to the tab-less ticket URL', () => {
    renderAt('/tickets/board/all/ticket/t1/comments');
    expect(useTicketStore.getState().ticketTab).toBe('comments');

    // Back onto the tab-less URL (the "description" entry) must return to
    // 'description', not silently keep 'comments'.
    act(() => navigate('/tickets/board/all/ticket/t1'));
    expect(useTicketStore.getState().ticketTab).toBe('description');
  });

  it('restores the description tab when navigating back to the tab-less epic URL', () => {
    renderAt('/tickets/board/all/epic/e1/deliverables');
    expect(useTicketGroupStore.getState().epicDetailTab).toBe('deliverables');

    act(() => navigate('/tickets/board/all/epic/e1'));
    expect(useTicketGroupStore.getState().epicDetailTab).toBe('description');
  });
});
