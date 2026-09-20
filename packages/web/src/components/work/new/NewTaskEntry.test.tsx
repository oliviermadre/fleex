import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { WorkDraft } from '../../../stores/workStore';
import { NewTaskEntry } from './NewTaskEntry';
import { useWorkStore } from '../../../stores/workStore';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
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

const RECOGNITION_HINT = '↵ import · Esc use as plain text';
const findInput = () => screen.getByPlaceholderText('Paste a link, or name the task…');

beforeEach(() => {
  localStorage.clear();
  useWorkStore.setState({ view: 'new', draft: { ...ENTRY_DRAFT } });
});
afterEach(cleanup);

describe('NewTaskEntry', () => {
  it('names the task and moves to the composer on plain text + Enter', () => {
    const onImport = vi.fn();
    render(<NewTaskEntry onImport={onImport} onOpenTicket={() => {}} />);

    fireEvent.change(findInput(), { target: { value: 'Refactor the parser' } });
    fireEvent.keyDown(findInput(), { key: 'Enter' });

    expect(onImport).not.toHaveBeenCalled();
    expect(useWorkStore.getState().draft).toMatchObject({ title: 'Refactor the parser', stage: 'compose' });
  });

  it('recognizes a GitHub issue link and imports it on Enter', () => {
    const onImport = vi.fn();
    render(<NewTaskEntry onImport={onImport} onOpenTicket={() => {}} />);

    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/12' } });
    expect(screen.getByText(RECOGNITION_HINT)).toBeTruthy();

    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]![0]).toMatchObject({ sourceId: 'github_issue', ref: 'acme/web#12' });
    // An import never moves straight to compose — that's the resolving step's job.
    expect(useWorkStore.getState().draft.stage).toBe('entry');
  });

  it('Esc refuses the recognition without leaving; a later Enter uses it as plain text', () => {
    const onImport = vi.fn();
    render(<NewTaskEntry onImport={onImport} onOpenTicket={() => {}} />);

    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/12' } });
    fireEvent.keyDown(findInput(), { key: 'Escape' });

    expect(screen.getByText('Treated as plain text')).toBeTruthy();
    expect(screen.queryByText(RECOGNITION_HINT)).toBeNull();

    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(onImport).not.toHaveBeenCalled();
    expect(useWorkStore.getState().draft).toMatchObject({
      title: 'https://github.com/acme/web/issues/12',
      stage: 'compose',
    });
  });

  it('re-arms recognition when the user keeps typing after refusing', () => {
    const onImport = vi.fn();
    render(<NewTaskEntry onImport={onImport} onOpenTicket={() => {}} />);

    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/12' } });
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    expect(screen.getByText('Treated as plain text')).toBeTruthy();

    // Any keystroke (re-typing the same value) re-arms the recognition.
    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/13' } });
    expect(screen.getByText(RECOGNITION_HINT)).toBeTruthy();
  });
});
