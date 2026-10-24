import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../lib/toast';
import { API_URL } from '../lib/constants';
import { hasUnseenRelease, useReleaseStore } from '../stores/releaseStore';

/**
 * "Fleex was just updated": once per release, right after an update, a toast
 * points at the Nouveautés page.
 *
 * "Just updated" = the commit the server runs differs from the one stored on
 * the previous visit. A first-ever visit only records the commit.
 */
export const LAST_BOOT_COMMIT_KEY = 'fleex-last-boot-commit';
export const RELEASE_TOAST_SHOWN_KEY = 'fleex-release-toast-shown';

export interface ReleaseAnnouncementInput {
  /** Newest release number. */
  current: number | null;
  /** Last release the user opened (`fleex-last-seen-release`). */
  lastSeen: number | null;
  /** Release whose toast was already shown (`fleex-release-toast-shown`). */
  toastShown: number | null;
  /** Commit recorded on the previous visit (`fleex-last-boot-commit`). */
  storedCommit: string | null;
  /** Commit the server runs now (`/api/version`). */
  currentCommit: string | null;
}

export function shouldAnnounceRelease(i: ReleaseAnnouncementInput): boolean {
  if (i.current === null || !i.currentCommit) return false;
  if (!i.storedCommit || i.storedCommit === i.currentCommit) return false;
  if (!hasUnseenRelease(i.current, i.lastSeen)) return false;
  return i.toastShown === null || i.toastShown < i.current;
}

function readNumber(key: string): number | null {
  const raw = localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function fetchCurrentCommit(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/version`);
    if (!res.ok) return null;
    const data = (await res.json()) as { commit?: string | null };
    return data.commit ?? null;
  } catch {
    return null;
  }
}

export function useReleaseAnnouncement(): void {
  const navigate = useNavigate();
  const loaded = useReleaseStore((s) => s.loaded);
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    void (async () => {
      const currentCommit = await fetchCurrentCommit();
      if (!currentCommit) return;
      try {
        const { current, releases, lastSeen } = useReleaseStore.getState();
        const storedCommit = localStorage.getItem(LAST_BOOT_COMMIT_KEY);
        const toastShown = readNumber(RELEASE_TOAST_SHOWN_KEY);
        localStorage.setItem(LAST_BOOT_COMMIT_KEY, currentCommit);
        if (!shouldAnnounceRelease({ current, lastSeen, toastShown, storedCommit, currentCommit })) return;
        const release = releases.find((r) => r.number === current);
        if (!release) return;
        localStorage.setItem(RELEASE_TOAST_SHOWN_KEY, String(release.number));
        toast.show({
          id: `release-${release.number}`,
          tone: 'action',
          title: `Fleex #${release.number} : ${release.title}`,
          message: release.tagline ?? 'Fleex vient d’être mis à jour.',
          action: { label: 'Voir les nouveautés', onClick: () => navigate('/releases') },
          durationMs: null,
        });
      } catch {
        // localStorage unavailable: no announcement, nothing else breaks
      }
    })();
  }, [loaded, navigate]);
}
