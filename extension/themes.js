'use strict';

// Built-in Fleex theme palettes — kept for resolveTheme() backward-compat.
// Custom themes are read at runtime from each workspace's app_config.
const FLEEX_THEMES = {"ember":{"name":"Ember","light":false,"colors":{"accent":"#D77655","accentHover":"#e08868","accentActive":"#b85a3a","accentMuted":"rgba(215, 118, 85, 0.15)","bgBase":"#09090b","bgSurface":"#18181b","bgOverlay":"#27272a","bgHover":"rgba(39, 39, 42, 0.5)","border":"#27272a","borderSubtle":"rgba(39, 39, 42, 0.5)","borderInput":"#3f3f46","textPrimary":"#fafafa","textSecondary":"#a1a1aa","textMuted":"#71717a","textFaint":"#52525b","success":"#22c55e","warning":"#eab308","danger":"#ef4444"}},"ocean":{"name":"Ocean","light":false,"colors":{"accent":"#3b82f6","accentHover":"#60a5fa","accentActive":"#2563eb","accentMuted":"rgba(59, 130, 246, 0.15)","bgBase":"#09090b","bgSurface":"#18181b","bgOverlay":"#27272a","bgHover":"rgba(39, 39, 42, 0.5)","border":"#27272a","borderSubtle":"rgba(39, 39, 42, 0.5)","borderInput":"#3f3f46","textPrimary":"#fafafa","textSecondary":"#a1a1aa","textMuted":"#71717a","textFaint":"#52525b","success":"#22c55e","warning":"#eab308","danger":"#ef4444"}},"verdant":{"name":"Verdant","light":false,"colors":{"accent":"#22c55e","accentHover":"#4ade80","accentActive":"#16a34a","accentMuted":"rgba(34, 197, 94, 0.15)","bgBase":"#09090b","bgSurface":"#18181b","bgOverlay":"#27272a","bgHover":"rgba(39, 39, 42, 0.5)","border":"#27272a","borderSubtle":"rgba(39, 39, 42, 0.5)","borderInput":"#3f3f46","textPrimary":"#fafafa","textSecondary":"#a1a1aa","textMuted":"#71717a","textFaint":"#52525b","success":"#22c55e","warning":"#eab308","danger":"#ef4444"}},"light":{"name":"Light","light":true,"colors":{"accent":"#6366f1","accentHover":"#818cf8","accentActive":"#4f46e5","accentMuted":"rgba(99, 102, 241, 0.12)","bgBase":"#f4f4f5","bgSurface":"#ffffff","bgOverlay":"#e4e4e7","bgHover":"rgba(228, 228, 231, 0.6)","border":"#d4d4d8","borderSubtle":"rgba(212, 212, 216, 0.5)","borderInput":"#a1a1aa","textPrimary":"#18181b","textSecondary":"#52525b","textMuted":"#71717a","textFaint":"#a1a1aa","success":"#16a34a","warning":"#ca8a04","danger":"#dc2626"}},"dark":{"name":"Dark","light":false,"colors":{"accent":"#a78bfa","accentHover":"#c4b5fd","accentActive":"#7c3aed","accentMuted":"rgba(167, 139, 250, 0.15)","bgBase":"#0f172a","bgSurface":"#1e293b","bgOverlay":"#334155","bgHover":"rgba(51, 65, 85, 0.5)","border":"#334155","borderSubtle":"rgba(51, 65, 85, 0.5)","borderInput":"#475569","textPrimary":"#f1f5f9","textSecondary":"#94a3b8","textMuted":"#64748b","textFaint":"#475569","success":"#22c55e","warning":"#eab308","danger":"#ef4444"}},"matrix":{"name":"Matrix","light":false,"colors":{"accent":"#22c55e","accentHover":"#4ade80","accentActive":"#16a34a","accentMuted":"rgba(34, 197, 94, 0.12)","bgBase":"#000000","bgSurface":"#0a0a0a","bgOverlay":"#141414","bgHover":"rgba(34, 197, 94, 0.08)","border":"#1a2e1a","borderSubtle":"rgba(34, 197, 94, 0.1)","borderInput":"#1f3d1f","textPrimary":"#4ade80","textSecondary":"#22c55e","textMuted":"#15803d","textFaint":"#14532d","success":"#4ade80","warning":"#fbbf24","danger":"#ef4444"}},"summer":{"name":"Summer","light":true,"colors":{"accent":"#0ea5e9","accentHover":"#38bdf8","accentActive":"#0284c7","accentMuted":"rgba(14, 165, 233, 0.12)","bgBase":"#fefce8","bgSurface":"#fffbeb","bgOverlay":"#fef3c7","bgHover":"rgba(254, 243, 199, 0.6)","border":"#fde68a","borderSubtle":"rgba(253, 230, 138, 0.5)","borderInput":"#fcd34d","textPrimary":"#1c1917","textSecondary":"#57534e","textMuted":"#78716c","textFaint":"#a8a29e","success":"#16a34a","warning":"#ca8a04","danger":"#dc2626"}},"fall":{"name":"Fall","light":false,"colors":{"accent":"#d97706","accentHover":"#f59e0b","accentActive":"#b45309","accentMuted":"rgba(217, 119, 6, 0.15)","bgBase":"#1c1210","bgSurface":"#292018","bgOverlay":"#3d2e1e","bgHover":"rgba(61, 46, 30, 0.5)","border":"#3d2e1e","borderSubtle":"rgba(61, 46, 30, 0.5)","borderInput":"#5c4033","textPrimary":"#fef3c7","textSecondary":"#d6a87c","textMuted":"#a18072","textFaint":"#6b5347","success":"#22c55e","warning":"#fbbf24","danger":"#ef4444"}},"latte":{"name":"Catppuccin Latte","light":true,"colors":{"accent":"#1e66f5","accentHover":"#7287fd","accentActive":"#209fb5","accentMuted":"rgba(30, 102, 245, 0.12)","bgBase":"#eff1f5","bgSurface":"#e6e9ef","bgOverlay":"#dce0e8","bgHover":"rgba(204, 208, 218, 0.5)","border":"#ccd0da","borderSubtle":"rgba(204, 208, 218, 0.5)","borderInput":"#bcc0cc","textPrimary":"#4c4f69","textSecondary":"#5c5f77","textMuted":"#6c6f85","textFaint":"#8c8fa1","success":"#40a02b","warning":"#df8e1d","danger":"#d20f39"}}};

