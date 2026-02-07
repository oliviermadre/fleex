import { useState, useEffect, useCallback, useMemo } from 'react';
import type { DiffStats, GitHubIssue, PullRequest, Worktree } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import type { Column } from '../ui/DataTable';
import { DiffStatsBadge } from '../ui/DiffStatsBadge';
import { Autocomplete } from '../ui/Autocomplete';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';
import { formatAge } from '../../lib/formatAge';

type WorktreeMode = 'main' | 'existing' | 'pr' | 'issue' | 'new';

interface DefaultBranchInfo {
  defaultBranch: string;
  currentBranch: string;
  isOnDefault: boolean;
}

export function CreateSessionModal() {
  const open = useUIStore((s) => s.createModalOpen);
  const closeModal = useUIStore((s) => s.closeCreateModal);

  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const worktreesByRepo = useRepositoryStore((s) => s.worktreesByRepo);
  const fetchWorktrees = useRepositoryStore((s) => s.fetchWorktrees);

  const selectSession = useSessionStore((s) => s.selectSession);
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);

  const [selectedRepo, setSelectedRepo] = useState('');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('main');
  const [selectedWorktreeIndex, setSelectedWorktreeIndex] = useState<number | null>(null);
  const [selectedPRIndex, setSelectedPRIndex] = useState<number | null>(null);
  const [selectedIssueIndex, setSelectedIssueIndex] = useState<number | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [claudePrompt, setClaudePrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [defaultBranchInfo, setDefaultBranchInfo] = useState<DefaultBranchInfo | null>(null);
  const [diffStatsByBranch, setDiffStatsByBranch] = useState<Record<string, DiffStats>>({});
  const [loadingDiffStats, setLoadingDiffStats] = useState(false);

  const worktrees: Worktree[] = selectedRepo ? (worktreesByRepo[selectedRepo] ?? []) : [];
  const filteredWorktrees = useMemo(() => worktrees.filter((w) => !w.isBare), [worktrees]);

  // Fetch worktrees + default branch info when repo changes
  useEffect(() => {
    if (!selectedRepo) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    setWorktreeMode('main');
    setSelectedWorktreeIndex(null);
    setSelectedPRIndex(null);
    setSelectedIssueIndex(null);
    setNewBranchName('');
    setPullRequests([]);
    setIssues([]);
    setDefaultBranchInfo(null);
    setDiffStatsByBranch({});
    setError('');

    fetchWorktrees(org, name).catch(() => {});
    api.fetchDefaultBranch(org, name)
      .then(setDefaultBranchInfo)
      .catch(() => setDefaultBranchInfo(null));
  }, [selectedRepo, fetchWorktrees]);

  // Fetch PRs when switching to PR or existing mode (for linking)
  const loadPRs = useCallback(() => {
    if (!selectedRepo || pullRequests.length > 0) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    setLoadingPRs(true);
    api.fetchPullRequests(org, name)
      .then(setPullRequests)
      .catch(() => setPullRequests([]))
      .finally(() => setLoadingPRs(false));
  }, [selectedRepo, pullRequests.length]);

  useEffect(() => {
    if (worktreeMode === 'pr' || worktreeMode === 'existing') loadPRs();
  }, [worktreeMode, loadPRs]);

  // Fetch issues when switching to issue mode
  const loadIssues = useCallback(() => {
    if (!selectedRepo || issues.length > 0) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    setLoadingIssues(true);
    api.fetchIssues(org, name)
      .then(setIssues)
      .catch(() => setIssues([]))
      .finally(() => setLoadingIssues(false));
  }, [selectedRepo, issues.length]);

  useEffect(() => {
    if (worktreeMode === 'issue') loadIssues();
  }, [worktreeMode, loadIssues]);

  // Lazy-load diff stats for worktree branches
  useEffect(() => {
    if (worktreeMode !== 'existing' || !selectedRepo || filteredWorktrees.length === 0) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    const branches = filteredWorktrees
      .filter((w) => !w.isMain)
      .map((w) => w.branch)
      .filter((b) => !diffStatsByBranch[b]);
    if (branches.length === 0) return;

    setLoadingDiffStats(true);
    api.fetchDiffStats(org, name, branches)
      .then((stats) => setDiffStatsByBranch((prev) => ({ ...prev, ...stats })))
      .catch(() => {})
      .finally(() => setLoadingDiffStats(false));
  }, [worktreeMode, selectedRepo, filteredWorktrees, diffStatsByBranch]);

  // Lazy-load diff stats for PR branches
  useEffect(() => {
    if (worktreeMode !== 'pr' || !selectedRepo || pullRequests.length === 0) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    const branches = pullRequests
      .map((pr) => pr.headRefName)
      .filter((b) => !diffStatsByBranch[b]);
    if (branches.length === 0) return;

    setLoadingDiffStats(true);
    api.fetchDiffStats(org, name, branches)
      .then((stats) => setDiffStatsByBranch((prev) => ({ ...prev, ...stats })))
      .catch(() => {})
      .finally(() => setLoadingDiffStats(false));
  }, [worktreeMode, selectedRepo, pullRequests, diffStatsByBranch]);

  const repoOptions = resolvedRepositories.map((r) => ({ value: r, label: r }));

  // Find linked PR for a worktree branch
  const linkedPR = useCallback(
    (branch: string) => pullRequests.find((pr) => pr.headRefName === branch),
    [pullRequests],
  );

  // Column definitions
  const worktreeColumns: Column<Worktree>[] = useMemo(
    () => [
      {
        key: 'branch',
        header: 'Branch',
        width: '25%',
        render: (w) => <span className="block truncate font-mono text-xs" title={w.branch}>{w.branch}</span>,
      },
      {
        key: 'path',
        header: 'Path',
        width: '20%',
        render: (w) => {
          const short = w.path.split('/').slice(-2).join('/');
          return <span className="block truncate text-xs text-zinc-400" title={w.path}>{short}</span>;
        },
      },
      {
        key: 'linkedPR',
        header: 'Linked PR',
        render: (w) => {
          const pr = linkedPR(w.branch);
          if (!pr) return <span className="text-zinc-500">&mdash;</span>;
          return (
            <span className="block truncate text-xs" title={`#${pr.number} ${pr.title}`}>
              <span className="text-zinc-400">#{pr.number}</span>{' '}
              {pr.title}
            </span>
          );
        },
      },
      {
        key: 'diffStats',
        header: 'Diff',
        width: '150px',
        align: 'right' as const,
        render: (w) => (
          <DiffStatsBadge
            stats={diffStatsByBranch[w.branch]}
            loading={loadingDiffStats && !diffStatsByBranch[w.branch]}
          />
        ),
      },
    ],
    [linkedPR, diffStatsByBranch, loadingDiffStats],
  );

  const prColumns: Column<PullRequest>[] = useMemo(
    () => [
      {
        key: 'number',
        header: '#',
        width: '60px',
        render: (pr) => <span className="font-mono text-xs text-zinc-400">#{pr.number}</span>,
      },
      {
        key: 'title',
        header: 'Title',
        render: (pr) => <span className="text-xs truncate block" title={pr.title}>{pr.title}</span>,
      },
      {
        key: 'author',
        header: 'Author',
        width: '100px',
        render: (pr) => <span className="text-xs text-zinc-400">{pr.author}</span>,
      },
      {
        key: 'assignees',
        header: 'Assignee',
        width: '100px',
        render: (pr) => (
          <span className="text-xs text-zinc-400">
            {pr.assignees.length > 0 ? pr.assignees.join(', ') : '\u2014'}
          </span>
        ),
      },
      {
        key: 'created',
        header: 'Created',
        width: '70px',
        align: 'right' as const,
        render: (pr) => <span className="text-xs text-zinc-500">{formatAge(pr.createdAt)}</span>,
      },
      {
        key: 'updated',
        header: 'Updated',
        width: '70px',
        align: 'right' as const,
        render: (pr) => <span className="text-xs text-zinc-500">{formatAge(pr.updatedAt)}</span>,
      },
      {
        key: 'diffStats',
        header: 'Diff',
        width: '130px',
        align: 'right' as const,
        render: (pr) => (
          <DiffStatsBadge
            stats={diffStatsByBranch[pr.headRefName]}
            loading={loadingDiffStats && !diffStatsByBranch[pr.headRefName]}
          />
        ),
      },
    ],
    [diffStatsByBranch, loadingDiffStats],
  );

  const issueColumns: Column<GitHubIssue>[] = useMemo(
    () => [
      {
        key: 'number',
        header: '#',
        width: '60px',
        render: (issue) => <span className="font-mono text-xs text-zinc-400">#{issue.number}</span>,
      },
      {
        key: 'title',
        header: 'Title',
        render: (issue) => <span className="text-xs truncate block" title={issue.title}>{issue.title}</span>,
      },
      {
        key: 'author',
        header: 'Author',
        width: '100px',
        render: (issue) => <span className="text-xs text-zinc-400">{issue.author}</span>,
      },
      {
        key: 'created',
        header: 'Created',
        width: '80px',
        align: 'right' as const,
        render: (issue) => <span className="text-xs text-zinc-500">{formatAge(issue.createdAt)}</span>,
      },
      {
        key: 'updated',
        header: 'Updated',
        width: '80px',
        align: 'right' as const,
        render: (issue) => <span className="text-xs text-zinc-500">{formatAge(issue.updatedAt)}</span>,
      },
    ],
    [],
  );

  const isCreateDisabled = (): boolean => {
    if (!selectedRepo || creating) return true;
    switch (worktreeMode) {
      case 'main':
        return defaultBranchInfo !== null && !defaultBranchInfo.isOnDefault;
      case 'existing':
        return selectedWorktreeIndex === null;
      case 'pr':
        return selectedPRIndex === null;
      case 'issue':
        return selectedIssueIndex === null;
      case 'new':
        return !newBranchName.trim();
    }
  };

  const handleCreate = async () => {
    if (!selectedRepo) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    setCreating(true);
    setError('');

    try {
      let cwd: string;

      switch (worktreeMode) {
        case 'main': {
          if (defaultBranchInfo && !defaultBranchInfo.isOnDefault) {
            setError(`Repository is on branch "${defaultBranchInfo.currentBranch}", not the default branch "${defaultBranchInfo.defaultBranch}".`);
            return;
          }
          cwd = `${basePath}/${org}/${name}`;
          break;
        }
        case 'existing': {
          if (selectedWorktreeIndex === null) return;
          const wt = filteredWorktrees[selectedWorktreeIndex];
          if (!wt) return;
          cwd = wt.path;
          break;
        }
        case 'pr': {
          if (selectedPRIndex === null) return;
          const pr = pullRequests[selectedPRIndex];
          if (!pr) return;
          const result = await api.createWorktree(org, name, {
            branch: pr.headRefName,
            createNewBranch: false,
            prNumber: pr.number,
          });
          cwd = result.path;
          break;
        }
        case 'issue': {
          if (selectedIssueIndex === null) return;
          const issue = issues[selectedIssueIndex];
          if (!issue) return;
          const sanitizedTitle = issue.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
          const branchName = `issue-${issue.number}/${sanitizedTitle}`;
          const result = await api.createWorktree(org, name, {
            branch: branchName,
            createNewBranch: true,
            issueNumber: issue.number,
          });
          cwd = result.path;
          break;
        }
        case 'new': {
          const result = await api.createWorktree(org, name, {
            branch: newBranchName.trim(),
            createNewBranch: true,
          });
          cwd = result.path;
          break;
        }
      }

      // Create shell session
      const shellSession = await api.createSession({ cwd, type: 'shell' });
      addSession(shellSession);

      // Create claude session
      const claudeSession = await api.createSession({
        cwd,
        type: 'claude',
        claudePrompt: claudePrompt.trim() || undefined,
      });
      addSession(claudeSession);

      // Select the claude session by default
      selectSession(claudeSession.id);

      // Refresh session groups
      api.fetchSessionGroups().then(setSessionGroups).catch(() => {});

      closeModal();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sessions');
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setSelectedRepo('');
    setWorktreeMode('main');
    setSelectedWorktreeIndex(null);
    setSelectedPRIndex(null);
    setSelectedIssueIndex(null);
    setNewBranchName('');
    setClaudePrompt('');
    setError('');
    setPullRequests([]);
    setIssues([]);
    setDefaultBranchInfo(null);
    setDiffStatsByBranch({});
  };

  const handleClose = () => {
    closeModal();
    resetForm();
  };

  const modes: { value: WorktreeMode; label: string }[] = [
    { value: 'main', label: 'Main' },
    { value: 'existing', label: 'Existing' },
    { value: 'pr', label: 'From PR' },
    { value: 'issue', label: 'From Issue' },
    { value: 'new', label: 'New' },
  ];

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-5xl">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">New Sessions</h2>

      <div className="flex flex-col gap-4">
        {/* Repository */}
        <Autocomplete
          id="repo"
          label="Repository"
          options={repoOptions}
          value={selectedRepo}
          onChange={setSelectedRepo}
          placeholder="Search repository..."
          autoFocus={open}
        />

        {/* Worktree mode segmented control */}
        {selectedRepo && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">Worktree</span>
            <div className="flex gap-1 rounded-md bg-zinc-800 p-0.5">
              {modes.map((mode) => (
                <button
                  key={mode.value}
                  className={cn(
                    'flex-1 rounded px-3 py-1 text-sm font-medium transition-colors',
                    worktreeMode === mode.value
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-zinc-400 hover:text-zinc-300'
                  )}
                  onClick={() => setWorktreeMode(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mode-specific content */}
        {selectedRepo && worktreeMode === 'main' && defaultBranchInfo && (
          <div className={cn(
            'rounded-md border px-3 py-2 text-sm',
            defaultBranchInfo.isOnDefault
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          )}>
            {defaultBranchInfo.isOnDefault
              ? `On default branch "${defaultBranchInfo.defaultBranch}"`
              : `Not on default branch. Currently on "${defaultBranchInfo.currentBranch}" (default: "${defaultBranchInfo.defaultBranch}")`
            }
          </div>
        )}

        {selectedRepo && worktreeMode === 'existing' && (
          <DataTable
            columns={worktreeColumns}
            data={filteredWorktrees}
            selectedIndex={selectedWorktreeIndex}
            onSelect={setSelectedWorktreeIndex}
            emptyMessage="No worktrees found"
          />
        )}

        {selectedRepo && worktreeMode === 'pr' && (
          <DataTable
            columns={prColumns}
            data={pullRequests}
            selectedIndex={selectedPRIndex}
            onSelect={setSelectedPRIndex}
            loading={loadingPRs}
            emptyMessage="No open pull requests"
          />
        )}

        {selectedRepo && worktreeMode === 'issue' && (
          <DataTable
            columns={issueColumns}
            data={issues}
            selectedIndex={selectedIssueIndex}
            onSelect={setSelectedIssueIndex}
            loading={loadingIssues}
            emptyMessage="No open issues assigned to you"
          />
        )}

        {selectedRepo && worktreeMode === 'new' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="branch-name" className="text-xs font-medium text-zinc-400">
              Branch name
            </label>
            <input
              id="branch-name"
              type="text"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="feature/my-branch"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
            />
          </div>
        )}

        {/* Claude prompt — visible after repo selection */}
        {selectedRepo && (
          <div className="flex flex-col gap-1">
            <label htmlFor="prompt" className="text-xs font-medium text-zinc-400">
              Claude prompt (optional)
            </label>
            <textarea
              id="prompt"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]"
              rows={3}
              placeholder="Enter a prompt for Claude..."
              value={claudePrompt}
              onChange={(e) => setClaudePrompt(e.target.value)}
            />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={isCreateDisabled()}
        >
          {creating ? 'Creating...' : 'Create Sessions'}
        </Button>
      </div>
    </Modal>
  );
}
