import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorktreeActionsView } from '@fleex/shared';
import { useWorktreeActionsStore } from './worktreeActionsStore';
import * as api from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  fetchWorktreeActions: vi.fn(),
  setWorktreeItemPinned: vi.fn(),
}));

const ROOT = '/base/workspaces/t';
const PATH = `${ROOT}/fleex`;

function view(pinned: boolean, state: 'stopped' | 'running' = 'stopped', updatedAt = '2026-10-04T10:00:00Z'): WorktreeActionsView {
  return {
    path: PATH,
    repo: 'o/fleex',
    branch: 'main',
    start: null,
    clickByState: {},
    items: [{ id: 'npm:lint', label: 'lint', command: 'pnpm run lint', mode: 'terminal', source: 'npm', layer: 'detected', pinned }],
    server: { path: PATH, state, updatedAt },
  } as unknown as WorktreeActionsView;
}

const pinnedNow = () => useWorktreeActionsStore.getState().byRoot[ROOT]![0]!.items[0]!.pinned;

describe('worktreeActionsStore', () => {
  beforeEach(() => useWorktreeActionsStore.setState({ byRoot: {}, servers: {}, setups: {} }));
  afterEach(() => vi.clearAllMocks());

  it('a menu load that comes back after a ★ click does not undo the pin', async () => {
    // WHY: opening the menu fires a load; clicking ★ right away and getting the
    // pre-pin snapshot back last used to revert the star on screen.
    vi.mocked(api.fetchWorktreeActions).mockResolvedValueOnce({ worktrees: [view(false)] });
    await useWorktreeActionsStore.getState().load(ROOT);

    let releaseLoad: (v: { worktrees: WorktreeActionsView[] }) => void = () => {};
    vi.mocked(api.fetchWorktreeActions).mockImplementationOnce(() => new Promise((r) => { releaseLoad = r; }));
    const loading = useWorktreeActionsStore.getState().load(ROOT);
    vi.mocked(api.setWorktreeItemPinned).mockResolvedValueOnce(view(true));
    await useWorktreeActionsStore.getState().setPinned(ROOT, view(false), 'npm:lint', true);
    releaseLoad({ worktrees: [view(false)] });
    await loading;

    expect(pinnedNow()).toBe(true);
  });

  it('reloadAll re-fetches every workspace shown, so a state missed while disconnected is caught up', async () => {
    vi.mocked(api.fetchWorktreeActions).mockResolvedValueOnce({ worktrees: [view(false)] });
    await useWorktreeActionsStore.getState().load(ROOT);
    vi.mocked(api.fetchWorktreeActions).mockResolvedValueOnce({ worktrees: [view(false, 'running', '2026-10-04T11:00:00Z')] });
    await useWorktreeActionsStore.getState().reloadAll();
    expect(api.fetchWorktreeActions).toHaveBeenLastCalledWith(ROOT);
    expect(useWorktreeActionsStore.getState().servers[PATH]?.state).toBe('running');
  });
});
