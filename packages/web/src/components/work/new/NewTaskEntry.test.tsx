import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { ImportBrowseInbox } from '@fleex/shared';
import type { WorkDraft } from '../../../stores/workStore';
import { NewTaskEntry } from './NewTaskEntry';
import { useWorkStore } from '../../../stores/workStore';
import { resetBrowseResources } from './useBrowseResource';

const inbox: { current: ImportBrowseInbox | Error } = { current: new Error('unset') };
vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchImportBrowseInbox: vi.fn(async () => {
    if (inbox.current instanceof Error) throw inbox.current;
    return inbox.current;
  }),
}));

const EMPTY_INBOX: ImportBrowseInbox = {
  githubUser: 'me', issues: [], reviewRequests: [], myPullRequests: [],
  fetchedAt: '2026-09-21T10:00:00.000Z', stale: false,
};

const ENTRY_DRAFT: WorkDraft = {
  title: '', text: '', stage: 'entry', source: null,
  repoKeys: [], repoBaseBranches: {}, repoCheckoutRefs: {},
  epicIds: [], boardId: 'b1', type: 'build', priority: 'none',
};

const RECOGNITION_HINT = 'use as plain text';
const findInput = () => screen.getByPlaceholderText('Paste a link, or name the task…');

beforeEach(() => {
  localStorage.clear();
  resetBrowseResources();
  inbox.current = EMPTY_INBOX;
  useWorkStore.setState({ view: 'new', draft: { ...ENTRY_DRAFT } });
});
afterEach(cleanup);

describe('NewTaskEntry', () => {
  it('names the task and moves to the composer on plain text + Enter', () => {
    const onImport = vi.fn();
    render(<NewTaskEntry onImport={onImport} onBrowse={() => {}} />);

    fireEvent.change(findInput(), { target: { value: 'Refactor the parser' } });
    fireEvent.keyDown(findInput(), { key: 'Enter' });

    expect(onImport).not.toHaveBeenCalled();
    expect(useWorkStore.getState().draft).toMatchObject({ title: 'Refactor the parser', stage: 'compose' });
  });

  it('recognizes a GitHub issue link and imports it on Enter', () => {
    const onImport = vi.fn();
    render(<NewTaskEntry onImport={onImport} onBrowse={() => {}} />);

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
    render(<NewTaskEntry onImport={onImport} onBrowse={() => {}} />);

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
    render(<NewTaskEntry onImport={onImport} onBrowse={() => {}} />);

    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/12' } });
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    expect(screen.getByText('Treated as plain text')).toBeTruthy();

    // Any keystroke (re-typing the same value) re-arms the recognition.
    fireEvent.change(findInput(), { target: { value: 'https://github.com/acme/web/issues/13' } });
    expect(screen.getByText(RECOGNITION_HINT)).toBeTruthy();
  });
});

describe('NewTaskEntry — browsing without a link', () => {
  const row = (name: RegExp) => screen.getByRole('button', { name });

  it('opens a source from the keyboard: ↓ leaves the field, ↑↓ move, ↵ opens', () => {
    const onBrowse = vi.fn();
    render(<NewTaskEntry onImport={() => {}} onBrowse={onBrowse} />);

    fireEvent.keyDown(findInput(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(/A GitHub issue/));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(/A GitHub pull request/));
    fireEvent.click(document.activeElement!); // what ↵ does on a focused button

    expect(onBrowse).toHaveBeenCalledWith('prs');
  });

  it('↑ on the first source, or Esc on any, gives the field back without closing New Task', () => {
    render(<NewTaskEntry onImport={() => {}} onBrowse={() => {}} />);

    fireEvent.keyDown(findInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(findInput());

    fireEvent.keyDown(findInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(findInput());
    expect(useWorkStore.getState().view).toBe('new');
  });

  it('never treats a digit typed in the field as a shortcut: "2FA login" is a title', () => {
    const onBrowse = vi.fn();
    render(<NewTaskEntry onImport={() => {}} onBrowse={onBrowse} />);

    fireEvent.keyDown(findInput(), { key: '2', code: 'Digit2' });

    expect(onBrowse).not.toHaveBeenCalled();
  });

  it('opens a source with ⌥1·2·3 from the field, and with a bare digit once in the list', () => {
    const onBrowse = vi.fn();
    render(<NewTaskEntry onImport={() => {}} onBrowse={onBrowse} />);

    // macOS reports ⌥3 as key "£"/"#": the shortcut must read the physical key.
    fireEvent.keyDown(findInput(), { key: '£', code: 'Digit3', altKey: true });
    expect(onBrowse).toHaveBeenLastCalledWith('slack');

    fireEvent.keyDown(findInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: '1', code: 'Digit1' });
    expect(onBrowse).toHaveBeenLastCalledWith('issues');
  });

  it('warms the lists as soon as it opens and shows what is waiting on each source', async () => {
    inbox.current = {
      ...EMPTY_INBOX,
      issues: [{ org: 'acme', name: 'web', number: 1, title: 'A', author: 'me', assignees: [], updatedAt: '2026-09-20T10:00:00.000Z' }],
      reviewRequests: [
        { org: 'acme', name: 'web', number: 2, title: 'B', headRefName: 'b', author: 'x', isDraft: false, isBot: false, updatedAt: '2026-09-20T10:00:00.000Z' },
        { org: 'acme', name: 'web', number: 3, title: 'C', headRefName: 'c', author: 'y', isDraft: false, isBot: false, updatedAt: '2026-09-20T10:00:00.000Z' },
      ],
    };
    render(<NewTaskEntry onImport={() => {}} onBrowse={() => {}} />);

    expect(await screen.findByText('1 open for you')).toBeTruthy();
    expect(screen.getByText('2 waiting for your review')).toBeTruthy();
  });

  it('stays usable, with no error in the way, when the prefetch fails', async () => {
    inbox.current = new Error('GitHub is down');
    const onBrowse = vi.fn();
    render(<NewTaskEntry onImport={() => {}} onBrowse={onBrowse} />);
    await Promise.resolve();

    expect(screen.queryByText(/GitHub is down/)).toBeNull(); // the picker reports it, not the entry
    fireEvent.click(row(/A Slack message or thread/));
    expect(onBrowse).toHaveBeenCalledWith('slack');
  });
});

