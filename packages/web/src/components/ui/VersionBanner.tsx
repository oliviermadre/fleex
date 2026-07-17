import { useVersionCheck } from '../../hooks/useVersionCheck';
import { tintClasses } from '../../lib/tints';
import { cn } from '../../lib/cn';

export function VersionBanner() {
  const { versionInfo, showBanner, dismiss } = useVersionCheck();

  if (!showBanner || !versionInfo) return null;

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[9998] max-w-sm flex items-start gap-2',
        // Opaque surface so page content never bleeds through (readable at 100%);
        // the informational (blue) type is conveyed by the left-border accent,
        // mirroring ToastContainer / NotificationCard — not a translucent tint bg.
        'rounded-md border border-[var(--theme-border)] border-l-2 border-l-[var(--tint-blue-solid)]',
        'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]',
        'px-3 py-2 text-xs shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200',
      )}
    >
      <span className="flex-1">
        Fleex is {versionInfo.behindBy} commit{versionInfo.behindBy > 1 ? 's' : ''} behind{' '}
        <span className={cn('font-mono', tintClasses('blue').solidText)}>origin/main</span>.
        {' '}Run <code className={cn('px-1 rounded', tintClasses('blue').bg)}>fleex self-update</code> to update.
        {versionInfo.isWorktree && (
          <>
            <br />
            <span className="italic opacity-70">You're in a worktree — self-update only affects <code className={cn('px-1 rounded', tintClasses('blue').bg)}>~/.fleex/repo</code>.</span>
          </>
        )}
      </span>
      <button
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        onClick={dismiss}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
    </div>
  );
}
