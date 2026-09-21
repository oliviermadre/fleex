import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BrowseIssue, BrowsePullRequest, ImportBrowseInbox, ImportBrowseRepo, Repository } from '@fleex/shared';
import { SourcePicker } from './SourcePicker';
import { resetBrowseResources } from './useBrowseResource';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';

const api = vi.hoisted(() => ({
  inbox: vi.fn<() => Promise<ImportBrowseInbox>>(),
  repo: vi.fn<(org: string, name: string) => Promise<ImportBrowseRepo>>(),
}));
vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchImportBrowseInbox: api.inbox,
  fetchImportBrowseRepo: api.repo,
}));

const NOW = '2026-09-21T10:00:00.000Z';
const pr = (number: number, over: Partial<BrowsePullRequest> = {}): BrowsePullRequest => ({
  org: 'acme', name: 'api', number, title: `PR ${number}`, headRefName: `feat/${number}`,
  author: 'ana', isDraft: false, isBot: false, updatedAt: NOW, ...over,
});
const issue = (number: number, over: Partial<BrowseIssue> = {}): BrowseIssue => ({
  org: 'acme', name: 'api', number, title: `Issue ${number}`, author: 'me', assignees: [], updatedAt: NOW, ...over,
});
const inboxOf = (over: Partial<ImportBrowseInbox> = {}): ImportBrowseInbox => ({
  githubUser: 'me', issues: [], reviewRequests: [], myPullRequests: [], fetchedAt: NOW, stale: false, ...over,
});
const repoOf = (over: Partial<ImportBrowseRepo> = {}): ImportBrowseRepo => ({
  pullRequests: [], issues: [], fetchedAt: NOW, stale: false, ...over,
});

const filterField = () => screen.getByLabelText('Filter');
const options = () => screen.queryAllByRole('option').map((el) => el.textContent ?? '');

beforeEach(() => {
  localStorage.clear();
  resetBrowseResources();
  vi.clearAllMocks();
  api.inbox.mockResolvedValue(inboxOf());
  api.repo.mockResolvedValue(repoOf());
  useRepositoryStore.setState({
    repositories: [{ org: 'acme', name: 'api' } as Repository, { org: 'acme', name: 'web' } as Repository],
    fetchRepositories: vi.fn(async () => {}),
  });
  useTicketStore.setState({ tickets: [] });
  useWorkStore.getState().updateDraft({ boardId: 'b1' });
});
afterEach(cleanup);

function mount(kind: 'issues' | 'prs' = 'prs') {
  const props = { onBack: vi.fn(), onImport: vi.fn(), onOpenTicket: vi.fn() };
  render(<SourcePicker kind={kind} {...props} />);
  return props;
}

describe('SourcePicker', () => {
  it('imports the highlighted pull request with the exact ref the registry stores', async () => {
    api.inbox.mockResolvedValue(inboxOf({ reviewRequests: [pr(7, { org: 'Acme', name: 'Api' }), pr(8)] }));
    const { onImport } = mount();
    await screen.findByText('PR 7');

    fireEvent.keyDown(filterField(), { key: 'ArrowDown' }); // → PR 8
    fireEvent.keyDown(filterField(), { key: 'ArrowUp' }); // → back to PR 7
    fireEvent.keyDown(filterField(), { key: 'Enter' });

    // Lowercased: otherwise getTicketsLinkedTo() stops finding the ticket later.
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'github_pr', ref: 'acme/api#7' }));
  });

  it('opens the existing ticket instead of importing a row twice', async () => {
    api.inbox.mockResolvedValue(inboxOf({ reviewRequests: [pr(7, { linkedTicket: { id: 't-1', displayId: 412 } })] }));
    const { onImport, onOpenTicket } = mount();

    fireEvent.click(await screen.findByText('PR 7'));

    expect(screen.getByText('↗ ticket #412')).toBeTruthy();
    expect(onOpenTicket).toHaveBeenCalledWith('t-1');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('narrows the list as you type, across title, number, branch and author', async () => {
    api.inbox.mockResolvedValue(
      inboxOf({ reviewRequests: [pr(7, { title: 'Fix login' }), pr(8, { headRefName: 'chore/quota' }), pr(9, { author: 'zed' })] }),
    );
    mount();
    await screen.findByText('Fix login');

    fireEvent.change(filterField(), { target: { value: 'quota' } });
    expect(options()).toHaveLength(1);
    fireEvent.change(filterField(), { target: { value: 'zed' } });
    expect(options()[0]).toContain('PR 9');
    fireEvent.change(filterField(), { target: { value: '#7' } });
    expect(options()[0]).toContain('Fix login');
  });

  it('Esc clears a filter first, and only then goes back', async () => {
    api.inbox.mockResolvedValue(inboxOf({ reviewRequests: [pr(7)] }));
    const { onBack } = mount();
    await screen.findByText('PR 7');
    fireEvent.change(filterField(), { target: { value: 'nope' } });

    fireEvent.keyDown(filterField(), { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
    expect((filterField() as HTMLInputElement).value).toBe('');

    fireEvent.keyDown(filterField(), { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offers a way forward when nothing awaits review, instead of a dead end', async () => {
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Browse a repo' }));

    expect(screen.getByRole('tab', { name: /By repo/ }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(api.repo).toHaveBeenCalledWith('acme', 'api')); // lands on a repo, not an empty tab
  });

  it('keeps dependency bots out of a repo list until asked', async () => {
    api.repo.mockResolvedValue(
      repoOf({ pullRequests: [pr(1), pr(2, { title: 'bump x', author: 'dependabot', isBot: true }), pr(3, { isDraft: true })] }),
    );
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /By repo/ }));
    await screen.findByText('PR 1');

    expect(screen.queryByText('bump x')).toBeNull();
    expect(screen.getByText('draft')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bots hidden · 1' }));
    expect(screen.getByText('bump x')).toBeTruthy();
  });

  it('lists my issues with why each one is mine', async () => {
    api.inbox.mockResolvedValue(
      inboxOf({ issues: [issue(3, { author: 'someone', assignees: ['me'] }), issue(4, { author: 'me' })] }),
    );
    const { onImport } = mount('issues');

    expect(await screen.findByText(/assigned to you/)).toBeTruthy();
    expect(screen.getByText(/opened by you/)).toBeTruthy();

    fireEvent.keyDown(filterField(), { key: 'Enter' });
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'github_issue', ref: 'acme/api#3' }));
  });

  it('says what went wrong and retries once, on demand', async () => {
    api.inbox.mockRejectedValueOnce(new Error('gh: not authenticated'));
    mount();

    expect(await screen.findByText('gh: not authenticated')).toBeTruthy();
    expect(api.inbox).toHaveBeenCalledTimes(1);

    api.inbox.mockResolvedValue(inboxOf({ reviewRequests: [pr(7)] }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('PR 7')).toBeTruthy();
    expect(api.inbox).toHaveBeenCalledTimes(2);
  });
});
