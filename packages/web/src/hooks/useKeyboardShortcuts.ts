import { useEffect, useMemo } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useClaudeConfigStore } from '../stores/claudeConfigStore';
import * as api from '../services/api';
import { SYSTEM_GROUP_ID } from '../components/sidebar/SystemGroup';

export function useKeyboardShortcuts() {
  const toggleNav = useUIStore((s) => s.toggleNav);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const selectSession = useSessionStore((s) => s.selectSession);
  const closeSplit = useSessionStore((s) => s.closeSplit);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const activePanel = useUIStore((s) => s.activePanel);
  const claudeConfigSaveFile = useClaudeConfigStore((s) => s.saveFile);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const worktreeOrder = useSettingsStore((s) => s.settings.worktreeOrder);
  const sessionOrder = useSettingsStore((s) => s.settings.sessionOrder);

  // Build a flat list of session IDs in visual (sidebar) order,
  // respecting system group first, then repo order, worktree order, and session order.
  const orderedSessionIds = useMemo(() => {
    const ids: string[] = [];

    // System sessions first (ungrouped)
    const systemGroup = sessionGroups.find(
      (g) => g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped'
    );
    if (systemGroup) {
      const sysSessOrder = sessionOrder[SYSTEM_GROUP_ID];
      const allSystemSessions = systemGroup.worktrees.flatMap((wt) => wt.sessions);
      const sortedSystemSessions = sysSessOrder && sysSessOrder.length > 0
        ? [...allSystemSessions].sort((a, b) => {
            const orderMap = new Map(sysSessOrder.map((id, i) => [id, i]));
            return (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity);
          })
        : allSystemSessions;
      for (const s of sortedSystemSessions) {
        ids.push(s.id);
      }
    }

    // Repo groups
    const repoSessionGroups = sessionGroups.filter(
      (g) => !(g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped')
    );

    const sortedGroups = [...repoSessionGroups].sort((a, b) => {
      if (repoOrder.length === 0) return 0;
      const aId = `${a.repositoryOrg}/${a.repositoryName}`;
      const bId = `${b.repositoryOrg}/${b.repositoryName}`;
      const orderMap = new Map(repoOrder.map((id, i) => [id, i]));
      return (orderMap.get(aId) ?? Infinity) - (orderMap.get(bId) ?? Infinity);
    });

    for (const group of sortedGroups) {
      const repoId = `${group.repositoryOrg}/${group.repositoryName}`;
      const wtOrder = worktreeOrder[repoId];
      const sortedWts = wtOrder && wtOrder.length > 0
        ? [...group.worktrees].sort((a, b) => {
            const orderMap = new Map(wtOrder.map((id, i) => [id, i]));
            return (orderMap.get(a.branch) ?? Infinity) - (orderMap.get(b.branch) ?? Infinity);
          })
        : group.worktrees;

      for (const wt of sortedWts) {
        const wtGroupId = `${repoId}:${wt.branch}`;
        const sessOrder = sessionOrder[wtGroupId];
        const sortedSessions = sessOrder && sessOrder.length > 0
          ? [...wt.sessions].sort((a, b) => {
              const orderMap = new Map(sessOrder.map((id, i) => [id, i]));
              return (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity);
            })
          : wt.sessions;

        for (const s of sortedSessions) {
          ids.push(s.id);
        }
      }
    }
    return ids;
  }, [sessionGroups, repoOrder, worktreeOrder, sessionOrder]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Alt+Shift+P: toggle scratchpad panel
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyP') {
        e.preventDefault();
        toggleScratchpad();
        return;
      }

      // Alt-only combos (uses e.code for macOS Option key compatibility)
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (e.code === 'Digit1') {
          e.preventDefault();
          setActivePanel('sessions');
          return;
        }
        if (e.code === 'Digit2') {
          e.preventDefault();
          setActivePanel('repositories');
          return;
        }
        if (e.code === 'Digit3') {
          e.preventDefault();
          setActivePanel('claude-config');
          return;
        }
        if (e.code === 'Digit4') {
          e.preventDefault();
          setActivePanel('cluster');
          return;
        }
        if (e.code === 'Digit5') {
          e.preventDefault();
          setActivePanel('settings');
          return;
        }

        // Alt+T: new system shell session
        if (e.code === 'KeyT') {
          e.preventDefault();
          const cwd = basePath || '~';
          api.createSession({ cwd, type: 'shell' }).then((session) => {
            addSession(session);
            selectSession(session.id);
            api.fetchSessionGroups().then((groups) => setSessionGroups(groups));
          }).catch(() => { /* silently fail */ });
          return;
        }
      }

      const meta = e.metaKey || e.ctrlKey;

      // Cmd+S: save file in claude-config panel
      if (meta && e.key === 's') {
        if (activePanel === 'claude-config') {
          e.preventDefault();
          claudeConfigSaveFile();
          return;
        }
      }

      // Cmd+B: toggle nav sidebar
      if (meta && e.key === 'b') {
        e.preventDefault();
        toggleNav();
        return;
      }

      // Cmd+N / Option+Cmd+N: new session (use e.code so Option dead-key doesn't mask the key)
      if (meta && e.code === 'KeyN') {
        e.preventDefault();
        openCreateModal();
        return;
      }

      // Escape: close split view, keep focused pane's session
      if (e.key === 'Escape' && splitSessionId) {
        e.preventDefault();
        if (focusedPane === 'split' && splitSessionId) {
          // Promote split session to primary before closing
          selectSession(splitSessionId);
        } else {
          closeSplit();
        }
        return;
      }

      // Cmd+Shift+Left/Right: toggle focus between split panes
      if (meta && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && splitSessionId) {
        e.preventDefault();
        setFocusedPane(focusedPane === 'primary' ? 'split' : 'primary');
        return;
      }

      // Cmd+Shift+Up/Down: navigate sessions (selectSession exits split)
      if (meta && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (orderedSessionIds.length === 0) return;

        const currentIndex = selectedSessionId
          ? orderedSessionIds.indexOf(selectedSessionId)
          : -1;

        let nextIndex: number;
        if (e.key === 'ArrowUp') {
          nextIndex = currentIndex <= 0 ? orderedSessionIds.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex >= orderedSessionIds.length - 1 ? 0 : currentIndex + 1;
        }

        const nextId = orderedSessionIds[nextIndex];
        if (nextId) {
          selectSession(nextId);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleNav, openCreateModal, setActivePanel, toggleScratchpad, activePanel, claudeConfigSaveFile, orderedSessionIds, selectedSessionId, splitSessionId, focusedPane, selectSession, closeSplit, setFocusedPane, basePath, addSession, setSessionGroups]);
}
