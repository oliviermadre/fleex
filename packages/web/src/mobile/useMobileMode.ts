import { useEffect, useState } from 'react';

/**
 * Mobile mode detection with explicit override.
 *
 * Priority:
 *   1. `?mobile` / `?desktop` URL params — persist an explicit choice
 *      (the PWA manifest uses `start_url: "/?mobile"` so the installed
 *      app always opens the mobile view).
 *   2. `fleex:mobileOverride` in localStorage — the persisted choice.
 *   3. Viewport width media query.
 */

const OVERRIDE_KEY = 'fleex:mobileOverride';
const MOBILE_QUERY = '(max-width: 767px)';

type MobileOverride = 'mobile' | 'desktop' | null;

function readOverride(): MobileOverride {
  const v = localStorage.getItem(OVERRIDE_KEY);
  return v === 'mobile' || v === 'desktop' ? v : null;
}

// URL params win once, then persist — evaluated a single time at module load.
(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('mobile')) localStorage.setItem(OVERRIDE_KEY, 'mobile');
  else if (params.has('desktop')) localStorage.setItem(OVERRIDE_KEY, 'desktop');
})();

/** Persist an explicit mode and reload (mobile/desktop don't share a layout tree). */
export function setMobileOverride(v: MobileOverride): void {
  if (v) localStorage.setItem(OVERRIDE_KEY, v);
  else localStorage.removeItem(OVERRIDE_KEY);
  window.location.reload();
}

export function useMobileMode(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const override = readOverride();
  if (override) return override === 'mobile';
  return matches;
}
