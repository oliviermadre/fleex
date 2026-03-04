/**
 * RouterSync — bidirectional sync between URL and Zustand stores.
 *
 * URL → Store: on location change, parse URL and update stores.
 * Store → URL: on store change, compute expected URL and navigate(replace) if different.
 *
 * Navigation components should call navigate() for user-initiated actions.
 * RouterSync handles programmatic store changes (e.g. auto-select after session kill).
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUIStore, type SettingsTab } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useTicketStore } from '../stores/ticketStore';
import { useScratchpadStore } from '../stores/scratchpadStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';

type ActivePanel = 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'agents' | 'cluster' | 'settings' | 'scratchpads';

const VALID_SETTINGS_TABS: SettingsTab[] = [
  'general',
  'appearance',
  'repositories',
  'pinned-icons',
  'worktree-actions',
  'agent-tokens',
  'gateways',
];

// ─── URL → Store state ───────────────────────────────────────────────────────

type PersonaTab = 'config' | 'soul' | 'identity' | 'memory' | 'events';
const VALID_PERSONA_TABS: PersonaTab[] = ['config', 'soul', 'identity', 'memory', 'events'];

interface ParsedUrl {
  panel: ActivePanel;
  sessionId: string | null;
  splitId: string | null;
  groupId: string | null;
  repoKey: string | null;
  /** undefined = "no board preference in URL", null = "all boards", string = specific board */
  boardId: string | null | undefined;
  ticketId: string | null;
  scratchpadKey: string | null;
  personaId: string | null;
  personaTab: PersonaTab | null;
  settingsTab: SettingsTab | null;
  agentWorktreeTicketId: string | null;
  redirect?: string;
}

export function parseUrl(pathname: string, search: string): ParsedUrl {
  const params = new URLSearchParams(search);

  const base = { sessionId: null, splitId: null, groupId: null as string | null, repoKey: null, boardId: undefined as string | null | undefined, ticketId: null, scratchpadKey: null, personaId: null, personaTab: null as PersonaTab | null, settingsTab: null as SettingsTab | null, agentWorktreeTicketId: null as string | null };

  // Root: redirect to /sessions
  if (pathname === '/') {
    return { ...base, panel: 'sessions' as ActivePanel, redirect: '/sessions' };
  }

  // Agent worktree within sessions panel
  const agentWtMatch = pathname.match(/^\/sessions\/agent\/([^/]+)$/);
  if (agentWtMatch) {
    return { ...base, panel: 'sessions', agentWorktreeTicketId: agentWtMatch[1]! };
  }

  // Session layout groups
  const groupMatch = pathname.match(/^\/sessions\/group\/(.+)$/);
  if (groupMatch) {
    return { ...base, panel: 'sessions', groupId: groupMatch[1]! };
  }

  // Sessions
  const sessionsMatch = pathname.match(/^\/sessions(?:\/(.+))?$/);
  if (sessionsMatch) {
    const sessionId = sessionsMatch[1] ?? null;
    const splitId = sessionId ? (params.get('split') ?? null) : null;
    return { ...base, panel: 'sessions', sessionId, splitId };
  }

  // Repositories
  const reposMatch = pathname.match(/^\/repositories(?:\/([^/]+)\/([^/]+))?$/);
  if (reposMatch) {
    const repoKey = reposMatch[1] && reposMatch[2] ? `${reposMatch[1]}/${reposMatch[2]}` : null;
    return { ...base, panel: 'repositories', repoKey };
  }

  // Tickets — order matters: more specific patterns first
  const ticketBoardTicketMatch = pathname.match(/^\/tickets\/board\/([^/]+)\/ticket\/([^/]+)$/);
  if (ticketBoardTicketMatch) {
    return { ...base, panel: 'tickets', boardId: ticketBoardTicketMatch[1]!, ticketId: ticketBoardTicketMatch[2]! };
  }
  const ticketBoardMatch = pathname.match(/^\/tickets\/board\/([^/]+)$/);
  if (ticketBoardMatch) {
    const raw = ticketBoardMatch[1]!;
    return { ...base, panel: 'tickets', boardId: raw === 'all' ? null : raw };
  }
  if (pathname === '/tickets') {
    return { ...base, panel: 'tickets' };
  }

  // Claude Config
  if (pathname === '/claude-config') {
    return { ...base, panel: 'claude-config' };
  }

  // Agents — more specific patterns first
  const agentTabMatch = pathname.match(/^\/agents\/([^/]+)\/([^/]+)$/);
  if (agentTabMatch) {
    const personaId = agentTabMatch[1]!;
    const rawTab = agentTabMatch[2] as PersonaTab;
    const personaTab = VALID_PERSONA_TABS.includes(rawTab) ? rawTab : 'config';
    return { ...base, panel: 'agents', personaId, personaTab };
  }
  const agentMatch = pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    return { ...base, panel: 'agents', personaId: agentMatch[1]!, personaTab: 'config' };
  }
  if (pathname === '/agents') {
    return { ...base, panel: 'agents' };
  }

  // Cluster
  if (pathname === '/cluster') {
    return { ...base, panel: 'cluster' };
  }

  // Scratchpads
  if (pathname === '/scratchpads') {
    return { ...base, panel: 'scratchpads' };
  }
  if (pathname === '/scratchpads/global') {
    return { ...base, panel: 'scratchpads', scratchpadKey: '__global__' };
  }
  const scratchpadsMatch = pathname.match(/^\/scratchpads\/([^/]+)\/([^/]+)$/);
  if (scratchpadsMatch) {
    return { ...base, panel: 'scratchpads', scratchpadKey: `${scratchpadsMatch[1]}/${scratchpadsMatch[2]}` };
  }

  // Settings
  if (pathname === '/settings') {
    return { ...base, panel: 'settings' };
  }
  const settingsMatch = pathname.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    const rawTab = settingsMatch[1] as SettingsTab;
    if (VALID_SETTINGS_TABS.includes(rawTab)) {
      return { ...base, panel: 'settings', settingsTab: rawTab };
    }
    return { ...base, panel: 'settings', redirect: '/settings' };
  }

  // Unknown route → redirect to /sessions
  return { ...base, panel: 'sessions', redirect: '/sessions' };
}

