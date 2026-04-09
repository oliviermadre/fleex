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
import { useUIStore, type SettingsTab, type AnalyticsTab } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useTicketStore, VALID_TICKET_TABS, type TicketTab } from '../stores/ticketStore';
import { useScratchpadStore } from '../stores/scratchpadStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useSkillStore } from '../stores/skillStore';
import { usePanelStore } from '../stores/panelStore';

type ActivePanel = 'dashboard' | 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'agents' | 'cluster' | 'settings' | 'scratchpads' | 'analytics';

const VALID_ANALYTICS_TABS: AnalyticsTab[] = ['audit-trail', 'statistics'];

const VALID_SETTINGS_TABS: SettingsTab[] = [
  'general',
  'appearance',
  'repositories',
  'pinned-icons',
  'worktree-actions',
  'agent-tokens',
];

// ─── URL → Store state ───────────────────────────────────────────────────────

type PersonaTab = 'config' | 'soul' | 'identity' | 'memory' | 'events';
const VALID_PERSONA_TABS: PersonaTab[] = ['config', 'soul', 'identity', 'memory', 'events'];

interface ParsedUrl {
  panel: ActivePanel;
  /** @deprecated — use sessionTicketId + sessionTabKey */
  sessionId: string | null;
  splitId: string | null;
  /** Ticket-based session routing: 'system' or ticket UUID */
  sessionTicketId: string | null;
  /** Tab within the ticket: 's:sessionId' or 'e:executionId' */
  sessionTabKey: string | null;
  repoKey: string | null;
  /** undefined = "no board preference in URL", null = "all boards", string = specific board */
  boardId: string | null | undefined;
  ticketId: string | null;
  ticketTab: TicketTab | null;
  scratchpadKey: string | null;
  personaId: string | null;
  personaTab: PersonaTab | null;
  skillId: string | null;
  panelId: string | null;
  settingsTab: SettingsTab | null;
  analyticsTab: AnalyticsTab | null;
  agentWorktreeTicketId: string | null;
  redirect?: string;
}

