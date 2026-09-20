import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { WorkDraft } from '../../../stores/workStore';
import { NewTask } from './NewTask';
import { useWorkStore } from '../../../stores/workStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';

// previewImport stays pending so we sit inside the resolving step.
vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  previewImport: vi.fn(() => new Promise(() => {})),
  fetchDashboard: vi.fn(async () => ({
    myIssues: [], assignedIssues: [], reviewRequests: [], myPullRequests: [],
    activeTickets: [], activeWorktrees: [], githubUser: '',
  })),
}));

const ENTRY_DRAFT: WorkDraft = {
  title: '', text: '', stage: 'entry', source: null,
  repoKeys: [], repoBaseBranches: {}, repoCheckoutRefs: {},
  epicIds: [], boardId: 'b1', type: 'build', priority: 'none',
};

const findInput = () => screen.getByPlaceholderText('Paste a link, or name the task…') as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  useRepositoryStore.setState({ repositories: [] });
  useWorkStore.setState({ view: 'new', draft: { ...ENTRY_DRAFT } });
});
afterEach(cleanup);

describe('NewTask — instant-source grace does not flash blank', () => {
  it('keeps the ENTRY visible (disabled) while an instant source resolves within its 400 ms grace', () => {
    render(<NewTask />);

    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/12' } });
    fireEvent.keyDown(findInput(), { key: 'Enter' });

    // Inside the grace window the resolving screen renders nothing — but the
    // ENTRY must remain on screen (as a disabled backdrop), never a blank center.
    expect(screen.getByText('Where does this task come from?')).toBeTruthy();
    expect(findInput().disabled).toBe(true);
    // The resolving UI is still invisible (grace), so no "Fetching…" yet.
    expect(screen.queryByText(/Fetching/)).toBeNull();
  });
});
