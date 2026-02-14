import { useCallback } from 'react';
import type { Session } from '@asm/shared';
import type { OfficeSelection, OfficeMapModel } from './types';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import * as api from '../../services/api';

interface UseOfficeActionsOptions {
  selection: OfficeSelection;
  sessions: Session[];
  mapModel: OfficeMapModel;
  onFocusSession: (sessionId: string) => void;
  onToast?: (message: string) => void;
}

export function useOfficeActions({
  selection,
  sessions,
  mapModel,
  onFocusSession,
  onToast,
}: UseOfficeActionsOptions) {
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const openCreateModal = useUIStore((s) => s.openCreateModal);

  const focusSession = useCallback(() => {
    if (selection?.type === 'session') {
      onFocusSession(selection.sessionId);
    }
  }, [selection, onFocusSession]);

  const killSession = useCallback(async () => {
    if (selection?.type !== 'session') return;
    if (!confirm('Kill this session?')) return;
    try {
      await api.killSession(selection.sessionId);
    } catch {
      onToast?.('Failed to kill session');
    }
  }, [selection, onToast]);

  const getWorktreeCwd = useCallback(() => {
    if (selection?.type !== 'worktree') return '~';
    const deskObj = mapModel.objects.find(
      (o) =>
        o.type === 'desk' &&
        o.binding?.type === 'worktree' &&
        o.binding.repoKey === selection.repoKey &&
        o.binding.branch === selection.branch,
    );
    return deskObj?.binding?.type === 'worktree' ? deskObj.binding.path : '~';
  }, [selection, mapModel.objects]);

  const createShell = useCallback(async () => {
    if (selection?.type !== 'worktree') return;
    try {
      const session = await api.createSession({ cwd: getWorktreeCwd(), type: 'shell' });
      addSession(session);
      const groups = await api.fetchSessionGroups();
      setSessionGroups(groups);
    } catch {
      onToast?.('Failed to create shell session');
    }
  }, [selection, getWorktreeCwd, addSession, setSessionGroups, onToast]);

  const createClaude = useCallback(async () => {
    if (selection?.type !== 'worktree') return;
    try {
      const session = await api.createSession({ cwd: getWorktreeCwd(), type: 'claude' });
      addSession(session);
      const groups = await api.fetchSessionGroups();
      setSessionGroups(groups);
    } catch {
      onToast?.('Failed to create Claude session');
    }
  }, [selection, getWorktreeCwd, addSession, setSessionGroups, onToast]);

  const killWorktreeShell = useCallback(async () => {
    if (selection?.type !== 'worktree') return;
    const shell = sessions.find(
      (s) => s.type === 'shell' &&
        s.worktreeBranch === selection.branch &&
        `${s.repositoryOrg}/${s.repositoryName}` === selection.repoKey,
    );
    if (!shell) {
      onToast?.('No shell session on this desk');
      return;
    }
    if (!confirm(`Kill shell session "${shell.tmuxName}"?`)) return;
    try {
      await api.killSession(shell.id);
    } catch {
      onToast?.('Failed to kill session');
    }
  }, [selection, sessions, onToast]);

  const openPR = useCallback(() => {
    if (selection?.type !== 'worktree') return;
    const [org, name] = selection.repoKey.split('/');
    window.open(`https://github.com/${org}/${name}/compare/${selection.branch}`, '_blank');
  }, [selection]);

  const openDashboard = useCallback(() => {
    if (selection?.type !== 'repo') return;
    useUIStore.getState().selectRepo(selection.repoKey);
    setActivePanel('repositories');
  }, [selection, setActivePanel]);

  const refreshRepo = useCallback(() => {
    if (selection?.type !== 'repo') return;
    const [org, name] = selection.repoKey.split('/');
    api.requestRepositoryRefresh('repo', org, name).catch(() => {
      onToast?.('Failed to refresh repository');
    });
  }, [selection, onToast]);

  const openScratchpad = useCallback(() => {
    useUIStore.getState().toggleScratchpad();
  }, []);

  return {
    focusSession,
    killSession,
    killWorktreeShell,
    createShell,
    createClaude,
    openPR,
    openDashboard,
    refreshRepo,
    openCreateModal,
    openScratchpad,
  };
}

/** Map hotkeys to actions based on current selection type */
export function getHotkeyMap(
  selection: OfficeSelection,
  actions: ReturnType<typeof useOfficeActions>,
): Record<string, () => void> {
  if (!selection) return {};

  switch (selection.type) {
    case 'session':
      return {
        s: actions.focusSession,
        k: actions.killSession,
      };
    case 'worktree':
      return {
        n: actions.createShell,
        c: actions.createClaude,
        k: actions.killWorktreeShell,
        g: actions.openPR,
        p: actions.openScratchpad,
      };
    case 'repo':
      return {
        d: actions.openDashboard,
        r: actions.refreshRepo,
        n: actions.openCreateModal,
        p: actions.openScratchpad,
      };
    default:
      return {};
  }
}
