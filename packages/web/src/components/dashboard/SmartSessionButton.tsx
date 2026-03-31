import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '@fleex/shared';
import { StatusDot } from '../ui/StatusDot';
import { deriveDisplayStatus, aggregateBranchStatus } from '../../lib/deriveStatus';
import type { DisplayStatus } from '../../lib/deriveStatus';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useSkillStore } from '../../stores/skillStore';
import { cn } from '../../lib/cn';

interface SmartSessionButtonProps {
  sessions: Session[];
  creating?: boolean;
  onCreateSession?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ticketId?: string;
  onExecuteSkill?: (skillId: string) => void;
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

/**
 * Map a DisplayStatus to border / background / text / hover classes
 * so the entire button shell reflects the session state.
 */
function statusTheme(status: DisplayStatus): string {
  switch (status) {
    case 'executing':
    case 'working':
      return [
        'border-blue-500/40 bg-blue-500/10 text-blue-500',
        'hover:border-blue-500/60 hover:bg-blue-500/20',
      ].join(' ');
    case 'needs-approval':
      return [
        'border-amber-400/40 bg-amber-400/10 text-amber-400',
        'hover:border-amber-400/60 hover:bg-amber-400/20',
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

/** Shared dropdown content — sessions list + skills list */
function DropdownContent({
  sessions,
  enabledSkills,
  onOpenFloating,
  onCreateSession,
  onExecuteSkill,
  creating,
  hasTicketId,
}: {
  sessions: Session[];
  enabledSkills: { id: string; displayName: string; commandName: string }[];
  onOpenFloating: (sessionId: string) => void;
  onCreateSession: () => void;
  onExecuteSkill?: (skillId: string) => void;
  creating: boolean;
  hasTicketId: boolean;
}) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl">
      {/* Sessions group */}
      {sessions.length > 0 && (
        <>
          <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">Sessions</div>
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
                <span className="truncate text-[var(--theme-text-primary)]">
                  {session.displayName}
                </span>
                <span className={cn('ml-auto whitespace-nowrap', derived.textColor)}>
                  {derived.label}
                </span>
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

      {/* Skills group */}
      {enabledSkills.length > 0 && hasTicketId && onExecuteSkill && (
        <>
          <div className="mx-2 my-1 border-t border-[var(--theme-border)]" />
          <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">Skills</div>
          {enabledSkills.map((skill) => (
            <button
              key={skill.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={(e) => {
                e.stopPropagation();
                onExecuteSkill(skill.id);
              }}
            >
              <SkillWrenchIcon />
              <span className="truncate text-[var(--theme-text-primary)]">
                {skill.displayName}
              </span>
              <span className="ml-auto text-[9px] text-[var(--theme-text-faint)]">
                /{skill.commandName}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export function SmartSessionButton({ sessions, creating: externalCreating, onCreateSession: externalOnCreateSession, disabled, size = 'sm', ticketId, onExecuteSkill }: SmartSessionButtonProps) {
  const addFloatingSession = useUIStore((s) => s.addFloatingSession);
  const openSessionFromTicket = useTicketStore((s) => s.openSessionFromTicket);
  const skills = useSkillStore((s) => s.skills);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [internalCreating, setInternalCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const creating = externalCreating || internalCreating;

  const handleCreateSession = useCallback(async () => {
    if (ticketId) {
      // Internalized: call backend directly, then open floating session
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
    } else if (externalOnCreateSession) {
      externalOnCreateSession();
    }
  }, [ticketId, openSessionFromTicket, addFloatingSession, externalOnCreateSession]);

  const onCreateSession = handleCreateSession;

  const enabledSkills = skills.filter((s) => s.enabled);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [dropdownOpen]);

  const handleOpenFloating = (sessionId: string) => {
    addFloatingSession(sessionId);
    setDropdownOpen(false);
  };

  const handleExecuteSkill = onExecuteSkill
    ? (skillId: string) => {
        onExecuteSkill(skillId);
        setDropdownOpen(false);
      }
    : undefined;

  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';

  // Shape shared by every state — colors come from the theme param
  const shell = (theme: string) =>
    cn(
      'inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-all duration-150',
      textSize,
      BUTTON_WIDTH,
      'border',
      theme,
      'active:scale-[0.97]',
    );

  const hasSkills = enabledSkills.length > 0 && !!ticketId && !!onExecuteSkill;

  // ── State 1: No sessions — "Start" ──
  if (sessions.length === 0) {
    // If we have skills, show dropdown instead of direct action
    if (hasSkills) {
      return (
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            className={cn(shell(OPEN_THEME), (disabled || creating) && 'pointer-events-none opacity-50')}
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen(!dropdownOpen);
            }}
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

          {dropdownOpen && (
            <DropdownContent
              sessions={sessions}
              enabledSkills={enabledSkills}
              onOpenFloating={handleOpenFloating}
              onCreateSession={onCreateSession}
              onExecuteSkill={handleExecuteSkill}
              creating={creating}
              hasTicketId={!!ticketId}
            />
          )}
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
  if (sessions.length === 1 && !hasSkills) {
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

  // ── State 3: N sessions (or 1 session + skills) — aggregate + dropdown ──
  const aggregated = sessions.length > 0 ? aggregateBranchStatus(sessions) : null;
  const theme = aggregated ? statusTheme(aggregated.status) : OPEN_THEME;
  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      <button
        className={shell(theme)}
        onClick={(e) => {
          e.stopPropagation();
          setDropdownOpen(!dropdownOpen);
        }}
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

      {dropdownOpen && (
        <DropdownContent
          sessions={sessions}
          enabledSkills={enabledSkills}
          onOpenFloating={handleOpenFloating}
          onCreateSession={onCreateSession}
          onExecuteSkill={handleExecuteSkill}
          creating={creating}
          hasTicketId={!!ticketId}
        />
      )}
    </div>
  );
}
