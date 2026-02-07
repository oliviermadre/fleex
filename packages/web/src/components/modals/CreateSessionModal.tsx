import { useState, useEffect } from 'react';
import type { SessionType } from '@asm/shared';
import { useUIStore } from '../../stores/uiStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useSessionStore } from '../../stores/sessionStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';

export function CreateSessionModal() {
  const open = useUIStore((s) => s.createModalOpen);
  const closeModal = useUIStore((s) => s.closeCreateModal);

  const repositories = useRepositoryStore((s) => s.repositories);
  const branchesByRepo = useRepositoryStore((s) => s.branchesByRepo);
  const worktreesByRepo = useRepositoryStore((s) => s.worktreesByRepo);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);
  const fetchBranches = useRepositoryStore((s) => s.fetchBranches);
  const fetchWorktrees = useRepositoryStore((s) => s.fetchWorktrees);

  const selectSession = useSessionStore((s) => s.selectSession);
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);

  const [selectedRepo, setSelectedRepo] = useState('');
  const [sessionType, setSessionType] = useState<SessionType>('shell');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [worktreeStrategy, setWorktreeStrategy] = useState<'auto' | 'new' | 'reuse'>('auto');
  const [claudePrompt, setClaudePrompt] = useState('');
  const [creating, setCreating] = useState(false);

  // Fetch repos when modal opens
  useEffect(() => {
    if (open) {
      fetchRepositories().catch(() => {});
    }
  }, [open, fetchRepositories]);

  // Fetch branches and worktrees when repo selected
  useEffect(() => {
    if (!selectedRepo) return;
    const repo = repositories.find((r) => `${r.org}/${r.name}` === selectedRepo);
    if (!repo) return;
    fetchBranches(repo.org, repo.name).catch(() => {});
    fetchWorktrees(repo.org, repo.name).catch(() => {});
  }, [selectedRepo, repositories, fetchBranches, fetchWorktrees]);

  const repoOptions = [
    { value: '', label: 'Select repository...' },
    ...repositories.map((r) => ({
      value: `${r.org}/${r.name}`,
      label: `${r.org}/${r.name}`,
    })),
  ];

  const branches = selectedRepo ? (branchesByRepo[selectedRepo] ?? []) : [];
  const branchOptions = [
    { value: '', label: 'Select branch...' },
    ...branches.map((b) => ({ value: b, label: b })),
  ];

  const worktrees = selectedRepo ? (worktreesByRepo[selectedRepo] ?? []) : [];
  const worktreeOptions = [
    { value: 'auto', label: 'Auto (use existing or create)' },
    { value: 'new', label: 'Create new worktree' },
    ...worktrees.map((w) => ({
      value: w.path,
      label: `Reuse: ${w.branch} (${w.path})`,
    })),
  ];

  const handleCreate = async () => {
    if (!selectedRepo) return;

    setCreating(true);
    try {
      const repo = repositories.find((r) => `${r.org}/${r.name}` === selectedRepo);
      if (!repo) return;

      // Determine CWD based on worktree strategy
      let cwd = repo.path;

      if (worktreeStrategy === 'reuse') {
        // Selected an existing worktree path
        const wt = worktrees.find((w) => w.path === selectedBranch || w.branch === selectedBranch);
        if (wt) cwd = wt.path;
      } else if (worktreeStrategy === 'new' && selectedBranch) {
        // Create new worktree for branch
        try {
          const newWt = await api.createWorktree(repo.org, repo.name, {
            branch: selectedBranch,
            createNewBranch: false,
          });
          cwd = newWt.path;
        } catch {
          // Fall back to repo path
        }
      } else if (worktreeStrategy === 'auto' && selectedBranch) {
        // Check if worktree exists for branch
        const existing = worktrees.find((w) => w.branch === selectedBranch);
        if (existing) {
          cwd = existing.path;
        } else {
          try {
            const newWt = await api.createWorktree(repo.org, repo.name, {
              branch: selectedBranch,
              createNewBranch: false,
            });
            cwd = newWt.path;
          } catch {
            // Fall back to repo path
          }
        }
      }

      const session = await api.createSession({
        cwd,
        type: sessionType,
        claudePrompt: sessionType === 'claude' && claudePrompt ? claudePrompt : undefined,
      });

      addSession(session);
      selectSession(session.id);

      // Refresh session groups so the sidebar updates immediately
      api.fetchSessionGroups().then(setSessionGroups).catch(() => {});

      closeModal();
      resetForm();
    } catch {
      // Error creating session
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setSelectedRepo('');
    setSessionType('shell');
    setSelectedBranch('');
    setWorktreeStrategy('auto');
    setClaudePrompt('');
  };

  const handleClose = () => {
    closeModal();
    resetForm();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">New Session</h2>

      <div className="flex flex-col gap-4">
        {/* Repository */}
        <Select
          id="repo"
          label="Repository"
          options={repoOptions}
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
        />

        {/* Session type toggle */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">Type</span>
          <div className="flex gap-1 rounded-md bg-zinc-800 p-0.5">
            <button
              className={cn(
                'flex-1 rounded px-3 py-1 text-sm font-medium transition-colors',
                sessionType === 'shell'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-zinc-400 hover:text-zinc-300'
              )}
              onClick={() => setSessionType('shell')}
            >
              Shell
            </button>
            <button
              className={cn(
                'flex-1 rounded px-3 py-1 text-sm font-medium transition-colors',
                sessionType === 'claude'
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'text-zinc-400 hover:text-zinc-300'
              )}
              onClick={() => setSessionType('claude')}
            >
              Claude Code
            </button>
          </div>
        </div>

        {/* Branch */}
        {selectedRepo && (
          <Select
            id="branch"
            label="Branch"
            options={branchOptions}
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
          />
        )}

        {/* Worktree strategy */}
        {selectedRepo && selectedBranch && (
          <Select
            id="worktree"
            label="Worktree Strategy"
            options={worktreeOptions}
            value={worktreeStrategy}
            onChange={(e) => setWorktreeStrategy(e.target.value as 'auto' | 'new' | 'reuse')}
          />
        )}

        {/* Claude prompt */}
        {sessionType === 'claude' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="prompt" className="text-xs font-medium text-zinc-400">
              Prompt (optional)
            </label>
            <textarea
              id="prompt"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              rows={3}
              placeholder="Enter a prompt for Claude..."
              value={claudePrompt}
              onChange={(e) => setClaudePrompt(e.target.value)}
            />
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
          disabled={!selectedRepo || creating}
        >
          {creating ? 'Creating...' : 'Create Session'}
        </Button>
      </div>
    </Modal>
  );
}
