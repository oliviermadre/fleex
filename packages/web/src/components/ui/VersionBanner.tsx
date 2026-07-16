import { useVersionCheck } from '../../hooks/useVersionCheck';
import { tint, tintText, tintClasses } from '../../lib/tints';
import { cn } from '../../lib/cn';

export function VersionBanner() {
  const { versionInfo, showBanner, dismiss } = useVersionCheck();

  if (!showBanner || !versionInfo) return null;

  return (
    <div className={cn('fixed bottom-4 right-4 z-[9998] max-w-sm rounded-md px-3 py-2 text-xs shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 flex items-start gap-2', tint('blue'))}>
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
