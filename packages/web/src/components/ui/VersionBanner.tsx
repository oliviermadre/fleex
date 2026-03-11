import { useVersionCheck } from '../../hooks/useVersionCheck';

export function VersionBanner() {
  const { versionInfo, showBanner, dismiss } = useVersionCheck();

  if (!showBanner || !versionInfo) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9998] max-w-sm rounded-md border border-blue-500/30 bg-blue-950 px-3 py-2 text-xs text-blue-400 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 flex items-start gap-2">
      <span className="flex-1">
        Fleex is {versionInfo.behindBy} commit{versionInfo.behindBy > 1 ? 's' : ''} behind{' '}
        <span className="text-blue-300 font-mono">origin/main</span>.
        {' '}Run <code className="bg-blue-900/50 px-1 rounded">fleex self-update</code> to update.
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
