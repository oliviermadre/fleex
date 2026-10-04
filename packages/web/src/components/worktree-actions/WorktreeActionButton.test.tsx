import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { WorktreeActionItem, WorktreeActionsView } from '@fleex/shared';
import * as api from '../../services/api';
import { useWorktreeActionsStore } from '../../stores/worktreeActionsStore';
import { WorktreeActionButton } from './WorktreeActionButton';
import { worktreeLabels } from './WorktreeActionsGroup';
import { resolveLeftClick } from './worktreeUi';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchWorktreeActions: vi.fn(async () => ({ worktrees: [] })),
  runWorktreeAction: vi.fn(async (req: { path: string }) => ({ server: { path: req.path, state: 'starting', updatedAt: '2026-10-04T10:00:01Z' } })),
  runWorktreeHook: vi.fn(async (path: string) => ({ runId: 'h1', server: { path, state: 'stopped', updatedAt: '' }, setup: { path, state: 'running', startedAt: '2026-10-04T10:00:00Z', runId: 'h1' } })),
  openWorktreeHooksDir: vi.fn(async () => ({ dir: '/base/overlays/oliviermadre/fleex/hooks' })),
  setWorktreeItemPinned: vi.fn(),
}));

const PATH = '/base/workspaces/775c62/fleex';
const item = (id: string, source: WorktreeActionItem['source'], extra: Partial<WorktreeActionItem> = {}): WorktreeActionItem => ({
  id, source, layer: source === 'action' ? 'personal' : source === 'launch' ? 'launch' : 'detected', label: id.split(':').pop()!, command: `run ${id}`, mode: 'terminal', pinned: false, ...extra,
});

function view(over: Partial<WorktreeActionsView> = {}): WorktreeActionsView {
  return {
    path: PATH,
    repo: 'oliviermadre/fleex',
    branch: 'ticket/775c62-repo-actions',
    items: [
      item('launch:web', 'launch', { port: 5173 }),
      item('npm:dev', 'npm', { pinned: true }),
      item('npm:test', 'npm'),
      item('npm:lint', 'npm', { command: 'pnpm run lint' }),
      item('make:up', 'make'),
      item('composer:serve', 'composer'),
      item('migrate', 'action', { mode: 'background' }),
    ],
    start: { id: 'launch:web', command: 'pnpm dev', label: 'web' },
    clickByState: { stopped: 'start', starting: 'logs', running: 'open', error: 'logs' },
    server: { path: PATH, state: 'stopped', updatedAt: '2026-10-04T10:00:00Z' },
    ...over,
  };
}

function Where() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}{loc.search}</div>;
}

function renderButton(v = view()) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<><WorktreeActionButton view={v} root="/base/workspaces/775c62" ticketId="T1" label="fleex" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const menu = () => screen.getByTestId('worktree-action-menu');
/** Each row's label (its first truncated span — the glyph and command are siblings). */
const rowLabels = () => within(menu()).getAllByRole('menuitem').map((r) => r.querySelector('span.truncate')?.textContent ?? '');

