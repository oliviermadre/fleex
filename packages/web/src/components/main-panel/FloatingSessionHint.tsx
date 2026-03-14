import type { Session } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';

interface Props {
  session: Session;
}

/**
 * Shown in the main panel when the selected session is currently displayed as a floating overlay.
 * Clicking re-attaches the session to the main panel.
 */
export function FloatingSessionHint({ session }: Props) {
  const removeFloatingSession = useUIStore((s) => s.removeFloatingSession);

  const displayName = session.displayName || session.tmuxName;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--theme-text-muted)]">
      {/* Pop-out icon */}
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--theme-text-faint)]"
      >
        <rect x="3" y="3" width="13" height="13" rx="2" />
        <path d="M19 10V5h-5" />
        <line x1="19" y1="5" x2="11" y2="13" />
      </svg>

      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-[var(--theme-text-secondary)]">
          <span className="text-[var(--theme-accent)]">{displayName}</span> is floating
        </p>
        <p className="text-xs text-[var(--theme-text-faint)]">
          The session is visible in the floating overlay
        </p>
      </div>

      <button
        className="rounded px-3 py-1.5 text-xs font-medium transition-colors bg-[var(--theme-bg-hover)] hover:bg-[var(--theme-accent-muted)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] border border-[var(--theme-border)]"
        onClick={() => removeFloatingSession(session.id)}
      >
        Re-attach to main panel
      </button>
    </div>
  );
}
