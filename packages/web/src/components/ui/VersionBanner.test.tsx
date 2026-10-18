import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

const dismiss = vi.fn();
let state = { versionInfo: { behindBy: 12, isWorktree: true } as never, showBanner: true, dismiss };
vi.mock('../../hooks/useVersionCheck', () => ({ useVersionCheck: () => state }));

import { VersionBanner } from './VersionBanner';
import { resetToasts, useToastStore } from '../../stores/toastStore';

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  resetToasts();
  dismiss.mockReset();
  state = { versionInfo: { behindBy: 12, isWorktree: true } as never, showBanner: true, dismiss };
});

describe('VersionBanner', () => {
  it('is a persistent toast, not a surface of its own', () => {
    const { container } = render(<VersionBanner />);
    expect(container.innerHTML).toBe('');
    expect(toasts()[0]).toMatchObject({
      id: 'version-behind',
      title: 'Fleex is 12 commits behind origin/main',
      detail: 'Worktree: self-update only affects ~/.fleex/repo',
      durationMs: null,
    });
  });

  it('remembers the dismissal only when the user closes it — an eviction is not a "no thanks"', () => {
    render(<VersionBanner />);
    act(() => useToastStore.getState().dismiss('version-behind', 'programmatic'));
    expect(dismiss).not.toHaveBeenCalled();
    render(<VersionBanner />);
    act(() => useToastStore.getState().dismiss('version-behind', 'close'));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
