import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { buildWorktreeContext } from '../../lib/templateUtils';
import { renderIcon } from '../sidebar/PinnedIcons';
import { ClaudeIcon, TerminalIcon, PlusIcon } from '../sidebar/icons';
import * as api from '../../services/api';
import type { CommandItem } from './commandPaletteTypes';

export function useCommandItems(query: string): CommandItem[] {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const selectSession = useSessionStore((s) => s.selectSession);
  const selectGroup = useSessionStore((s) => s.selectGroup);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);

  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);

  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const worktreeActions = useSettingsStore((s) => s.settings.worktreeActions);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const addLayoutGroup = useSettingsStore((s) => s.addLayoutGroup);
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);
  const executeWorktreeAction = useSettingsStore((s) => s.executeWorktreeAction);
  const sessionDisplayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);

  const ticketItems = useTicketStore((s) => s.tickets);
  const selectTicket = useTicketStore((s) => s.selectTicket);

  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // ── Sessions ──
    for (const session of sessions) {
      const displayName = sessionDisplayNames[session.id];
      const descParts = [session.repositoryName, session.worktreeBranch].filter(Boolean);
      const description = descParts.length > 0 ? descParts.join(' · ') : undefined;
      items.push({
        id: `session:${session.id}`,
        label: displayName || session.tmuxName,
        description,
        category: 'session',
        categoryLabel: 'Sessions',
        icon: session.type === 'claude'
          ? ClaudeIcon({ size: 16, className: 'text-[var(--theme-text-secondary)]' })
          : TerminalIcon({ size: 16, className: 'text-[var(--theme-text-secondary)]' }),
        keywords: [session.tmuxName, displayName, session.repositoryName, session.worktreeBranch].filter(Boolean).join(' '),
        onExecute: () => { setActivePanel('sessions'); selectSession(session.id); closeCommandPalette(); },
      });
    }

    // ── Views ──
    const views: { panel: 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'cluster' | 'settings'; label: string }[] = [
      { panel: 'sessions', label: 'Sessions' },
      { panel: 'repositories', label: 'Repositories' },
      { panel: 'tickets', label: 'Tickets' },
      { panel: 'claude-config', label: 'Claude Config' },
      { panel: 'cluster', label: 'Cluster' },
      { panel: 'settings', label: 'Settings' },
    ];
    for (const view of views) {
      items.push({
        id: `view:${view.panel}`,
        label: `Go to ${view.label}`,
        category: 'view',
        categoryLabel: 'Views',
        icon: getViewIcon(view.panel),
        keywords: view.panel,
        onExecute: () => { setActivePanel(view.panel); closeCommandPalette(); },
      });
    }

    // ── Create actions ──
    items.push({
      id: 'create:session',
      label: 'Create new session',
      category: 'create',
      categoryLabel: 'Create',
      icon: PlusIcon({ size: 16, className: 'text-[var(--theme-text-secondary)]' }),
      onExecute: () => { openCreateModal(); closeCommandPalette(); },
    });

    items.push({
      id: 'create:group-1x2',
      label: 'Create group (1x2 side-by-side)',
      category: 'create',
      categoryLabel: 'Create',
      icon: getGridIcon('1x2'),
      onExecute: () => {
        const id = addLayoutGroup('1x2');
        selectGroup(id);
        closeCommandPalette();
      },
    });

    items.push({
      id: 'create:group-2x2',
      label: 'Create group (2x2 grid)',
      category: 'create',
      categoryLabel: 'Create',
      icon: getGridIcon('2x2'),
      onExecute: () => {
        const id = addLayoutGroup('2x2');
        selectGroup(id);
        closeCommandPalette();
      },
    });

    items.push({
      id: 'create:shell',
      label: 'New system shell',
      category: 'create',
      categoryLabel: 'Create',
      icon: TerminalIcon({ size: 16, className: 'text-[var(--theme-text-secondary)]' }),
      keywords: 'terminal bash zsh',
      onExecute: () => {
        const cwd = basePath || '~';
        api.createSession({ cwd, type: 'shell' }).then((session) => {
          addSession(session);
          selectSession(session.id);
          api.fetchSessionGroups().then((groups) => setSessionGroups(groups));
        }).catch(() => { /* silently fail */ });
        closeCommandPalette();
      },
    });

    // ── Pinned actions ──
    for (const icon of pinnedIcons) {
      items.push({
        id: `pinned:${icon.id}`,
        label: icon.label,
        category: 'pinned',
        categoryLabel: 'Pinned Actions',
        icon: renderIcon(icon, 16),
        onExecute: () => { executePinnedAction(icon); closeCommandPalette(); },
      });
    }

    // ── Worktree actions (conditional) ──
    if (worktreeActions.length > 0 && selectedSessionId) {
      const selectedSession = sessions.find((s) => s.id === selectedSessionId);
      if (selectedSession?.repositoryOrg && selectedSession.repositoryName && selectedSession.worktreeBranch) {
        // Find the worktree path from sessionGroups
        let worktreePath = '';
        for (const group of sessionGroups) {
          if (group.repositoryOrg === selectedSession.repositoryOrg && group.repositoryName === selectedSession.repositoryName) {
            for (const wt of group.worktrees) {
              if (wt.branch === selectedSession.worktreeBranch) {
                worktreePath = wt.path;
                break;
              }
            }
          }
        }

        const context = buildWorktreeContext(
          selectedSession.repositoryOrg,
          selectedSession.repositoryName,
          selectedSession.worktreeBranch,
          worktreePath,
        );

        for (const action of worktreeActions) {
          items.push({
            id: `worktree:${action.id}`,
            label: action.label,
            category: 'worktree',
            categoryLabel: 'Worktree Actions',
            icon: action.icon ? renderIcon(action, 16) : null,
            keywords: `worktree ${selectedSession.worktreeBranch}`,
            onExecute: () => { executeWorktreeAction(action, context); closeCommandPalette(); },
          });
        }
      }
    }

    // ── Ticket items ──
    items.push({
      id: 'ticket:create',
      label: 'Create new ticket',
      category: 'ticket',
      categoryLabel: 'Tickets',
      icon: getTicketIcon(),
      keywords: 'ticket task kanban',
      onExecute: () => { setActivePanel('tickets'); closeCommandPalette(); },
    });

    items.push({
      id: 'ticket:board',
      label: 'Open kanban board',
      category: 'ticket',
      categoryLabel: 'Tickets',
      icon: getTicketIcon(),
      keywords: 'kanban board tickets',
      onExecute: () => { setActivePanel('tickets'); selectTicket(null); closeCommandPalette(); },
    });

    for (const ticket of ticketItems) {
      items.push({
        id: `ticket:${ticket.id}`,
        label: ticket.title,
        description: `${ticket.status}${ticket.tags.length > 0 ? ' · ' + ticket.tags.join(', ') : ''}`,
        category: 'ticket',
        categoryLabel: 'Tickets',
        icon: getTicketIcon(),
        keywords: `ticket ${ticket.title} ${ticket.tags.join(' ')} ${ticket.status}`,
        onExecute: () => { setActivePanel('tickets'); selectTicket(ticket.id); closeCommandPalette(); },
      });
    }

    // ── Misc actions ──
    items.push({
      id: 'action:scratchpad',
      label: 'Toggle scratchpad',
      category: 'action',
      categoryLabel: 'Actions',
      icon: getScratchpadIcon(),
      keywords: 'notepad notes',
      onExecute: () => { toggleScratchpad(); closeCommandPalette(); },
    });

    return items;
  }, [
    sessions, sessionGroups, selectedSessionId, sessionDisplayNames,
    selectSession, selectGroup, setActivePanel, openCreateModal, closeCommandPalette,
    toggleScratchpad, pinnedIcons, worktreeActions, basePath,
    addLayoutGroup, addSession, setSessionGroups,
    executePinnedAction, executeWorktreeAction,
    ticketItems, selectTicket,
  ]);

  // Filter by query
  return useMemo(() => {
    if (!query.trim()) return allItems;
    const lowerQuery = query.toLowerCase();
    return allItems.filter((item) => {
      return (
        item.label.toLowerCase().includes(lowerQuery) ||
        item.categoryLabel.toLowerCase().includes(lowerQuery) ||
        (item.keywords && item.keywords.toLowerCase().includes(lowerQuery))
      );
    });
  }, [allItems, query]);
}

