import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Session } from '@fleex/shared';
import { StatusDot } from '../ui/StatusDot';
import { deriveDisplayStatus, aggregateBranchStatus } from '../../lib/deriveStatus';
import type { DisplayStatus } from '../../lib/deriveStatus';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { usePanelStore } from '../../stores/panelStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useFrequentLaunchStore, buildFrequentItems } from '../../stores/frequentLaunchStore';
import { useToastStore } from '../../stores/toastStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { MentionTypeBadge, type MentionTargetType } from '../ui/MentionTypeBadge';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import * as api from '../../services/api';

interface SmartSessionButtonProps {
  sessions: Session[];
  creating?: boolean;
  onCreateSession?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ticketId?: string;
  /**
   * Launch a skill. May return a promise so the button can await it, show a
   * transient "Launching…" state, and surface success/error toasts. Call sites
   * MUST NOT swallow the rejection (no `.catch`) — the button handles feedback.
   */
  onExecuteSkill?: (skillId: string) => void | Promise<unknown>;
  /** Always show the dropdown menu on click, even with 0-1 sessions and no skills. */
  alwaysShowMenu?: boolean;
  /**
   * Override the trigger's size classes (width / height / padding). When set it
   * REPLACES the compact defaults — our `cn` is a plain join and can't dedupe
   * conflicting Tailwind width utilities, so appending `w-[250px]` next to
   * `w-[108px]` would be order-dependent. The cockpit inspector uses this to
   * render a prominent, centered 250×50 launcher.
   */
  triggerClassName?: string;
}

function FleexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <polyline points="6,6 10,8 6,10" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

// Min width keeps compact states stable; whitespace-nowrap prevents long labels from wrapping.
const BUTTON_WIDTH = 'w-[108px]';

// The launcher popover never grows past this, even on tall windows; on small
// windows the popover shrinks further to the available viewport space.
const LAUNCHER_MAX_HEIGHT = 350;

/**
 * Map a DisplayStatus to border / background / text / hover classes
 * so the entire button shell reflects the session state.
 */
function statusTheme(status: DisplayStatus): string {
  switch (status) {
    case 'executing':
    case 'working':
      return [
        tintClasses('blue').borderColor,
        tintClasses('blue').bg,
        tintClasses('blue').text,
        tintClasses('blue').hoverBorderColor,
        tintClasses('blue').hoverBg,
      ].join(' ');
    case 'needs-approval':
      return [
        tintClasses('yellow').borderColor,
        tintClasses('yellow').bg,
        tintClasses('yellow').text,
        tintClasses('yellow').hoverBorderColor,
        tintClasses('yellow').hoverBg,
      ].join(' ');
    case 'idle':
    case 'unknown':
    default:
      return [
        'border-[var(--theme-text-muted)]/30 bg-[var(--theme-text-muted)]/8 text-[var(--theme-text-muted)]',
        'hover:border-[var(--theme-text-muted)]/50 hover:bg-[var(--theme-text-muted)]/15',
      ].join(' ');
  }
}

// "Open" (no session) uses the app accent color.
const OPEN_THEME = [
  'border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]',
  'hover:border-[var(--theme-accent)]/60 hover:bg-[var(--theme-accent)]/20',
].join(' ');

function SkillWrenchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-muted)]">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

// ── Launcher types ──

type LaunchKind = 'skill' | 'workflow' | 'panel' | 'persona';
type FilterKind = 'all' | LaunchKind;

interface LaunchItem {
  /** Stable key, unique across kinds (`${kind}:${id}`). */
  readonly key: string;
  readonly kind: LaunchKind;
  readonly displayName: string;
  /**
   * Faint mono token shown on the right — the real @mention invocation syntax
   * a ticket comment understands (e.g. "@skill:prepare", "@panel:archi").
   */
  readonly token: string;
  readonly icon: React.ReactNode;
  /** Lowercased, accent-stripped haystack for search. */
  readonly search: string;
  readonly onLaunch: () => void;
}

