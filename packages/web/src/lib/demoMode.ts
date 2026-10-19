/**
 * `?demo=1` / `?theme=<id>` — read ONCE, at module load.
 *
 * Used by `fleex shoot` (headless screenshots, docs/releases.md): in demo mode
 * the version banner and the toasts are not mounted and animations are off, so
 * every capture is stable. RouterSync rewrites the URL (and drops the query)
 * right after boot, hence the module-level constants.
 */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const DEMO_MODE: boolean = params.get('demo') === '1';

/** Theme forced from the URL; wins over `settings.activeThemeId`. */
export const FORCED_THEME_ID: string | null = params.get('theme') || null;

/** Freezes animations, transitions and the caret for pixel-stable screenshots. */
export const DEMO_MODE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