// ── Icon helpers ──

function getViewIcon(panel: string): React.ReactNode {
  switch (panel) {
    case 'sessions':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <polyline points="4.5,7 6,8.5 4.5,10" />
          <line x1="7.5" y1="10.5" x2="11" y2="10.5" />
        </svg>
      );
    case 'repositories':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="3.5" r="1.5" />
          <circle cx="11" cy="3.5" r="1.5" />
          <circle cx="8" cy="12.5" r="1.5" />
          <line x1="5" y1="5" x2="5" y2="7" />
          <line x1="11" y1="5" x2="11" y2="7" />
          <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
        </svg>
      );
    case 'claude-config':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
          <polyline points="9,1.5 9,5.5 13,5.5" />
          <line x1="5.5" y1="8.5" x2="10.5" y2="8.5" />
          <line x1="5.5" y1="11" x2="8.5" y2="11" />
        </svg>
      );
    case 'tickets':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2" width="4" height="12" rx="0.5" />
          <rect x="6" y="2" width="4" height="12" rx="0.5" />
          <rect x="10.5" y="2" width="4" height="12" rx="0.5" />
        </svg>
      );
    case 'cluster':
      return (
        <svg width="16" height="16" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
          <path d="M 168.04 317.81 C170.06,319.98 170.33,320.00 205.79,319.98 C225.43,319.98 242.00,319.64 242.60,319.23 C245.89,317.04 246.00,314.44 246.00,235.64 L 246.00 157.15 L 248.63 155.07 C251.11,153.12 252.53,153.00 272.63,153.00 C292.67,153.00 294.12,152.88 296.00,151.00 C297.92,149.08 298.00,147.67 298.00,116.50 C298.00,85.33 297.92,83.92 296.00,82.00 C294.04,80.04 292.67,80.00 232.04,80.00 L 170.08 80.00 L 168.04 82.19 C166.01,84.36 166.00,85.02 166.00,200.00 C166.00,314.98 166.01,315.64 168.04,317.81 ZM 80.27 151.29 L 82.05 154.00 L 115.02 154.00 C146.67,154.00 148.08,153.92 150.00,152.00 C151.92,150.08 152.00,148.67 152.00,117.19 C152.00,116.60 152.00,116.02 152.00,115.45 C152.00,89.30 152.00,82.71 149.14,81.05 C148.18,80.50 146.89,80.50 145.17,80.51 C145.06,80.51 144.95,80.51 144.83,80.51 C144.69,80.51 144.56,80.51 144.44,80.51 C144.12,80.51 143.84,80.50 143.55,80.52 C140.09,80.67 136.71,82.80 91.21,110.58 C83.01,115.58 79.73,118.16 79.21,119.98 C78.82,121.37 78.50,128.37 78.50,135.54 C78.50,146.34 78.80,149.05 80.27,151.29 Z" fill="rgb(48,178,75)"/>
          <path d="M 168.04 317.81 C166.01,315.64 166.00,314.98 166.00,200.00 C166.00,85.02 166.01,84.36 168.04,82.19 L 170.08 80.00 L 232.04 80.00 C292.67,80.00 294.04,80.04 296.00,82.00 C297.92,83.92 298.00,85.33 298.00,116.50 C298.00,147.67 297.92,149.08 296.00,151.00 C294.12,152.88 292.67,153.00 272.63,153.00 C252.53,153.00 251.11,153.12 248.63,155.07 L 246.00 157.15 L 246.00 235.64 C246.00,314.44 245.89,317.04 242.60,319.23 C242.00,319.64 225.43,319.98 205.79,319.98 C170.33,320.00 170.06,319.98 168.04,317.81 Z" fill="rgb(179,228,189)"/>
          <path d="M 80.27 151.29 C78.80,149.05 78.50,146.34 78.50,135.54 C78.50,128.37 78.82,121.37 79.21,119.98 C79.73,118.16 83.01,115.58 91.21,110.58 C142.02,79.55 140.30,80.52 144.83,80.51 C152.12,80.49 152.00,79.89 152.00,117.19 C152.00,148.67 151.92,150.08 150.00,152.00 C148.08,153.92 146.67,154.00 115.02,154.00 L 82.05 154.00 L 80.27 151.29 Z" fill="rgb(254,254,253)"/>
        </svg>
      );
    case 'settings':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.86 1.45h2.28l.34 1.7a5.2 5.2 0 0 1 1.16.67l1.62-.54 1.14 1.97-1.28 1.08c.04.22.06.44.06.67s-.02.45-.06.67l1.28 1.08-1.14 1.97-1.62-.54c-.35.27-.74.5-1.16.67l-.34 1.7H6.86l-.34-1.7a5.2 5.2 0 0 1-1.16-.67l-1.62.54-1.14-1.97 1.28-1.08A4.3 4.3 0 0 1 3.82 8c0-.23.02-.45.06-.67L2.6 6.25l1.14-1.97 1.62.54c.35-.27.74-.5 1.16-.67l.34-1.7z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    default:
      return null;
  }
}

function getGridIcon(type: '1x2' | '2x2'): React.ReactNode {
  if (type === '1x2') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        <line x1="8" y1="2.5" x2="8" y2="13.5" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" />
      <line x1="1.5" y1="8" x2="14.5" y2="8" />
    </svg>
  );
}

function getTicketIcon(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="5" y1="6" x2="11" y2="6" />
      <line x1="5" y1="8.5" x2="9" y2="8.5" />
      <line x1="5" y1="11" x2="7" y2="11" />
    </svg>
  );
}

function getScratchpadIcon(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <line x1="5.5" y1="5" x2="10.5" y2="5" />
      <line x1="5.5" y1="7.5" x2="10.5" y2="7.5" />
      <line x1="5.5" y1="10" x2="8.5" y2="10" />
    </svg>
  );
}
