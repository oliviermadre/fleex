import { useEffect, useMemo } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useClaudeConfigStore } from '../stores/claudeConfigStore';
import { useScratchpadStore } from '../stores/scratchpadStore';
import * as api from '../services/api';
import { SYSTEM_GROUP_ID } from '../components/sidebar/SystemGroup';

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
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const closeSplit = useSessionStore((s) => s.closeSplit);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
  const activePanel = useUIStore((s) => s.activePanel);
  const lastActiveTabByWorktree = useUIStore((s) => s.lastActiveTabByWorktree);
  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const setSelectedAgentWorktreeTicketId = useUIStore((s) => s.setSelectedAgentWorktreeTicketId);
  const claudeConfigSaveFile = useClaudeConfigStore((s) => s.saveFile);
  const scratchpadOpen = useUIStore((s) => s.scratchpadOpen);
  const togglePreview = useScratchpadStore((s) => s.togglePreview);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const repoOrder = useSettingsStore((s) => s.settings.repoOrder);
  const worktreeOrder = useSettingsStore((s) => s.settings.worktreeOrder);
  const sessionOrder = useSettingsStore((s) => s.settings.sessionOrder);
  const layoutGroups = useSettingsStore((s) => s.settings.sessionLayoutGroups);

  // Build a flat list of worktrees in visual (sidebar) order.
  // Each entry has a key (for lastActiveTabByWorktree) and session IDs in tab bar order.
  // System "Shells" worktree comes first, then repo worktrees in sidebar order.
  const orderedWorktrees = useMemo(() => {
    const entries: Array<{ key: string; sessions: string[]; agentTicketId?: string }> = [];

    // System sessions first (ungrouped)
    const systemGroup = sessionGroups.find(
      (g) => g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped'
    );
    if (systemGroup) {
      const allSystemSessions = systemGroup.worktrees.flatMap((wt) => wt.sessions);
      const sysSessOrder = sessionOrder[SYSTEM_GROUP_ID];
      const sortedSystemSessions = sysSessOrder && sysSessOrder.length > 0
        ? [...allSystemSessions].sort((a, b) => {
            const orderMap = new Map(sysSessOrder.map((id, i) => [id, i]));
            return (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity);
          })
        : allSystemSessions;
      if (sortedSystemSessions.length > 0) {
        entries.push({ key: SYSTEM_GROUP_ID, sessions: sortedSystemSessions.map((s) => s.id) });
      }
    }

    // Repo groups in sidebar order
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
        : [...group.worktrees].sort((a, b) => a.branch.toLowerCase().localeCompare(b.branch.toLowerCase()));

      for (const wt of sortedWts) {
        const wtGroupId = `${repoId}:${wt.branch}`;
        const sessOrder = sessionOrder[wtGroupId];
        const sortedSessions = sessOrder && sessOrder.length > 0
          ? [...wt.sessions].sort((a, b) => {
              const orderMap = new Map(sessOrder.map((id, i) => [id, i]));
              return (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity);
            })
          : wt.sessions;
        if (sortedSessions.length > 0 || wt.agentWorktree) {
          entries.push({ key: wtGroupId, sessions: sortedSessions.map((s) => s.id), agentTicketId: wt.agentWorktree?.ticketId });
        }
      }
    }

    return entries;
  }, [sessionGroups, repoOrder, worktreeOrder, sessionOrder]);

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
        // Alt+T: new system shell session
        if (e.code === 'KeyT') {
          e.preventDefault();
          const cwd = basePath || '~';
          api.createSession({ cwd, type: 'shell' }).then((session) => {
            addSessionToGroup(session);
            selectSession(session.id);
            api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
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

      // Cmd+Shift+N: open "New Session" modal
      if (meta && e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        openCreateModal();
        return;
      }

      // Cmd+N: new tab in current worktree (if tab bar visible)
      if (meta && !e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('fleex:new-tab'));
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

      // Cmd+Shift+Left/Right: navigate sessions within the current worktree (tab bar order, loops)
      if (meta && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selectedSessionId) {
        e.preventDefault();
        const currentWorktree = orderedWorktrees.find((wt) => wt.sessions.includes(selectedSessionId));
        if (currentWorktree && currentWorktree.sessions.length > 1) {
          const currentIdx = currentWorktree.sessions.indexOf(selectedSessionId);
          const nextIdx = e.key === 'ArrowLeft'
            ? (currentIdx - 1 + currentWorktree.sessions.length) % currentWorktree.sessions.length
            : (currentIdx + 1) % currentWorktree.sessions.length;
          const nextId = currentWorktree.sessions[nextIdx];
          if (nextId) selectSession(nextId);
        }
        return;
      }

      // Cmd+Shift+Up/Down: navigate between worktrees (sidebar order, including system "Shells")
      if (meta && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (orderedWorktrees.length === 0) return;

        // Find current worktree index by the selected session or agent worktree
        let currentIndex = selectedSessionId
          ? orderedWorktrees.findIndex((wt) => wt.sessions.includes(selectedSessionId))
          : -1;
        if (currentIndex === -1 && selectedAgentWorktreeTicketId) {
          currentIndex = orderedWorktrees.findIndex((wt) => wt.agentTicketId === selectedAgentWorktreeTicketId);
        }

        const nextIndex = e.key === 'ArrowUp'
          ? (currentIndex <= 0 ? orderedWorktrees.length - 1 : currentIndex - 1)
          : (currentIndex >= orderedWorktrees.length - 1 ? 0 : currentIndex + 1);

        const nextWorktree = orderedWorktrees[nextIndex];
        if (nextWorktree) {
          if (nextWorktree.agentTicketId) {
            // Agent worktree → open agent panel (same as sidebar click)
            selectSession(null);
            setSelectedAgentWorktreeTicketId(nextWorktree.agentTicketId);
          } else if (nextWorktree.sessions.length > 0) {
            // Regular worktree → select session
            const lastActive = lastActiveTabByWorktree[nextWorktree.key];
            const targetId = (lastActive && nextWorktree.sessions.includes(lastActive))
              ? lastActive
              : nextWorktree.sessions[0];
            if (targetId) {
              if (selectedAgentWorktreeTicketId) setSelectedAgentWorktreeTicketId(null);
              selectSession(targetId);
            }
          }
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleNav, openCreateModal, openCommandPalette, setActivePanel, toggleScratchpad, scratchpadOpen, togglePreview, activePanel, claudeConfigSaveFile, orderedWorktrees, lastActiveTabByWorktree, selectedSessionId, selectedAgentWorktreeTicketId, setSelectedAgentWorktreeTicketId, selectedGroupId, splitSessionId, focusedPane, selectSession, closeSplit, setFocusedPane, activeGroupCellIndex, setActiveGroupCellIndex, layoutGroups, basePath, addSessionToGroup, setSessionGroups]);
}
