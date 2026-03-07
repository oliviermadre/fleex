import { useState, useEffect } from 'react';

interface SaveStatusProps {
  saving: boolean;
  savedAt: number | null;
  dirty: boolean;
}

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'Saved just now';
  if (seconds < 60) return `Saved ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Saved ${minutes}m ago`;
}

export function SaveStatus({ saving, savedAt, dirty }: SaveStatusProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!savedAt || dirty || saving) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [savedAt, dirty, saving]);

  if (saving) {
    return <span className="text-xs text-[var(--theme-text-muted)]">Saving...</span>;
  }

  if (savedAt && !dirty) {
    return <span className="text-xs text-[var(--theme-text-muted)]">{formatTimeAgo(savedAt)}</span>;
  }

  return null;
}
