import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import type { PrCiDetail, PrCiSummary } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchPRCiSummaries: vi.fn(),
  fetchPRCiDetail: vi.fn(),
  mergePR: vi.fn(),
}));
vi.mock('../../services/api', () => api);

import { PrBadge } from './PrBadge';
import { resetPrCiStore, usePrCiStore } from '../../stores/prCiStore';

const REF = 'acme/app#39';
const SHA = 'f'.repeat(40);

function summary(patch: Partial<PrCiSummary> = {}): PrCiSummary {
  return { ref: REF, state: 'OPEN', isDraft: false, ciStatus: 'failed', counts: { pass: 3, fail: 1 }, ...patch };
}

function detail(patch: Partial<PrCiDetail> = {}): PrCiDetail {
  return {
    ...summary(),
    url: 'https://github.com/acme/app/pull/39',
    title: 'Add the thing',
    baseRefName: 'main',
    headSha: SHA,
    checks: [
      { name: 'CI / test', bucket: 'fail', detailsUrl: 'https://github.com/acme/app/actions/runs/1', startedAt: null, completedAt: null },
      { name: 'CI / build', bucket: 'pass', detailsUrl: null, startedAt: null, completedAt: null },
    ],
    totalChecks: 2,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    allowedMergeMethods: ['squash', 'merge'],
    ...patch,
  };
}

function seed(s: PrCiSummary) {
  usePrCiStore.setState({ summaries: { [s.ref]: s } });
}

const badge = (props: Partial<Parameters<typeof PrBadge>[0]> = {}) => (
  <PrBadge org="acme" name="app" pr={{ number: 39, state: 'open' }} {...props} />
);

beforeEach(() => {
  vi.clearAllMocks();
  resetPrCiStore();
  api.fetchPRCiSummaries.mockResolvedValue({});
  api.fetchPRCiDetail.mockResolvedValue(detail());
});
afterEach(() => {
  cleanup();
  resetPrCiStore();
});

describe('PrBadge chip', () => {
  it('shows the CI segment next to an open PR', () => {
    seed(summary());
    render(badge());
    expect(screen.getByText('app#39')).toBeTruthy();
    const segment = screen.getByRole('button', { name: /CI failed/ });
    expect(segment.getAttribute('title')).toBe('CI failed · 3 passed · 1 failed');
  });

  it('shows no CI segment once the store says the PR is merged, whatever the caller passed', () => {
    seed(summary({ state: 'MERGED' }));
    render(badge());
    expect(screen.getByText('app#39')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no CI segment for a closed PR', () => {
    render(badge({ pr: { number: 39, state: 'closed' } }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the CI segment on a draft PR', () => {
    seed(summary({ isDraft: true, ciStatus: 'running' }));
    render(badge());
    expect(screen.getByRole('button', { name: /CI running/ })).toBeTruthy();
  });

  it('compact variant keeps the label out of the chip but in the accessible name', () => {
    seed(summary({ ciStatus: 'passed', counts: { pass: 2 } }));
    render(badge({ variant: 'compact' }));
    const segment = screen.getByRole('button', { name: 'CI passed' });
    expect(segment.textContent).toBe('');
  });

  it('shows "CI ?" with the error in the tooltip when GitHub could not be reached', () => {
    usePrCiStore.setState({ errors: { [REF]: 'rate limited' } });
    render(badge());
    expect(screen.getByRole('button').getAttribute('title')).toBe('CI ? — rate limited');
  });

  it('clicking the CI segment never reaches the parent (kanban card selection)', () => {
    seed(summary());
    const onParentClick = vi.fn();
    render(<div onClick={onParentClick}>{badge()}</div>);
    fireEvent.click(screen.getByRole('button', { name: /CI failed/ }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

describe('PrBadge menu', () => {
  it('opening the menu loads the detail and lists checks; a row opens its job', async () => {
    seed(summary());
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(badge());
    fireEvent.click(screen.getByRole('button', { name: /CI failed/ }));

    expect(api.fetchPRCiDetail).toHaveBeenCalledWith(REF);
    fireEvent.click(await screen.findByText('CI / test'));
    expect(open).toHaveBeenCalledWith('https://github.com/acme/app/actions/runs/1', '_blank');
  });

  it('offers only the allowed merge methods, the default first', async () => {
    seed(summary());
    render(badge());
    fireEvent.click(screen.getByRole('button', { name: /CI failed/ }));
    const items = await screen.findAllByRole('menuitem', { name: /merge/i });
    expect(items.map((i) => i.textContent)).toEqual(['Squash and merge(default)', 'Create a merge commit']);
  });

  it('disables merge with the reason when GitHub reports conflicts', async () => {
    seed(summary());
    api.fetchPRCiDetail.mockResolvedValue(detail({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }));
    render(badge());
    fireEvent.click(screen.getByRole('button', { name: /CI failed/ }));
    expect(await screen.findByText('Merge conflicts')).toBeTruthy();
    expect((screen.getByRole('menuitem', { name: /Squash and merge/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PrBadge merge', () => {
  async function openConfirm() {
    seed(summary());
    render(badge());
    fireEvent.click(screen.getByRole('button', { name: /CI failed/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Squash and merge/ }));
  }

  it('asks for confirmation, warns about failing CI, then merges at the shown head commit', async () => {
    api.mergePR.mockResolvedValue({ ok: true });
    await openConfirm();

    expect(screen.getByText('Squash and merge app#39?')).toBeTruthy();
    expect(screen.getByText('CI is failing — merge anyway?')).toBeTruthy();
    expect(api.mergePR).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Squash and merge' }));
    });
    expect(api.mergePR).toHaveBeenCalledWith({ ref: REF, method: 'squash', headSha: SHA });
    await waitFor(() => expect(screen.queryByText('Squash and merge app#39?')).toBeNull());
    // Optimistically merged: the chip loses its CI segment.
    expect(screen.queryByRole('button', { name: /CI/ })).toBeNull();
  });

  it('keeps the dialog open with gh refusal so the user can retry', async () => {
    api.mergePR.mockRejectedValue(new Error('Head branch was modified'));
    await openConfirm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Squash and merge' }));
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Head branch was modified');
    expect(screen.getByText('Squash and merge app#39?')).toBeTruthy();
  });
});