interface LaunchGroup {
  readonly kind: LaunchKind;
  readonly label: string;
  readonly items: LaunchItem[];
}

/** Fixed display order of the groups, matching the mockup. */
const GROUP_ORDER: { kind: LaunchKind; label: string }[] = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'workflow', label: 'Workflows' },
  { kind: 'panel', label: 'Panels' },
  { kind: 'persona', label: 'Personas' },
];

/** Chip order, matching the mockup ([Tous][Skills][Workflows][Personas][Panels]). */
const CHIP_ORDER: { kind: LaunchKind; label: string }[] = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'workflow', label: 'Workflows' },
  { kind: 'persona', label: 'Personas' },
  { kind: 'panel', label: 'Panels' },
];

const KIND_ICON: Record<LaunchKind, React.ReactNode> = {
  skill: <SkillWrenchIcon />,
  workflow: <span className="w-3.5 shrink-0 text-center">🚦</span>,
  panel: <span className="w-3.5 shrink-0 text-center">🏛️</span>,
  persona: <span className="w-3.5 shrink-0 text-center">🧠</span>,
};

/** Launch kinds map onto the app-wide mention badge types (persona ⇒ agent). */
const KIND_TO_MENTION_TYPE: Record<LaunchKind, MentionTargetType> = {
  skill: 'skill',
  workflow: 'workflow',
  panel: 'panel',
  persona: 'agent',
};

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function rowClass(active: boolean): string {
  return cn(
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
    // scrollIntoView margins: keep the row clear of the sticky search (46px) +
    // sticky group header (~26px) when keyboard navigation scrolls upward.
    'scroll-mb-1 scroll-mt-[72px]',
    active ? 'bg-[var(--theme-bg-hover)]' : 'hover:bg-[var(--theme-bg-hover)]',
  );
}

/** Faint uppercase group header, sticky so it stays visible while the list scrolls. */
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-[46px] z-[1] bg-[var(--theme-bg-surface)] px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">
      {children}
    </div>
  );
}

function LaunchRow({ item, index, active, marker, onHover }: { item: LaunchItem; index: number; active: boolean; marker?: React.ReactNode; onHover?: () => void }) {
  return (
    <button
      role="menuitem"
      aria-selected={active}
      data-index={index}
      className={rowClass(active)}
      onMouseEnter={onHover}
      onClick={(e) => {
        e.stopPropagation();
        item.onLaunch();
      }}
    >
      {marker ?? item.icon}
      <span className="truncate text-[var(--theme-text-primary)]">{item.displayName}</span>
      <span className="ml-auto shrink-0 pl-2 text-[9px] font-mono text-[var(--theme-text-faint)]">{item.token}</span>
    </button>
  );
}

/**
 * The launcher popover: search + sessions + filter chips + a "Fréquents" zone
 * (top usage) + type-grouped launchable lists, all inside a height-bounded,
 * internally scrolling panel with sticky group headers.
 */
