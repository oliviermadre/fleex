import { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../lib/constants';

interface VersionInfo {
  version: string;
  commit: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DISMISSED_KEY = 'fleex-update-dismissed';

export function useVersionCheck() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? JSON.parse(raw) as { commit: string; at: number } : null;
  });

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/version`);
      if (res.ok) {
        const data: VersionInfo = await res.json();
        setVersionInfo(data);
      }
    } catch {
      // silently ignore
    }
  }, []);

  const dismiss = useCallback(() => {
    if (versionInfo?.latestCommit) {
      const entry = { commit: versionInfo.latestCommit, at: Date.now() };
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(entry));
      setDismissed(entry);
    }
  }, [versionInfo]);

  useEffect(() => {
    checkVersion();
    const id = setInterval(checkVersion, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkVersion]);

  const showBanner =
    versionInfo?.updateAvailable === true &&
    (!dismissed || dismissed.commit !== versionInfo.latestCommit);

  return { versionInfo, showBanner, dismiss };
}