// ─── Store state → URL ───────────────────────────────────────────────────────

export function storeToUrl(
  activePanel: ActivePanel,
  selectedSessionId: string | null,
  splitSessionId: string | null,
  selectedGroupId: string | null,
  selectedRepoKey: string | null,
  selectedBoardId: string | null,
  selectedTicketId: string | null,
  selectedScratchpadKey: string | null,
  selectedPersonaId: string | null,
  personaTab: PersonaTab,
  settingsTab: SettingsTab,
  selectedAgentWorktreeTicketId?: string | null,
): { pathname: string; search: string } {
  switch (activePanel) {
    case 'sessions': {
      if (selectedAgentWorktreeTicketId && !selectedSessionId) {
        return { pathname: `/sessions/agent/${selectedAgentWorktreeTicketId}`, search: '' };
      }
      if (selectedGroupId) {
        return { pathname: `/sessions/group/${selectedGroupId}`, search: '' };
      }
      if (selectedSessionId) {
        const search = splitSessionId ? `?split=${splitSessionId}` : '';
        return { pathname: `/sessions/${selectedSessionId}`, search };
      }
      return { pathname: '/sessions', search: '' };
    }
    case 'repositories': {
      if (selectedRepoKey) {
        return { pathname: `/repositories/${selectedRepoKey}`, search: '' };
      }
      return { pathname: '/repositories', search: '' };
    }
    case 'tickets': {
      if (selectedBoardId === null) {
        return { pathname: '/tickets/board/all', search: '' };
      }
      if (selectedBoardId) {
        if (selectedTicketId) {
          return { pathname: `/tickets/board/${selectedBoardId}/ticket/${selectedTicketId}`, search: '' };
        }
        return { pathname: `/tickets/board/${selectedBoardId}`, search: '' };
      }
      return { pathname: '/tickets', search: '' };
    }
    case 'claude-config':
      return { pathname: '/claude-config', search: '' };
    case 'agents': {
      if (selectedPersonaId) {
        if (personaTab !== 'config') {
          return { pathname: `/agents/${selectedPersonaId}/${personaTab}`, search: '' };
        }
        return { pathname: `/agents/${selectedPersonaId}`, search: '' };
      }
      return { pathname: '/agents', search: '' };
    }
    case 'cluster':
      return { pathname: '/cluster', search: '' };
    case 'scratchpads': {
      if (selectedScratchpadKey) {
        if (selectedScratchpadKey === '__global__') {
          return { pathname: '/scratchpads/global', search: '' };
        }
        return { pathname: `/scratchpads/${selectedScratchpadKey}`, search: '' };
      }
      return { pathname: '/scratchpads', search: '' };
    }
    case 'settings': {
      return { pathname: `/settings/${settingsTab}`, search: '' };
    }
  }
}

// ─── RouterSync component ─────────────────────────────────────────────────────