function LauncherPanel({
  sessions,
  groups,
  frequentItems,
  counts,
  filter,
  setFilter,
  query,
  setQuery,
  onOpenFloating,
  onCreateSession,
  onClose,
  creating,
  hasTicketId,
  floatingRef,
  floatingStyles,
  floatingProps,
}: {
  sessions: Session[];
  groups: LaunchGroup[];
  frequentItems: LaunchItem[];
  counts: Record<FilterKind, number>;
  filter: FilterKind;
  setFilter: (f: FilterKind) => void;
  query: string;
  setQuery: (q: string) => void;
  onOpenFloating: (sessionId: string) => void;
  onCreateSession: () => void;
  onClose: () => void;
  creating: boolean;
  hasTicketId: boolean;
  floatingRef: (node: HTMLElement | null) => void;
  floatingStyles: React.CSSProperties;
  floatingProps: Record<string, unknown>;
}) {
  // -1 = nothing highlighted (mouse-first); arrow keys opt into navigation.
  const [highlight, setHighlight] = useState(-1);
  // The floating element is the scroll container — kept in a local ref too so
  // the highlight-follow effect can reach the active row.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const nq = normalize(query.trim());

  // Groups honour the active chip and the search query.
  const visibleGroups = useMemo(() => {
    return groups
      .filter((g) => filter === 'all' || filter === g.kind)
      .map((g) => ({
        ...g,
        items: nq ? g.items.filter((i) => i.search.includes(nq)) : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, filter, nq]);

  // Fréquents: hidden while searching, hidden for the Personas filter (personas
  // are excluded by design), and honours the active chip otherwise.
  const showFrequents = !nq && filter !== 'persona';
  const shownFrequents = useMemo(
    () => (showFrequents ? frequentItems.filter((i) => filter === 'all' || filter === i.kind) : []),
    [showFrequents, frequentItems, filter],
  );

  // Flat list of launchable rows in display order, for keyboard navigation.
  const flatItems = useMemo(
    () => [...shownFrequents, ...visibleGroups.flatMap((g) => g.items)],
    [shownFrequents, visibleGroups],
  );

  // Restart navigation whenever the visible set changes (typing / chip switch).
  useEffect(() => {
    setHighlight(-1);
  }, [nq, filter]);

  // The panel scrolls internally, so follow the highlight: without this the
  // arrow keys move the selection below/above the fold and the user "selects"
  // rows they cannot see (same convention as CommandPalette / Autocomplete).
  useEffect(() => {
    if (highlight < 0) return;
    const el = panelRef.current?.querySelector(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      const item = flatItems[highlight];
      if (item) {
        e.preventDefault();
        item.onLaunch();
      }
    } else if (e.key === 'Escape' && query) {
      // Command-palette convention: first Esc clears the query, then closes.
      e.stopPropagation();
      setQuery('');
    }
  };

  return (
    <FloatingPortal>
      <div
        ref={(node: HTMLDivElement | null) => {
          panelRef.current = node;
          floatingRef(node);
        }}
        style={floatingStyles}
        {...floatingProps}
        className="z-50 w-[380px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] pb-1 shadow-xl"
      >
        {/* Search — sticky at the very top of the scroll container */}
        <div className="sticky top-0 z-[2] h-[46px] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder="Filtrer — ou naviguer ↑ ↓"
            className="h-[30px] w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)]/50 focus:outline-none"
          />
        </div>

        {/* Sessions group */}
        {sessions.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">Sessions</div>
            {sessions.map((session) => {
              const derived = deriveDisplayStatus(session);
              return (
                <button
                  key={session.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFloating(session.id);
                  }}
                >
                  <StatusDot status={derived.status} size="sm" />
                  <span className="truncate text-[var(--theme-text-primary)]">{session.displayName}</span>
                  <span className={cn('ml-auto whitespace-nowrap', derived.textColor)}>{derived.label}</span>
                </button>
              );
            })}
          </>
        )}

        {/* New session action */}
        <button
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onCreateSession();
          }}
          disabled={creating}
        >
          {creating ? (
            <span className="h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : (
            <FleexIcon />
          )}
          <span className="text-[var(--theme-accent)]">New session</span>
        </button>

        {/* Filter chips */}
        {hasTicketId && counts.all > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-[var(--theme-border)] px-2 pb-1 pt-2">
            <FilterChip label="Tous" count={counts.all} active={filter === 'all'} onClick={() => setFilter('all')} />
            {CHIP_ORDER.filter((c) => counts[c.kind] > 0).map((c) => (
              <FilterChip
                key={c.kind}
                label={c.label}
                count={counts[c.kind]}
                active={filter === c.kind}
                onClick={() => setFilter(c.kind)}
              />
            ))}
          </div>
        )}

        {/* Fréquents */}
        {shownFrequents.length > 0 && (
          <>
            <GroupHeader>Fréquents</GroupHeader>
            {shownFrequents.map((item, idx) => (
              <LaunchRow
                key={`freq:${item.key}`}
                item={item}
                index={idx}
                active={highlight === idx}
                onHover={() => setHighlight(idx)}
                // The section mixes types, so each row carries the app-wide type
                // letter badge (S/W/P) — a uniform marker would hide WHAT it is.
                marker={<MentionTypeBadge type={KIND_TO_MENTION_TYPE[item.kind]} size="sm" />}
              />
            ))}
          </>
        )}

        {/* Grouped launchable lists. Flat indices continue after the Fréquents
            rows so keyboard highlighting stays correct even when an item also
            appears in Fréquents (same object reference, distinct positions). */}
        {(() => {
          let flatIdx = shownFrequents.length;
          return visibleGroups.map((g) => (
            <div key={g.kind}>
              <GroupHeader>{g.label}</GroupHeader>
              {g.items.map((item) => {
                const idx = flatIdx++;
                return (
                  <LaunchRow
                    key={item.key}
                    item={item}
                    index={idx}
                    active={highlight === idx}
                    onHover={() => setHighlight(idx)}
                  />
                );
              })}
            </div>
          ));
        })()}
      </div>
    </FloatingPortal>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
        active
          ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
          : 'bg-[var(--theme-text-muted)]/10 text-[var(--theme-text-muted)] hover:bg-[var(--theme-text-muted)]/20',
      )}
    >
      <span>{label}</span>
      {/* 2 digits max so the five chips keep fitting on a single row. */}
      <span className="opacity-70">{count > 99 ? '99+' : count}</span>
    </button>
  );
}