beforeEach(() => {
  // jsdom has no layout: keyboard navigation scrolls the highlighted row into view.
  Element.prototype.scrollIntoView = vi.fn();
  useWorktreeActionsStore.setState({ byRoot: {}, servers: {}, setups: {} });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('WorktreeActionButton', () => {
  it('left part runs what the state calls for: Start when stopped', async () => {
    // WHY (acceptance 5): one click starts a stopped server — no menu to dig through.
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'fleex — stopped' }));
    });
    expect(api.runWorktreeAction).toHaveBeenCalledWith({ path: PATH, verb: 'start' });
    expect(useWorktreeActionsStore.getState().servers[PATH]?.state).toBe('starting');
  });

  it('shows the port once running, and opens the URL instead of starting again', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderButton(view({ server: { path: PATH, state: 'running', port: 5173, url: 'http://localhost:5173', updatedAt: 'x' } }));
    expect(screen.getByText(':5173')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'fleex — running' }));
    expect(open).toHaveBeenCalledWith('http://localhost:5173', '_blank');
    expect(api.runWorktreeAction).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('opens the menu from ▾ with a plain click or tap, and from a right click — no right click needed', () => {
    // WHY (acceptance 12): on a phone or a trackpad there is no right click.
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    expect(menu()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    expect(screen.queryByTestId('worktree-action-menu')).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('worktree-action-button'));
    expect(menu()).toBeTruthy();
  });

  it('opens the menu on a long press, and the release does not also start the server', () => {
    vi.useFakeTimers();
    try {
      renderButton();
      const left = screen.getByRole('button', { name: 'fleex — stopped' });
      fireEvent.touchStart(left);
      act(() => { vi.advanceTimersByTime(600); });
      fireEvent.touchEnd(left);
      fireEvent.click(left);
      expect(menu()).toBeTruthy();
      expect(api.runWorktreeAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a start command, the left click goes to Réglages › Actions et Hooks; the menu says why', () => {
    // WHY (PRD §6): the fix for "nothing to start" is one click away, where the start is configured.
    renderButton(view({ start: null }));
    fireEvent.click(screen.getByRole('button', { name: 'fleex — not configured' }));
    expect(screen.getByTestId('location').textContent).toBe('/repositories/oliviermadre/fleex?tab=config');
    expect(api.runWorktreeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    expect(within(menu()).getByText(/Start non configuré/)).toBeTruthy();
  });

  it('Système offers Relancer le Setup and the hooks folder; a failed setup shows in the header with its logs', async () => {
    useWorktreeActionsStore.setState({ setups: { [PATH]: { path: PATH, state: 'failed', startedAt: 'x', runId: 'h0', error: 'npm ERR! missing script' } } });
    renderButton();
    expect(screen.getByTitle(/Le Setup a échoué/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    expect(within(screen.getByTestId('setup-state')).getByText(/setup échoué/)).toBeTruthy();
    expect(within(screen.getByTestId('setup-state')).getByText(/missing script/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(menu()).getByText('Relancer le Setup'));
    });
    expect(api.runWorktreeHook).toHaveBeenCalledWith(PATH, 'setup');
    expect(useWorktreeActionsStore.getState().setups[PATH]?.state).toBe('running');
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    await act(async () => {
      fireEvent.click(within(menu()).getByText('Ouvrir le dossier des hooks'));
    });
    expect(api.openWorktreeHooksDir).toHaveBeenCalledWith('oliviermadre/fleex');
  });
});

describe('WorktreeActionMenu', () => {
  it('lists pinned commands first, once, then every source group, then Système', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    const headers = ['★ Épinglées', 'Actions du repo', 'launch.json', 'package.json', 'Makefile', 'composer.json', 'Système'];
    for (const h of headers) expect(within(menu()).getByText(h, { selector: 'div' })).toBeTruthy();
    // npm:dev is pinned: shown in ★ only, not again under package.json.
    expect(rowLabels().filter((t) => t === 'dev').length).toBe(1);
  });

  it('search keeps only rows whose label or command matches; a source filter keeps one group', () => {
    // WHY (acceptance 3): a repo with dozens of scripts must stay usable.
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    fireEvent.change(within(menu()).getByLabelText('Filter commands'), { target: { value: 'pnpm run lint' } });
    expect(rowLabels()).toEqual(['lint']);
    fireEvent.change(within(menu()).getByLabelText('Filter commands'), { target: { value: '' } });
    fireEvent.click(within(menu()).getByRole('button', { name: /^make/ }));
    expect(rowLabels()).toEqual(['up']);
  });

  it('★ pins a command (personal) without running it', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    fireEvent.click(within(menu()).getByRole('button', { name: 'Pin test' }));
    expect(api.setWorktreeItemPinned).toHaveBeenCalledWith(PATH, 'npm:test', true);
    expect(api.runWorktreeAction).not.toHaveBeenCalled();
  });

  it('runs the highlighted command with ↓ then ⏎', async () => {
    renderButton(view({ items: [item('make:up', 'make', { mode: 'background' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    const input = within(menu()).getByLabelText('Filter commands');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(api.runWorktreeAction).toHaveBeenCalledWith({ path: PATH, id: 'make:up' });
  });

  it('greys out the verbs the state does not allow', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'fleex menu' }));
    const bar = within(menu()).getByRole('toolbar');
    expect((within(bar).getByText('■ Stop') as HTMLButtonElement).disabled).toBe(true);
    expect((within(bar).getByText('↗ Open') as HTMLButtonElement).disabled).toBe(true);
    expect((within(bar).getByText('▶ Start') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('labels and left click', () => {
  it('tells two worktrees of the same repo apart by branch', () => {
    const a = view({ path: '/w/fleex', branch: 'ticket/775c62-repo-actions' });
    const b = view({ path: '/w/fleex-spike', branch: 'spike' });
    const c = view({ path: '/w/second', repo: 'o/secondrepo' });
    expect(worktreeLabels([a, b, c])).toEqual(['fleex·775c62-repo-a…', 'fleex·spike', 'secondrepo']);
  });

  it('follows clickByState: a rule id runs that item, menu opens the menu', () => {
    const v = view({ clickByState: { stopped: 'npm:test', starting: 'menu', running: 'open', error: 'logs' } });
    expect(resolveLeftClick(v, 'stopped')).toMatchObject({ kind: 'item', item: { id: 'npm:test' } });
    expect(resolveLeftClick(v, 'starting').kind).toBe('menu');
    expect(resolveLeftClick(v, 'error')).toMatchObject({ kind: 'verb', verb: 'logs' });
  });
});