export function RouterSync() {
  const location = useLocation();
  const navigate = useNavigate();

  // Store accessors
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const selectRepo = useUIStore((s) => s.selectRepo);
  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const setSelectedAgentWorktreeTicketId = useUIStore((s) => s.setSelectedAgentWorktreeTicketId);

  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const selectGroup = useSessionStore((s) => s.selectGroup);
  const openSplit = useSessionStore((s) => s.openSplit);
  const closeSplit = useSessionStore((s) => s.closeSplit);

  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const selectTicket = useTicketStore((s) => s.selectTicket);

  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const setSelectedScratchpadKey = useScratchpadStore((s) => s.setSelectedScratchpadKey);
  const loadScratchpad = useScratchpadStore((s) => s.load);

  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const selectPersona = useAgentPersonaStore((s) => s.selectPersona);
  const personaTab = useAgentPersonaStore((s) => s.activeTab);
  const setPersonaTab = useAgentPersonaStore((s) => s.setActiveTab);

  // Track whether we're currently syncing from URL to prevent circular updates
  const syncingFromUrl = useRef(false);

  // ── URL → Store ───────────────────────────────────────────────────────────
  useEffect(() => {
    const parsed = parseUrl(location.pathname, location.search);

    if (parsed.redirect) {
      navigate(parsed.redirect, { replace: true });
      return;
    }

    syncingFromUrl.current = true;

    // Update panel
    if (parsed.panel !== activePanel) {
      setActivePanel(parsed.panel);
    }

    // Update session selection
    if (parsed.panel === 'sessions') {
      // Agent worktree view
      if (parsed.agentWorktreeTicketId !== selectedAgentWorktreeTicketId) {
        setSelectedAgentWorktreeTicketId(parsed.agentWorktreeTicketId);
      }
      if (parsed.agentWorktreeTicketId) {
        // Clear session selection when viewing agent worktree
        if (selectedSessionId) selectSession(null);
        syncingFromUrl.current = false;
        return;
      }

      // Group view
      if (parsed.groupId) {
        if (parsed.groupId !== selectedGroupId) {
          selectGroup(parsed.groupId);
        }
      } else {
        // Auto-restore last active session when navigating to /sessions with no session
        if (!parsed.sessionId) {
          const lastActiveSessionId = useUIStore.getState().lastActiveSessionId;
          if (lastActiveSessionId) {
            // Verify session still exists before redirecting
            const sessions = useSessionStore.getState().sessions;
            if (sessions.some((s) => s.id === lastActiveSessionId)) {
              navigate(`/sessions/${lastActiveSessionId}`, { replace: true });
              syncingFromUrl.current = false;
              return;
            }
          }
        }
        if (parsed.sessionId !== selectedSessionId) {
          selectSession(parsed.sessionId);
        }
        if (parsed.splitId && parsed.splitId !== splitSessionId) {
          // openSplit requires selectedSessionId to be set first — give store time to update
          setTimeout(() => openSplit(parsed.splitId!), 0);
        } else if (!parsed.splitId && splitSessionId) {
          closeSplit();
        }
      }
    }

    // Update repo selection
    if (parsed.panel === 'repositories') {
      if (parsed.repoKey !== selectedRepoKey) {
        selectRepo(parsed.repoKey);
      }
    }

    // Update ticket board/ticket selection
    if (parsed.panel === 'tickets') {
      if (parsed.boardId !== undefined && parsed.boardId !== selectedBoardId) {
        selectBoard(parsed.boardId);
      }
      if (parsed.ticketId !== selectedTicketId) {
        selectTicket(parsed.ticketId);
      }
    }

    // Update scratchpad selection
    if (parsed.panel === 'scratchpads') {
      if (parsed.scratchpadKey !== selectedScratchpadKey) {
        setSelectedScratchpadKey(parsed.scratchpadKey);
        if (parsed.scratchpadKey) {
          const entries = useScratchpadStore.getState().entries;
          if (!entries[parsed.scratchpadKey]?.loaded) {
            loadScratchpad(parsed.scratchpadKey);
          }
        }
      }
    }

    // Update agent persona selection
    if (parsed.panel === 'agents') {
      if (parsed.personaId !== selectedPersonaId) {
        selectPersona(parsed.personaId);
      }
      if (parsed.personaTab && parsed.personaTab !== personaTab) {
        setPersonaTab(parsed.personaTab);
      }
    }

    // Update settings tab
    if (parsed.panel === 'settings' && parsed.settingsTab && parsed.settingsTab !== settingsTab) {
      setSettingsTab(parsed.settingsTab);
    }

    // Schedule flag reset after this tick
    setTimeout(() => {
      syncingFromUrl.current = false;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // ── Store → URL ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (syncingFromUrl.current) return;

    const expected = storeToUrl(
      activePanel,
      selectedSessionId,
      splitSessionId,
      selectedGroupId,
      selectedRepoKey,
      selectedBoardId,
      selectedTicketId,
      selectedScratchpadKey,
      selectedPersonaId,
      personaTab,
      settingsTab,
      selectedAgentWorktreeTicketId,
    );

    const currentPath = location.pathname;
    const currentSearch = location.search;

    if (expected.pathname !== currentPath || expected.search !== currentSearch) {
      navigate(
        { pathname: expected.pathname, search: expected.search },
        { replace: true },
      );
    }
  }, [
    activePanel,
    selectedSessionId,
    splitSessionId,
    selectedGroupId,
    selectedRepoKey,
    selectedBoardId,
    selectedTicketId,
    selectedScratchpadKey,
    selectedPersonaId,
    personaTab,
    settingsTab,
    selectedAgentWorktreeTicketId,
    // Don't include location to avoid re-triggering on our own navigate calls
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return null;
}
