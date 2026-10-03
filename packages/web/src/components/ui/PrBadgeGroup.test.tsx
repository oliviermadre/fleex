import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import type { PrCiDetail, PrCiSummary } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchPRCiSummaries: vi.fn(),
  fetchPRCiDetail: vi.fn(),
  mergePR: vi.fn(),
}));
vi.mock('../../services/api', () => api);

import { PrBadgeGroup } from './PrBadgeGroup';
import { resetPrCiStore, usePrCiStore } from '../../stores/prCiStore';
import type { LinkedPr } from '../../lib/prRef';

const SHA = 'f'.repeat(40);

function prs(n: number): LinkedPr[] {
  return Array.from({ length: n }, (_, i) => ({ org: 'acme', name: 'app', number: i + 1, title: `acme/app#${i + 1}` }));
}

function summary(number: number, patch: Partial<PrCiSummary> = {}): PrCiSummary {
  return { ref: `acme/app#${number}`, state: 'OPEN', isDraft: false, ciStatus: 'passed', counts: { pass: 2 }, ...patch };
}

function seed(...list: PrCiSummary[]) {
  usePrCiStore.setState({ summaries: Object.fromEntries(list.map((s) => [s.ref, s])) });
}

function detail(number: number): PrCiDetail {
  return {
    ...summary(number, { ciStatus: 'failed', counts: { fail: 1 } }),
    url: `https://github.com/acme/app/pull/${number}`,
    title: 'Add the thing',
    baseRefName: 'main',
    headSha: SHA,
    checks: [{ name: 'CI / test', bucket: 'fail', detailsUrl: 'https://github.com/acme/app/actions/runs/1', startedAt: null, completedAt: null }],
    totalChecks: 1,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    allowedMergeMethods: ['squash'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPrCiStore();
  api.fetchPRCiSummaries.mockResolvedValue({});
  api.fetchPRCiDetail.mockImplementation((ref: string) => Promise.resolve(detail(Number(ref.split('#')[1]))));
});
afterEach(() => {
  cleanup();
  resetPrCiStore();
});

/** Opens the 6-PR summary dropdown and returns it. */
function openSummary() {
  fireEvent.click(screen.getByRole('button', { name: /^6 PR/ }));
  return screen.getByRole('dialog');
}

describe('PrBadgeGroup density', () => {
  it('renders nothing without PRs', () => {
    const { container } = render(<PrBadgeGroup prs={[]} density="card" />);
    expect(container.innerHTML).toBe('');
  });

  it('full: one chip per PR with the CI label for 1 and 2 PRs', () => {
    seed(summary(1), summary(2));
    render(<PrBadgeGroup prs={prs(2)} density="full" />);
    expect(screen.getAllByText('CI passed')).toHaveLength(2);
  });

  it('full or card, more than 2 PRs fold into the summary chip', () => {
    seed(summary(1), summary(2), summary(3));
    const { rerender } = render(<PrBadgeGroup prs={prs(3)} density="full" />);
    expect(screen.getByRole('button', { name: /^3 PR/ })).toBeTruthy();
    expect(screen.queryByText('app#1')).toBeNull();
    rerender(<PrBadgeGroup prs={prs(3)} density="card" />);
    expect(screen.getByRole('button', { name: /^3 PR/ })).toBeTruthy();
  });

  it('shows the last known state until the store answers', () => {
    render(<PrBadgeGroup prs={prs(3).map((pr) => ({ ...pr, state: 'merged' as const }))} density="full" />);
    expect(screen.getByTestId('pr-summary-dot').className).toMatch(/purple/);
  });

  it('card: compact chips for 1 and 2 PRs', () => {
    seed(summary(1), summary(2));
    const { rerender } = render(<PrBadgeGroup prs={prs(1)} density="card" />);
    expect(screen.getAllByRole('button', { name: 'CI passed' })).toHaveLength(1);
    rerender(<PrBadgeGroup prs={prs(2)} density="card" />);
    expect(screen.getAllByRole('button', { name: 'CI passed' })).toHaveLength(2);
    expect(screen.queryByText('CI passed')).toBeNull();
  });

  it('card: one summary chip from 3 PRs, coloured by the worst status', () => {
    seed(summary(1), summary(2, { ciStatus: 'failed' }), summary(3, { ciStatus: 'running' }), summary(4, { state: 'MERGED' }), summary(5), summary(6));
    render(<PrBadgeGroup prs={prs(6)} density="card" />);
    const chip = screen.getByRole('button', { name: /^6 PR/ });
    expect(chip.textContent).toBe('6 PR');
    expect(chip.getAttribute('title')).toBe('6 PR — 1 CI failed · 1 CI running · 3 CI passed · 1 merged');
    expect(screen.getByTestId('pr-summary-dot').className).toMatch(/red/);
    expect(screen.queryByText('app#1')).toBeNull();
  });

  it('a merged-only group shows the merged colour', () => {
    seed(...[1, 2, 3].map((n) => summary(n, { state: 'MERGED' })));
    render(<PrBadgeGroup prs={prs(3)} density="card" />);
    expect(screen.getByTestId('pr-summary-dot').className).toMatch(/purple/);
  });
});

describe('PrBadgeGroup summary dropdown', () => {
  beforeEach(() => seed(...[1, 2, 3, 4, 5, 6].map((n) => summary(n, { ciStatus: 'failed', counts: { fail: 1 } }))));

  it('lists the PRs in org/repo then number order, whatever the link order', () => {
    const shuffled: LinkedPr[] = [
      { org: 'acme', name: 'web', number: 2, title: 'acme/web#2' },
      { org: 'acme', name: 'app', number: 10, title: 'acme/app#10' },
      { org: 'acme', name: 'app', number: 9, title: 'acme/app#9' },
    ];
    render(<PrBadgeGroup prs={shuffled} density="card" />);
    fireEvent.click(screen.getByRole('button', { name: /^3 PR/ }));
    const labels = within(screen.getByRole('dialog')).getAllByRole('link').map((a) => a.textContent);
    expect(labels).toEqual(['app#9', 'app#10', 'web#2']);
  });

  it('lists every PR as a compact chip', () => {
    render(<PrBadgeGroup prs={prs(6)} density="card" />);
    const dropdown = openSummary();
    expect(within(dropdown).getAllByRole('button', { name: 'CI failed' })).toHaveLength(6);
    expect(within(dropdown).getByText('app#6')).toBeTruthy();
  });

  it('never reaches the card it sits in', () => {
    const onCard = vi.fn();
    render(<div onClick={onCard}><PrBadgeGroup prs={prs(6)} density="card" /></div>);
    const dropdown = openSummary();
    fireEvent.click(dropdown);
    fireEvent.click(within(dropdown).getAllByRole('button', { name: 'CI failed' })[0]!);
    expect(onCard).not.toHaveBeenCalled();
  });

  it('a press outside closes it', () => {
    render(<PrBadgeGroup prs={prs(6)} density="card" />);
    openSummary();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a row opens its CI menu, and a press in that menu keeps the dropdown open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PrBadgeGroup prs={prs(6)} density="card" />);
    const dropdown = openSummary();
    fireEvent.click(within(dropdown).getAllByRole('button', { name: 'CI failed' })[1]!);

    const check = await screen.findByText('CI / test');
    fireEvent.pointerDown(check);
    fireEvent.click(check);
    expect(open).toHaveBeenCalledWith('https://github.com/acme/app/actions/runs/1', '_blank');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('merges from a row through the confirmation, the dropdown staying open', async () => {
    api.mergePR.mockResolvedValue({ ok: true });
    render(<PrBadgeGroup prs={prs(6)} density="card" />);
    const dropdown = openSummary();
    fireEvent.click(within(dropdown).getAllByRole('button', { name: 'CI failed' })[1]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Squash and merge/ }));

    const confirm = screen.getByRole('button', { name: 'Squash and merge' });
    fireEvent.pointerDown(confirm);
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(api.mergePR).toHaveBeenCalledWith({ ref: 'acme/app#2', method: 'squash', headSha: SHA });
    await waitFor(() => expect(screen.queryByText('Squash and merge app#2?')).toBeNull());
    // Still open, the merged row has lost its CI segment.
    expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'CI failed' })).toHaveLength(5);
  });
});