export function SmartSessionButton({ sessions, creating: externalCreating, onCreateSession: externalOnCreateSession, disabled, size = 'sm', ticketId, onExecuteSkill, alwaysShowMenu, triggerClassName }: SmartSessionButtonProps) {
  const addFloatingSession = useUIStore((s) => s.addFloatingSession);
  const openSessionFromTicket = useTicketStore((s) => s.openSessionFromTicket);
  const skills = useSkillStore((s) => s.skills);
  const addToast = useToastStore((s) => s.addToast);
  const { open: dropdownOpen, setOpen: setDropdownOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ maxHeight: LAUNCHER_MAX_HEIGHT });
  const [internalCreating, setInternalCreating] = useState(false);
  // Transient acknowledgement while a workflow/skill/panel/persona launch is in flight.
  const [launching, setLaunching] = useState(false);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [query, setQuery] = useState('');

  const creating = externalCreating || internalCreating;

  const handleCreateSession = useCallback(async () => {
    // An explicit parent handler wins over the ticketId-based floating fallback:
    // the tab bar of UnifiedWorktreePanel passes both props and wants a new tab,
    // not a floating popup.
    if (externalOnCreateSession) {
      externalOnCreateSession();
      return;
    }
    if (ticketId) {
      setInternalCreating(true);
      try {
        const { sessionId } = await openSessionFromTicket(ticketId);
        const tryOpen = () => {
          const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
          if (session) {
            addFloatingSession(sessionId);
            setInternalCreating(false);
          } else {
            setTimeout(tryOpen, 300);
          }
        };
        tryOpen();
      } catch {
        setInternalCreating(false);
      }
    }
  }, [ticketId, openSessionFromTicket, addFloatingSession, externalOnCreateSession]);

  const onCreateSession = handleCreateSession;

  const enabledSkills = skills.filter((s) => s.enabled);

  const templates = useWorkflowTemplateStore((s) => s.templates);
  const refreshTemplates = useWorkflowTemplateStore((s) => s.refresh);
  const startRun = useWorkflowRunStore((s) => s.start);
  const enabledTemplates = templates.filter((t) => t.enabled);

  const panels = usePanelStore((s) => s.panels);
  const panelsLoaded = usePanelStore((s) => s.loaded);
  const loadPanels = usePanelStore((s) => s.loadPanels);
  const enabledPanels = panels.filter((p) => p.enabled);

  const personas = useAgentPersonaStore((s) => s.personas);
  const personasLoaded = useAgentPersonaStore((s) => s.loaded);
  const loadPersonas = useAgentPersonaStore((s) => s.loadPersonas);

  const frequentStats = useFrequentLaunchStore((s) => s.stats);
  const loadFrequent = useFrequentLaunchStore((s) => s.load);

  useEffect(() => { void refreshTemplates(); }, [refreshTemplates]);

  // Panels & personas are global, small lists — load once (guarded) when a
  // ticket-scoped button mounts so the trigger/chips/counts are accurate.
  useEffect(() => {
    if (!ticketId) return;
    if (!panelsLoaded) void loadPanels();
    if (!personasLoaded) void loadPersonas();
  }, [ticketId, panelsLoaded, loadPanels, personasLoaded, loadPersonas]);

  // Fréquents stats are heavier — fetch lazily on first open (cached, D3).
  // Reset the transient filter/query so each open starts fresh.
  useEffect(() => {
    if (dropdownOpen) {
      void loadFrequent();
      setFilter('all');
      setQuery('');
    }
  }, [dropdownOpen, loadFrequent]);

  const handleOpenFloating = (sessionId: string) => {
    addFloatingSession(sessionId);
    setDropdownOpen(false);
  };

  const handleExecuteSkill = onExecuteSkill
    ? async (skillId: string) => {
        setDropdownOpen(false);
        const skill = enabledSkills.find((s) => s.id === skillId);
        const label = skill ? `/${skill.commandName}` : 'skill';
        setLaunching(true);
        try {
          await onExecuteSkill(skillId);
          addToast('success', `🧩 Skill ${label} lancé`);
        } catch (err) {
          console.error('Failed to execute skill:', err);
          addToast('error', `Échec du lancement du skill ${label}`);
        } finally {
          setLaunching(false);
        }
      }
    : undefined;

  const handleStartWorkflow = ticketId
    ? async (templateId: string) => {
        setDropdownOpen(false);
        const template = enabledTemplates.find((t) => t.id === templateId);
        const name = template?.name ?? 'workflow';
        setLaunching(true);
        try {
          await startRun(ticketId, templateId);
          addToast('success', `🚦 Workflow "${name}" lancé`);
        } catch (err) {
          console.error('Failed to start workflow:', err);
          addToast('error', `Échec du lancement du workflow "${name}"`);
        } finally {
          setLaunching(false);
        }
      }
    : undefined;

  const handleExecutePanel = ticketId
    ? async (panelId: string, name: string) => {
        setDropdownOpen(false);
        setLaunching(true);
        try {
          await api.executePanel(panelId, ticketId);
          addToast('success', `🏛️ Panel "${name}" lancé`);
        } catch (err) {
          console.error('Failed to execute panel:', err);
          addToast('error', `Échec du lancement du panel "${name}"`);
        } finally {
          setLaunching(false);
        }
      }
    : undefined;

  const handleLaunchPersona = ticketId
    ? async (personaName: string, displayName: string) => {
        setDropdownOpen(false);
        setLaunching(true);
        try {
          await api.postTicketComment(ticketId, `@agent:${personaName}`);
          addToast('success', `🧠 Persona "${displayName}" lancé`);
        } catch (err) {
          console.error('Failed to launch persona:', err);
          addToast('error', `Échec du lancement du persona "${displayName}"`);
        } finally {
          setLaunching(false);
        }
      }
    : undefined;

  // ── Build the launchable item groups (ticket-scoped only) ──
  const skillItems: LaunchItem[] = ticketId && handleExecuteSkill
    ? enabledSkills.map((s) => ({
        key: `skill:${s.id}`,
        kind: 'skill' as const,
        displayName: s.displayName,
        token: `@skill:${s.commandName}`,
        icon: KIND_ICON.skill,
        search: normalize(`${s.displayName} ${s.name} ${s.commandName}`),
        onLaunch: () => void handleExecuteSkill(s.id),
      }))
    : [];

  const workflowItems: LaunchItem[] = ticketId && handleStartWorkflow
    ? enabledTemplates.map((t) => ({
        key: `workflow:${t.id}`,
        kind: 'workflow' as const,
        displayName: t.name,
        token: `@workflow:${t.slug}`,
        icon: <span className="w-3.5 shrink-0 text-center">{t.emoji}</span>,
        search: normalize(`${t.name} ${t.slug}`),
        onLaunch: () => void handleStartWorkflow(t.id),
      }))
    : [];

  const panelItems: LaunchItem[] = ticketId && handleExecutePanel
    ? enabledPanels.map((p) => ({
        key: `panel:${p.id}`,
        kind: 'panel' as const,
        displayName: p.displayName,
        token: `@panel:${p.name}`,
        icon: KIND_ICON.panel,
        search: normalize(`${p.displayName} ${p.name}`),
        onLaunch: () => void handleExecutePanel(p.id, p.displayName),
      }))
    : [];

  const personaItems: LaunchItem[] = ticketId && handleLaunchPersona
    ? personas.map((p) => ({
        key: `persona:${p.id}`,
        kind: 'persona' as const,
        displayName: p.displayName,
        token: `@agent:${p.name}`,
        icon: KIND_ICON.persona,
        search: normalize(`${p.displayName} ${p.name}`),
        onLaunch: () => void handleLaunchPersona(p.name, p.displayName),
      }))
    : [];

  const itemsByKind: Record<LaunchKind, LaunchItem[]> = {
    skill: skillItems,
    workflow: workflowItems,
    panel: panelItems,
    persona: personaItems,
  };

  const groups: LaunchGroup[] = GROUP_ORDER.map(({ kind, label }) => ({
    kind,
    label,
    items: itemsByKind[kind],
  })).filter((g) => g.items.length > 0);

  const counts: Record<FilterKind, number> = {
    skill: skillItems.length,
    workflow: workflowItems.length,
    panel: panelItems.length,
    persona: personaItems.length,
    all: skillItems.length + workflowItems.length + panelItems.length + personaItems.length,
  };

  // Fréquents: resolve the merged leaderboards to the currently-available items
  // so they reuse the exact same launch handlers as the grouped rows.
  const itemsByKey = new Map(
    [...skillItems, ...workflowItems, ...panelItems].map((i) => [i.key, i]),
  );
  const frequentItems: LaunchItem[] = buildFrequentItems(frequentStats, {
    skills: enabledSkills.map((s) => ({ id: s.id, displayName: s.displayName, commandName: s.commandName })),
    templates: enabledTemplates.map((t) => ({ id: t.id, name: t.name, slug: t.slug, emoji: t.emoji })),
    panels: enabledPanels.map((p) => ({ id: p.id, displayName: p.displayName, name: p.name })),
  })
    .map((f) => itemsByKey.get(f.key))
    .filter((i): i is LaunchItem => Boolean(i));

  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';

  // Shape shared by every state — colors come from the theme param
  const shell = (theme: string) =>
    cn(
      'inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-md font-semibold transition-all duration-150',
      textSize,
      // triggerClassName REPLACES the compact size (padding + width): `cn` is a
      // plain join with no tailwind-merge, so appending would leave both
      // conflicting width utilities in the class list (order-dependent).
      triggerClassName ?? cn('px-2.5 py-1', BUTTON_WIDTH),
      'border',
      theme,
      'active:scale-[0.97]',
    );

  // Show the launcher dropdown when there is anything to launch. Panels/personas
  // are global assets loaded lazily on mount, so this resolves to true as soon
  // as they arrive; a ticket with no launchable assets keeps the original
  // direct-action behaviour.
  const hasMenu = counts.all > 0;

  const renderPanel = () => (
    <LauncherPanel
      sessions={sessions}
      groups={groups}
      frequentItems={frequentItems}
      counts={counts}
      filter={filter}
      setFilter={setFilter}
      query={query}
      setQuery={setQuery}
      onOpenFloating={handleOpenFloating}
      onCreateSession={onCreateSession}
      onClose={() => setDropdownOpen(false)}
      creating={creating}
      hasTicketId={!!ticketId}
      floatingRef={refs.setFloating}
      floatingStyles={floatingStyles}
      floatingProps={getFloatingProps()}
    />
  );

  // ── Transient state: a launch is in flight ──
  // Reuses the "creating" spinner pattern so every surface where the button
  // appears gives the same immediate acknowledgement that the action started.
  // The confirmation itself lands as a toast once the promise resolves.
  if (launching) {
    return (
      <div className="relative flex-shrink-0">
        <button className={cn(shell(statusTheme('working')), 'pointer-events-none')} disabled>
          <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none" />
          <span className="whitespace-nowrap">Launching…</span>
        </button>
      </div>
    );
  }

  // ── State 1: No sessions — "Start" ──
  if (sessions.length === 0 && !alwaysShowMenu) {
    // If we can launch things, show the dropdown instead of a direct action.
    if (hasMenu) {
      return (
        <div className="relative flex-shrink-0">
          <button
            ref={refs.setReference}
            className={cn(shell(OPEN_THEME), (disabled || creating) && 'pointer-events-none opacity-50')}
            {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
            disabled={disabled || creating}
          >
            {creating ? (
              <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              <FleexIcon />
            )}
            <span>Start</span>
            <ChevronDownIcon />
          </button>

          {dropdownOpen && renderPanel()}
        </div>
      );
    }

    return (
      <button
        className={cn(shell(OPEN_THEME), (disabled || creating) && 'pointer-events-none opacity-50')}
        onClick={(e) => {
          e.stopPropagation();
          onCreateSession();
        }}
        disabled={disabled || creating}
      >
        {creating ? (
          <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : (
          <FleexIcon />
        )}
        <span>Start</span>
      </button>
    );
  }

  // ── State 2: 1 session ──
  if (sessions.length === 1 && !hasMenu && !alwaysShowMenu) {
    const session = sessions[0]!;
    const derived = deriveDisplayStatus(session);
    return (
      <button
        className={shell(statusTheme(derived.status))}
        onClick={(e) => {
          e.stopPropagation();
          handleOpenFloating(session.id);
        }}
        title={`Open ${session.displayName}`}
      >
        <StatusDot status={derived.status} size="sm" />
        <span>{derived.label}</span>
      </button>
    );
  }

  // ── State 3: N sessions (or 1 session + launchables) — aggregate + dropdown ──
  const aggregated = sessions.length > 0 ? aggregateBranchStatus(sessions) : null;
  const theme = aggregated ? statusTheme(aggregated.status) : OPEN_THEME;
  return (
    <div className="relative flex-shrink-0">
      <button
        ref={refs.setReference}
        className={shell(theme)}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
      >
        {aggregated ? (
          <>
            <StatusDot status={aggregated.status} size="sm" />
            <span>{aggregated.label}</span>
            <span className="rounded-full bg-current/15 px-1.5 text-[9px] font-bold leading-[16px] opacity-70">
              {sessions.length}
            </span>
          </>
        ) : (
          <>
            <FleexIcon />
            <span>Start</span>
          </>
        )}
        <ChevronDownIcon />
      </button>

      {dropdownOpen && renderPanel()}
    </div>
  );
}
