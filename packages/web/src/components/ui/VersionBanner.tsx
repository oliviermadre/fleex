import { useEffect } from 'react';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { toast } from '../../lib/toast';

const TOAST_ID = 'version-behind';

/**
 * "Fleex is behind origin/main" — a persistent toast, not a surface of its own.
 * Renders nothing: it only drives `toast()`. Closing the toast (✕) remembers
 * the dismissal for this commit, as before.
 */
export function VersionBanner() {
  const { versionInfo, showBanner, dismiss } = useVersionCheck();

  useEffect(() => {
    if (!showBanner || !versionInfo) {
      toast.dismiss(TOAST_ID);
      return;
    }
    const n = versionInfo.behindBy;
    toast.show({
      id: TOAST_ID,
      tone: 'info',
      title: `Fleex is ${n} commit${n > 1 ? 's' : ''} behind origin/main`,
      message: 'Run fleex self-update to update.',
      detail: versionInfo.isWorktree ? 'Worktree: self-update only affects ~/.fleex/repo' : undefined,
      durationMs: null,
      onDismiss: (reason) => {
        if (reason === 'close') dismiss();
      },
    });
  }, [showBanner, versionInfo, dismiss]);

  return null;
}
