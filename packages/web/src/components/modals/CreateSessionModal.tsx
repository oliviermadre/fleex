import { useState, useEffect, useCallback } from 'react';
import type { PullRequest, Worktree } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';

type WorktreeMode = 'main' | 'existing' | 'pr' | 'new';

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
  const [selectedWorktree, setSelectedWorktree] = useState('');
  const [selectedPR, setSelectedPR] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [claudePrompt, setClaudePrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [defaultBranchInfo, setDefaultBranchInfo] = useState<DefaultBranchInfo | null>(null);

  const worktrees: Worktree[] = selectedRepo ? (worktreesByRepo[selectedRepo] ?? []) : [];

  // Fetch worktrees + default branch info when repo changes
  useEffect(() => {
    if (!selectedRepo) return;
    const [org, name] = selectedRepo.split('/');
    if (!org || !name) return;

    setWorktreeMode('main');
    setSelectedWorktree('');
    setSelectedPR('');
    setNewBranchName('');
    setPullRequests([]);
    setDefaultBranchInfo(null);
    setError('');

    fetchWorktrees(org, name).catch(() => {});
    api.fetchDefaultBranch(org, name)
      .then(setDefaultBranchInfo)
      .catch(() => setDefaultBranchInfo(null));
  }, [selectedRepo, fetchWorktrees]);

  // Fetch PRs when switching to PR mode
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
    if (worktreeMode === 'pr') loadPRs();
  }, [worktreeMode, loadPRs]);

  const repoOptions = [
    { value: '', label: 'Select repository...' },
    ...resolvedRepositories.map((r) => ({ value: r, label: r })),
  ];

  const existingWorktreeOptions = [
    { value: '', label: 'Select worktree...' },
    ...worktrees.filter((w) => !w.isBare).map((w) => ({
      value: w.path,
      label: `${w.branch} (${w.path})`,
    })),
  ];

  const prOptions = [
    { value: '', label: loadingPRs ? 'Loading PRs...' : 'Select pull request...' },
    ...pullRequests.map((pr) => ({
      value: pr.headRefName,
      label: `#${pr.number} ${pr.title}`,
    })),
  ];

  const isCreateDisabled = (): boolean => {
    if (!selectedRepo || creating) return true;
    switch (worktreeMode) {
      case 'main':
        return defaultBranchInfo !== null && !defaultBranchInfo.isOnDefault;
      case 'existing':
        return !selectedWorktree;
      case 'pr':
        return !selectedPR;
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
          cwd = selectedWorktree;
          break;
        }
        case 'pr': {
          const result = await api.createWorktree(org, name, {
            branch: selectedPR,
            createNewBranch: false,
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
    setSelectedWorktree('');
    setSelectedPR('');
    setNewBranchName('');
    setClaudePrompt('');
    setError('');
    setPullRequests([]);
    setDefaultBranchInfo(null);
  };

  const handleClose = () => {
    closeModal();
    resetForm();
  };

  const modes: { value: WorktreeMode; label: string }[] = [
    { value: 'main', label: 'Main' },
    { value: 'existing', label: 'Existing' },
    { value: 'pr', label: 'From PR' },
    { value: 'new', label: 'New' },
  ];

  return (
    <Modal open={open} onClose={handleClose}>
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">New Sessions</h2>

      <div className="flex flex-col gap-4">
        {/* Repository */}
        <Select
          id="repo"
          label="Repository"
          options={repoOptions}
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
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
          <Select
            id="worktree"
            label="Existing worktree"
            options={existingWorktreeOptions}
            value={selectedWorktree}
            onChange={(e) => setSelectedWorktree(e.target.value)}
          />
        )}

        {selectedRepo && worktreeMode === 'pr' && (
          <Select
            id="pr"
            label="Pull Request"
            options={prOptions}
            value={selectedPR}
            onChange={(e) => setSelectedPR(e.target.value)}
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

        {/* Claude prompt — always visible */}
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