export function parseUrl(pathname: string, search: string): ParsedUrl {
  const params = new URLSearchParams(search);

  const base = { sessionId: null, splitId: null, sessionTicketId: null as string | null, sessionTabKey: null as string | null, repoKey: null, boardId: undefined as string | null | undefined, ticketId: null, ticketTab: null as TicketTab | null, scratchpadKey: null, personaId: null, personaTab: null as PersonaTab | null, skillId: null as string | null, panelId: null as string | null, settingsTab: null as SettingsTab | null, analyticsTab: null as AnalyticsTab | null, agentWorktreeTicketId: null as string | null };

  // Root: redirect to /dashboard
  if (pathname === '/') {
    return { ...base, panel: 'dashboard' as ActivePanel, redirect: '/dashboard' };
  }

  // Dashboard
  if (pathname === '/dashboard') {
    return { ...base, panel: 'dashboard' };
  }

  // Agent worktree within sessions panel
  const agentWtMatch = pathname.match(/^\/sessions\/agent\/([^/]+)$/);
  if (agentWtMatch) {
    return { ...base, panel: 'sessions', agentWorktreeTicketId: agentWtMatch[1]! };
  }

  // Sessions: /sessions/system/:tabKey or /sessions/system
  const systemMatch = pathname.match(/^\/sessions\/system(?:\/(.+))?$/);
  if (systemMatch) {
    return { ...base, panel: 'sessions', sessionTicketId: 'system', sessionTabKey: systemMatch[1] ? decodeURIComponent(systemMatch[1]) : null };
  }

  // Sessions: /sessions/:ticketId/:tabKey or /sessions/:ticketId or /sessions
  const sessionsMatch = pathname.match(/^\/sessions(?:\/([^/]+))?(?:\/(.+))?$/);
  if (sessionsMatch) {
    const first = sessionsMatch[1] ?? null;
    const second = sessionsMatch[2] ? decodeURIComponent(sessionsMatch[2]) : null;
    if (first) {
      return { ...base, panel: 'sessions', sessionTicketId: first, sessionTabKey: second };
    }
    return { ...base, panel: 'sessions' };
  }

  // Repositories
  const reposMatch = pathname.match(/^\/repositories(?:\/([^/]+)\/([^/]+))?$/);
  if (reposMatch) {
    const repoKey = reposMatch[1] && reposMatch[2] ? `${reposMatch[1]}/${reposMatch[2]}` : null;
    return { ...base, panel: 'repositories', repoKey };
  }

  // Tickets — order matters: more specific patterns first
  const ticketBoardTicketMatch = pathname.match(/^\/tickets\/board\/([^/]+)\/ticket\/([^/]+)(?:\/([^/]+))?$/);
  if (ticketBoardTicketMatch) {
    const rawBoard = ticketBoardTicketMatch[1]!;
    const rawTab = ticketBoardTicketMatch[3] as TicketTab | undefined;
    const ticketTab = rawTab && VALID_TICKET_TABS.includes(rawTab) ? rawTab : null;
    return { ...base, panel: 'tickets', boardId: rawBoard === 'all' ? null : rawBoard, ticketId: ticketBoardTicketMatch[2]!, ticketTab };
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

  // Agents — panel routes
  const panelMatch = pathname.match(/^\/agents\/panel\/([^/]+)$/);
  if (panelMatch) {
    return { ...base, panel: 'agents', panelId: panelMatch[1]! };
  }

  // Agents — skill routes
  const skillMatch = pathname.match(/^\/agents\/skill\/([^/]+)$/);
  if (skillMatch) {
    return { ...base, panel: 'agents', skillId: skillMatch[1]! };
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

  // Analytics
  if (pathname === '/analytics') {
    return { ...base, panel: 'analytics', analyticsTab: 'audit-trail' };
  }
  const analyticsMatch = pathname.match(/^\/analytics\/([^/]+)$/);
  if (analyticsMatch) {
    const rawTab = analyticsMatch[1] as AnalyticsTab;
    if (VALID_ANALYTICS_TABS.includes(rawTab)) {
      return { ...base, panel: 'analytics', analyticsTab: rawTab };
    }
    return { ...base, panel: 'analytics', analyticsTab: 'audit-trail', redirect: '/analytics' };
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

  // Unknown route → redirect to /dashboard
  return { ...base, panel: 'dashboard', redirect: '/dashboard' };
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
  selectedPersonaId: string | null,
  selectedSkillId: string | null,
  personaTab: PersonaTab,
  settingsTab: SettingsTab,
  selectedAgentWorktreeTicketId?: string | null,
  analyticsTab?: AnalyticsTab,
  ticketTab?: TicketTab,
  selectedPanelId?: string | null,
  sessionTicketId?: string | null,
  sessionTabKey?: string | null,
): { pathname: string; search: string } {
  switch (activePanel) {
    case 'dashboard':
      return { pathname: '/dashboard', search: '' };
    case 'sessions': {
      if (selectedAgentWorktreeTicketId && !sessionTicketId) {
        return { pathname: `/sessions/agent/${selectedAgentWorktreeTicketId}`, search: '' };
      }
      if (sessionTicketId) {
        const base = sessionTicketId === 'system' ? '/sessions/system' : `/sessions/${sessionTicketId}`;
        if (sessionTabKey) {
          return { pathname: `${base}/${encodeURIComponent(sessionTabKey)}`, search: '' };
        }
        return { pathname: base, search: '' };
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
      const tabSuffix = selectedTicketId && ticketTab && ticketTab !== 'description' ? `/${ticketTab}` : '';
      if (selectedBoardId === null) {
        if (selectedTicketId) {
          return { pathname: `/tickets/board/all/ticket/${selectedTicketId}${tabSuffix}`, search: '' };
        }
        return { pathname: '/tickets/board/all', search: '' };
      }
      if (selectedBoardId) {
        if (selectedTicketId) {
          return { pathname: `/tickets/board/${selectedBoardId}/ticket/${selectedTicketId}${tabSuffix}`, search: '' };
        }
        return { pathname: `/tickets/board/${selectedBoardId}`, search: '' };
      }
      return { pathname: '/tickets', search: '' };
    }
    case 'claude-config':
      return { pathname: '/claude-config', search: '' };
    case 'agents': {
      if (selectedPanelId) {
        return { pathname: `/agents/panel/${selectedPanelId}`, search: '' };
      }
      if (selectedSkillId) {
        return { pathname: `/agents/skill/${selectedSkillId}`, search: '' };
      }
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
    case 'analytics': {
      return { pathname: `/analytics/${analyticsTab ?? 'audit-trail'}`, search: '' };
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
  const analyticsTab = useUIStore((s) => s.analyticsTab);
  const setAnalyticsTab = useUIStore((s) => s.setAnalyticsTab);

  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const sessionTicketId = useSessionStore((s) => s.selectedTicketId);
  const sessionTabKey = useSessionStore((s) => s.selectedTabKey);
  const selectTicketTab = useSessionStore((s) => s.selectTicketTab);
  const selectSession = useSessionStore((s) => s.selectSession);
  const openSplit = useSessionStore((s) => s.openSplit);
  const closeSplit = useSessionStore((s) => s.closeSplit);

  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const ticketTab = useTicketStore((s) => s.ticketTab);
  const setTicketTab = useTicketStore((s) => s.setTicketTab);

  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const setSelectedScratchpadKey = useScratchpadStore((s) => s.setSelectedScratchpadKey);
  const loadScratchpad = useScratchpadStore((s) => s.load);

  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const selectPersona = useAgentPersonaStore((s) => s.selectPersona);
  const personaTab = useAgentPersonaStore((s) => s.activeTab);
  const setPersonaTab = useAgentPersonaStore((s) => s.setActiveTab);

  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const selectSkill = useSkillStore((s) => s.selectSkill);
  const selectedPanelId = usePanelStore((s) => s.selectedPanelId);
  const selectPanel = usePanelStore((s) => s.selectPanel);

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
        if (sessionTicketId) selectTicketTab(null);
        syncingFromUrl.current = false;
        return;
      }

      // Ticket-based routing
      if (parsed.sessionTicketId !== sessionTicketId || parsed.sessionTabKey !== sessionTabKey) {
        selectTicketTab(parsed.sessionTicketId, parsed.sessionTabKey);
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
      if (parsed.ticketTab && parsed.ticketTab !== ticketTab) {
        setTicketTab(parsed.ticketTab);
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

    // Update agent persona / skill / panel selection
    if (parsed.panel === 'agents') {
      if (parsed.panelId) {
        // Panel selected — clear persona and skill selection
        if (parsed.panelId !== selectedPanelId) {
          selectPanel(parsed.panelId);
        }
        if (selectedPersonaId) selectPersona(null);
        if (selectedSkillId) selectSkill(null);
      } else if (parsed.skillId) {
        // Skill selected — clear persona and panel selection
        if (parsed.skillId !== selectedSkillId) {
          selectSkill(parsed.skillId);
        }
        if (selectedPersonaId) selectPersona(null);
        if (selectedPanelId) selectPanel(null);
      } else {
        // Persona selected — clear skill and panel selection
        if (parsed.personaId !== selectedPersonaId) {
          selectPersona(parsed.personaId);
        }
        if (selectedSkillId) selectSkill(null);
        if (selectedPanelId) selectPanel(null);
        if (parsed.personaTab && parsed.personaTab !== personaTab) {
          setPersonaTab(parsed.personaTab);
        }
      }
    }

    // Update analytics tab
    if (parsed.panel === 'analytics' && parsed.analyticsTab && parsed.analyticsTab !== analyticsTab) {
      setAnalyticsTab(parsed.analyticsTab);
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
      selectedPersonaId,
      selectedSkillId,
      personaTab,
      settingsTab,
      selectedAgentWorktreeTicketId,
      analyticsTab,
      ticketTab,
      selectedPanelId,
      sessionTicketId,
      sessionTabKey,
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
    sessionTicketId,
    sessionTabKey,
    selectedRepoKey,
    selectedBoardId,
    selectedTicketId,
    selectedScratchpadKey,
    selectedPersonaId,
    selectedSkillId,
    personaTab,
    settingsTab,
    selectedAgentWorktreeTicketId,
    analyticsTab,
    ticketTab,
    selectedPanelId,
    // Don't include location to avoid re-triggering on our own navigate calls
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return null;
}
