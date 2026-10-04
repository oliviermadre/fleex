import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Ticket, WorktreeActionsView } from '@fleex/shared';
import * as api from '../../services/api';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorktreeActionsStore } from '../../stores/worktreeActionsStore';
import { WorktreeActionsGroup } from './WorktreeActionsGroup';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchWorktreeActions: vi.fn(),
}));

const ticket = { id: 'abcdef12-0000-0000-0000-000000000000', displayId: 7, title: 'repo actions', links: [] } as unknown as Ticket;

function view(name: string): WorktreeActionsView {
  const path = `/base/workspaces/x/${name}`;
  return {
    path, repo: `o/${name}`, branch: 'main', items: [], start: null,
    clickByState: { stopped: 'start', starting: 'logs', running: 'open', error: 'logs' },
    server: { path, state: 'stopped', updatedAt: '' },
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useWorktreeActionsStore.setState({ byRoot: {}, servers: {}, setups: {} });
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, basePath: '/base' } }));
});
afterEach(cleanup);

describe('WorktreeActionsGroup', () => {
  it('shows 4 worktrees and puts the rest behind +N; a pick joins the bar with its menu open', async () => {
    // WHY (PRD §8.1): a ticket over many repos must not push the top bar off screen.
    const root = buildWorkspaceContext(ticket, '/base').workspace_path;
    vi.mocked(api.fetchWorktreeActions).mockImplementation(async (path) => {
      expect(path).toBe(root);
      return { worktrees: ['a', 'b', 'c', 'd', 'e', 'f'].map(view) };
    });
    render(<MemoryRouter><WorktreeActionsGroup ticket={ticket} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('worktree-action-button')).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: '2 autres worktrees' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^f/ }));
    expect(screen.getAllByTestId('worktree-action-button')).toHaveLength(5);
    expect(screen.getByTestId('worktree-action-menu')).toBeTruthy();
  });

  it('renders nothing while the ticket has no worktree', async () => {
    vi.mocked(api.fetchWorktreeActions).mockResolvedValue({ worktrees: [] });
    const { container } = render(<MemoryRouter><WorktreeActionsGroup ticket={ticket} /></MemoryRouter>);
    await waitFor(() => expect(api.fetchWorktreeActions).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
