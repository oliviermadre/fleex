import { useEffect, useMemo } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useClaudeConfigStore } from '../stores/claudeConfigStore';
import { useScratchpadStore } from '../stores/scratchpadStore';
import * as api from '../services/api';
import { SYSTEM_GROUP_ID } from '../components/sidebar/SystemGroup';

const GROUP_PREFIX = 'group:';

export function useKeyboardShortcuts() {
  const toggleNav = useUIStore((s) => s.toggleNav);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const selectSession = useSessionStore((s) => s.selectSession);
  const selectGroup = useSessionStore((s) => s.selectGroup);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const closeSplit = useSessionStore((s) => s.closeSplit);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
  const activePanel = useUIStore((s) => s.activePanel);
  const claudeConfigSaveFile = useClaudeConfigStore((s) => s.saveFile);
  const scratchpadOpen = useUIStore((s) => s.scratchpadOpen);
  const togglePreview = useScratchpadStore((s) => s.togglePreview);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const worktreeOrder = useSettingsStore((s) => s.settings.worktreeOrder);
  const sessionOrder = useSettingsStore((s) => s.settings.sessionOrder);
  const layoutGroups = useSettingsStore((s) => s.settings.sessionLayoutGroups);

  // Build a flat list of session IDs in visual (sidebar) order,
  // respecting system group first, then repo order, worktree order, and session order.
  // Layout groups are appended at the end with a 'group:' prefix.
  const orderedNavIds = useMemo(() => {
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

    // Append layout groups
    for (const lg of layoutGroups) {
      ids.push(`${GROUP_PREFIX}${lg.id}`);
    }

    return ids;
  }, [sessionGroups, repoOrder, worktreeOrder, sessionOrder, layoutGroups]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Alt+Shift+P: toggle scratchpad panel
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyP') {
        e.preventDefault();
        toggleScratchpad();
        return;
      }

      // Alt+Shift+V: toggle scratchpad preview (when panel is open)
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyV') {
        e.preventDefault();
        if (scratchpadOpen) togglePreview();
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
          setActivePanel('tickets');
          return;
        }
        if (e.code === 'Digit4') {
          e.preventDefault();
          setActivePanel('claude-config');
          return;
        }
        if (e.code === 'Digit6') {
          e.preventDefault();
          setActivePanel('scratchpads');
          return;
        }
        if (e.code === 'Digit7') {
          e.preventDefault();
          setActivePanel('cluster');
          return;
        }
        if (e.code === 'Digit0') {
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

      // Cmd+K: open command palette
      if (meta && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
        return;
      }

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

      // Cmd+Shift+Left/Right: cycle focus in grouped panes
      if (meta && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selectedGroupId) {
        e.preventDefault();
        const group = layoutGroups.find((g) => g.id === selectedGroupId);
        if (group) {
          const cellCount = group.type === '1x2' ? 2 : 4;
          if (e.key === 'ArrowRight') {
            const next = activeGroupCellIndex === null ? 0 : (activeGroupCellIndex + 1) % cellCount;
            setActiveGroupCellIndex(next);
          } else {
            const prev = activeGroupCellIndex === null ? cellCount - 1 : (activeGroupCellIndex - 1 + cellCount) % cellCount;
            setActiveGroupCellIndex(prev);
          }
        }
        return;
      }

      // Cmd+Shift+Left/Right: toggle focus between split panes
      if (meta && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && splitSessionId) {
        e.preventDefault();
        setFocusedPane(focusedPane === 'primary' ? 'split' : 'primary');
        return;
      }

      // Cmd+Shift+Up/Down: navigate sessions and groups (selectSession exits split)
      if (meta && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (orderedNavIds.length === 0) return;

        // Determine current position in the navigation list
        let currentIndex: number;
        if (selectedGroupId) {
          currentIndex = orderedNavIds.indexOf(`${GROUP_PREFIX}${selectedGroupId}`);
        } else if (selectedSessionId) {
          currentIndex = orderedNavIds.indexOf(selectedSessionId);
        } else {
          currentIndex = -1;
        }

        let nextIndex: number;
        if (e.key === 'ArrowUp') {
          nextIndex = currentIndex <= 0 ? orderedNavIds.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex >= orderedNavIds.length - 1 ? 0 : currentIndex + 1;
        }

        const nextId = orderedNavIds[nextIndex];
        if (nextId) {
          if (nextId.startsWith(GROUP_PREFIX)) {
            selectGroup(nextId.slice(GROUP_PREFIX.length));
          } else {
            selectSession(nextId);
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleNav, openCreateModal, openCommandPalette, setActivePanel, toggleScratchpad, scratchpadOpen, togglePreview, activePanel, claudeConfigSaveFile, orderedNavIds, selectedSessionId, selectedGroupId, splitSessionId, focusedPane, selectSession, selectGroup, closeSplit, setFocusedPane, activeGroupCellIndex, setActiveGroupCellIndex, layoutGroups, basePath, addSession, setSessionGroups]);
}
