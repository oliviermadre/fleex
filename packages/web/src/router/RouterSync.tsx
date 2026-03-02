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

type ActivePanel = 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'cluster' | 'settings' | 'scratchpads';

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

interface ParsedUrl {
  panel: ActivePanel;
  sessionId: string | null;
  splitId: string | null;
  repoKey: string | null;
  /** undefined = "no board preference in URL", null = "all boards", string = specific board */
  boardId: string | null | undefined;
  ticketId: string | null;
  scratchpadKey: string | null;
  settingsTab: SettingsTab | null;
  redirect?: string;
}

export function parseUrl(pathname: string, search: string): ParsedUrl {
  const params = new URLSearchParams(search);

  // Root: redirect to /sessions
  if (pathname === '/') {
    return { panel: 'sessions', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null, redirect: '/sessions' };
  }

  // Sessions
  const sessionsMatch = pathname.match(/^\/sessions(?:\/(.+))?$/);
  if (sessionsMatch) {
    const sessionId = sessionsMatch[1] ?? null;
    const splitId = sessionId ? (params.get('split') ?? null) : null;
    return { panel: 'sessions', sessionId, splitId, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }

  // Repositories
  const reposMatch = pathname.match(/^\/repositories(?:\/([^/]+)\/([^/]+))?$/);
  if (reposMatch) {
    const repoKey = reposMatch[1] && reposMatch[2] ? `${reposMatch[1]}/${reposMatch[2]}` : null;
    return { panel: 'repositories', sessionId: null, splitId: null, repoKey, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }

  // Tickets — order matters: more specific patterns first
  const ticketBoardTicketMatch = pathname.match(/^\/tickets\/board\/([^/]+)\/ticket\/([^/]+)$/);
  if (ticketBoardTicketMatch) {
    const boardId = ticketBoardTicketMatch[1]!;
    const ticketId = ticketBoardTicketMatch[2]!;
    return { panel: 'tickets', sessionId: null, splitId: null, repoKey: null, boardId, ticketId, scratchpadKey: null, settingsTab: null };
  }
  const ticketBoardMatch = pathname.match(/^\/tickets\/board\/([^/]+)$/);
  if (ticketBoardMatch) {
    const raw = ticketBoardMatch[1]!;
    const boardId = raw === 'all' ? null : raw;
    return { panel: 'tickets', sessionId: null, splitId: null, repoKey: null, boardId, ticketId: null, scratchpadKey: null, settingsTab: null };
  }
  if (pathname === '/tickets') {
    return { panel: 'tickets', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }

  // Claude Config
  if (pathname === '/claude-config') {
    return { panel: 'claude-config', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }

  // Cluster
  if (pathname === '/cluster') {
    return { panel: 'cluster', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }

  // Scratchpads
  if (pathname === '/scratchpads') {
    return { panel: 'scratchpads', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }
  if (pathname === '/scratchpads/global') {
    return { panel: 'scratchpads', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: '__global__', settingsTab: null };
  }
  const scratchpadsMatch = pathname.match(/^\/scratchpads\/([^/]+)\/([^/]+)$/);
  if (scratchpadsMatch) {
    const scratchpadKey = `${scratchpadsMatch[1]}/${scratchpadsMatch[2]}`;
    return { panel: 'scratchpads', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey, settingsTab: null };
  }

  // Settings
  if (pathname === '/settings') {
    return { panel: 'settings', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null };
  }
  const settingsMatch = pathname.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    const rawTab = settingsMatch[1] as SettingsTab;
    if (VALID_SETTINGS_TABS.includes(rawTab)) {
      return { panel: 'settings', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: rawTab };
    }
    return { panel: 'settings', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null, redirect: '/settings' };
  }

  // Unknown route → redirect to /sessions
  return { panel: 'sessions', sessionId: null, splitId: null, repoKey: null, boardId: undefined, ticketId: null, scratchpadKey: null, settingsTab: null, redirect: '/sessions' };
}

// ─── Store state → URL ───────────────────────────────────────────────────────

export function storeToUrl(
  activePanel: ActivePanel,
  selectedSessionId: string | null,
  splitSessionId: string | null,
  selectedRepoKey: string | null,
  selectedBoardId: string | null,
  selectedTicketId: string | null,
  selectedScratchpadKey: string | null,
  settingsTab: SettingsTab,
): { pathname: string; search: string } {
  switch (activePanel) {
    case 'sessions': {
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
        // All boards view
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

  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const openSplit = useSessionStore((s) => s.openSplit);
  const closeSplit = useSessionStore((s) => s.closeSplit);

  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const selectTicket = useTicketStore((s) => s.selectTicket);

  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const setSelectedScratchpadKey = useScratchpadStore((s) => s.setSelectedScratchpadKey);
  const loadScratchpad = useScratchpadStore((s) => s.load);

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
      selectedRepoKey,
      selectedBoardId,
      selectedTicketId,
      selectedScratchpadKey,
      settingsTab,
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
    selectedRepoKey,
    selectedBoardId,
    selectedTicketId,
    selectedScratchpadKey,
    settingsTab,
    // Don't include location to avoid re-triggering on our own navigate calls
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return null;
}