// Rough perceived-luminance check (0–1 scale) for hex colors.
function isLightBg(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

// Resolve {colors, light} from an activeThemeId + workspace customThemes.
function resolveTheme(activeThemeId, customThemes) {
  const builtIn = FLEEX_THEMES[activeThemeId];
  if (builtIn) return { colors: builtIn.colors, light: builtIn.light };
  const custom = (customThemes || []).find((t) => t && t.id === activeThemeId);
  if (custom && custom.colors) return { colors: custom.colors, light: isLightBg(custom.colors.bgBase) };
  return null;
}

// ── Design-system theme API ────────────────────────────────────────────────

// WCAG relative luminance (0–1) for a #rrggbb hex color.
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return [0.2126, 0.7152, 0.0722].reduce((sum, w, i) => {
    let v = ((n >> (16 - i * 8)) & 255) / 255;
    v = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return sum + w * v;
  }, 0);
}

// Returns '#000' or '#fff' for best contrast text on the given accent background.
function onAccent(hex) {
  return luminance(hex) > 0.179 ? '#000' : '#fff';
}

// Compute the full design-system CSS variable map from an accent color + mode.
function computeTheme(accent, isDark) {
  const base = isDark ? {
    '--bg': '#0b111d',
    '--surface': '#121b2b',
    '--surface-2': 'rgba(22,34,53,0.5)',
    '--border': 'rgba(148,163,184,0.16)',
    '--border-strong': 'rgba(148,163,184,0.30)',
    '--text': '#e6edf6',
    '--text-dim': '#9fb0c5',
    '--text-faint': '#647389',
  } : {
    '--bg': '#f4f6fa',
    '--surface': '#ffffff',
    '--surface-2': '#f0f3f8',
    '--border': 'rgba(30,41,59,0.12)',
    '--border-strong': 'rgba(30,41,59,0.22)',
    '--text': '#14202e',
    '--text-dim': '#475569',
    '--text-faint': '#8696a8',
  };
  const bgBase = isDark ? '#0b111d' : '#f4f6fa';
  const mix = (pct) => `color-mix(in srgb, ${accent} ${pct}%, ${bgBase})`;
  return {
    ...base,
    '--accent': accent,
    '--on-accent': onAccent(accent),
    '--user-bg': mix(isDark ? 14 : 12),
    '--user-bd': mix(isDark ? 30 : 25),
    '--accent-soft': mix(isDark ? 10 : 8),
    '--accent-line': mix(isDark ? 35 : 30),
    '--shadow': isDark ? 'rgba(0,0,0,0.45)' : 'rgba(30,41,59,0.12)',
    '--success': isDark ? '#22c55e' : '#16a34a',
    '--warning': isDark ? '#eab308' : '#ca8a04',
    '--danger': isDark ? '#ef4444' : '#dc2626',
  };
}

// Apply a theme to :root. Accepts either a resolveTheme() result {colors, light}
// or a raw CSS-var map from computeTheme(). Pass transition=true to animate the
// background/color change over 0.4s (workspace switch).
function applyTheme(resolved, transition = false) {
  const root = document.documentElement;
  if (!resolved) {
    root.removeAttribute('data-theme');
    root.style.cssText = '';
    return;
  }
  let vars;
  if (resolved.colors) {
    const accent = resolved.colors.accent || '#6366f1';
    vars = computeTheme(accent, !resolved.light);
  } else {
    vars = resolved;
  }
  if (transition) {
    root.style.transition = 'background 0.4s ease, color 0.4s ease';
    setTimeout(() => { root.style.transition = ''; }, 500);
  }
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute('data-theme', isLightBg(vars['--bg'] || '') ? 'light' : 'dark');
}
