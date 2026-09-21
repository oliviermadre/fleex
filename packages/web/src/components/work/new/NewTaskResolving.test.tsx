import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import type { SlackConnectorStatus } from '@fleex/shared';
import type { WorkDraft } from '../../../stores/workStore';
import { NewTask } from './NewTask';
import { useWorkStore } from '../../../stores/workStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useConnectorStore } from '../../../stores/connectorStore';

// previewImport stays pending so we sit inside the resolving step.
vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  previewImport: vi.fn(() => new Promise(() => {})),
  fetchImportBrowseInbox: vi.fn(() => new Promise(() => {})),
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
  useConnectorStore.setState({ slack: { connected: false } });
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

describe('NewTask — Slack resolving reflects fetch then summary on the direct path', () => {
  const SLACK_URL = 'https://acme.slack.com/archives/C08TMLH6VM0/p1700000000000100';
  const connectedToAcme: SlackConnectorStatus = {
    connected: true, teamName: 'Acme', teamDomain: 'acme', userName: 'me',
    tokenHint: 'xoxp-…WXYZ', missingScopes: [], connectedAt: '2026-09-21T10:00:00.000Z',
  };

  function startSlackImport() {
    render(<NewTask />);
    fireEvent.change(findInput(), { target: { value: SLACK_URL } });
    fireEvent.keyDown(findInput(), { key: 'Enter' });
  }

  it('with a token, shows the fetch active first, then hands the seconds to the summary step', () => {
    // The bug: "Fetching…" stayed active for the whole (opaque) request, so the
    // summary's seconds read as a multi-second fetch. The fetch is sub-second here.
    useConnectorStore.setState({ slack: connectedToAcme });
    vi.useFakeTimers();
    try {
      startSlackImport();

      // Before the grace: fetching is the active step, summary is still to-do.
      expect(screen.getByText('Fetching the conversation from Slack…')).toBeTruthy();
      expect(screen.getByText('Claude writes the summary')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1300);
      });

      // After the grace: fetch is done, and the chrono now belongs to the summary.
      expect(screen.queryByText('Fetching the conversation from Slack…')).toBeNull();
      expect(screen.getByText('Conversation fetched')).toBeTruthy();
      expect(screen.getByText('Claude is writing the summary…')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a token, keeps one "reading" step — fetch and summary are one MCP loop, not separable', () => {
    // No token → Claude reads Slack through MCP; we cannot split the two phases,
    // so we must not pretend to. The step must NOT flip after the grace.
    useConnectorStore.setState({ slack: { connected: false } });
    vi.useFakeTimers();
    try {
      startSlackImport();

      expect(screen.getByText('Claude is reading the conversation…')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(screen.getByText('Claude is reading the conversation…')).toBeTruthy();
      expect(screen.queryByText('Conversation fetched')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
