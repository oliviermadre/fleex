export interface ThemeColors {
  accent: string;
  accentHover: string;
  accentActive: string;
  accentMuted: string;
  bgBase: string;
  bgSurface: string;
  bgOverlay: string;
  bgHover: string;
  bgOverlayHover: string;
  border: string;
  borderSubtle: string;
  borderInput: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  success: string;
  warning: string;
  danger: string;
}

export interface SyntaxThemeColors {
  keyword: string;      // if, for, class, function
  string: string;       // "hello world"
  number: string;       // 123, 0.45
  comment: string;      // // comments
  operator: string;     // =, +, -
  function: string;     // function names
  variable: string;     // variable names
  type: string;         // int, string, boolean
  constant: string;     // true, false, null
  regex: string;        // /pattern/g
}

export interface TerminalThemeOverrides {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
}

export interface Theme {
  id: string;
  name: string;
  builtIn: boolean;
  colors: ThemeColors;
  syntax: SyntaxThemeColors;
  terminal: TerminalThemeOverrides;
}

/**
 * Neutral (non-accent) color tokens shared verbatim by the zinc-based dark
 * themes (Ember, Ocean, Verdant). Only their accent palette differs, so the
 * neutrals are factored out here to keep them in sync.
 */
const ZINC_DARK_NEUTRALS = {
  bgBase: '#09090b',
  bgSurface: '#18181b',
  bgOverlay: '#27272a',
  bgHover: 'rgba(39, 39, 42, 0.5)',
  bgOverlayHover: '#3f3f46',
  border: '#27272a',
  borderSubtle: 'rgba(39, 39, 42, 0.5)',
  borderInput: '#3f3f46',
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  textFaint: '#52525b',
  success: '#22c55e',
  warning: '#eab308',
  danger: '#ef4444',
} satisfies Omit<ThemeColors, 'accent' | 'accentHover' | 'accentActive' | 'accentMuted'>;

export const THEME_EMBER: Theme = {
  id: 'ember',
  name: 'Ember',
  builtIn: true,
  colors: {
    accent: '#D77655',
    accentHover: '#e08868',
    accentActive: '#b85a3a',
    accentMuted: 'rgba(215, 118, 85, 0.15)',
    ...ZINC_DARK_NEUTRALS,
  },
  syntax: {
    keyword: '#f97316',     // orange-500 - warm like ember
    string: '#84cc16',      // lime-500
    number: '#fbbf24',      // amber-400
    comment: '#71717a',     // matches textMuted
    operator: '#D77655',    // accent color
    function: '#f59e0b',    // amber-500
    variable: '#fafafa',    // textPrimary
    type: '#fb923c',        // orange-400
    constant: '#ef4444',    // red-500
    regex: '#f472b6',       // pink-400
  },
  terminal: {
    background: '#09090b',
    foreground: '#fafafa',
    cursor: '#a78bfa',
    cursorAccent: '#09090b',
    selectionBackground: '#3f3f46',
  },
};

export const THEME_OCEAN: Theme = {
  id: 'ocean',
  name: 'Ocean',
  builtIn: true,
  colors: {
    accent: '#3b82f6',
    accentHover: '#60a5fa',
    accentActive: '#2563eb',
    accentMuted: 'rgba(59, 130, 246, 0.15)',
    ...ZINC_DARK_NEUTRALS,
  },
  syntax: {
    keyword: '#60a5fa',     // blue-400 - ocean blue
    string: '#34d399',      // emerald-400
    number: '#fbbf24',      // amber-400
    comment: '#71717a',     // matches textMuted
    operator: '#3b82f6',    // accent color
    function: '#a78bfa',    // violet-400
    variable: '#fafafa',    // textPrimary
    type: '#22d3ee',        // cyan-400
    constant: '#f472b6',    // pink-400
    regex: '#fb7185',       // rose-400
  },
  terminal: {
    background: '#09090b',
    foreground: '#fafafa',
    cursor: '#60a5fa',
    cursorAccent: '#09090b',
    selectionBackground: '#1e3a5f',
  },
};

export const THEME_VERDANT: Theme = {
  id: 'verdant',
  name: 'Verdant',
  builtIn: true,
  colors: {
    accent: '#22c55e',
    accentHover: '#4ade80',
    accentActive: '#16a34a',
    accentMuted: 'rgba(34, 197, 94, 0.15)',
    ...ZINC_DARK_NEUTRALS,
  },
  syntax: {
    keyword: '#4ade80',     // green-400 - verdant green
    string: '#84cc16',      // lime-500
    number: '#fbbf24',      // amber-400
    comment: '#71717a',     // matches textMuted
    operator: '#22c55e',    // accent color
    function: '#a3e635',    // lime-400
    variable: '#fafafa',    // textPrimary
    type: '#10b981',        // emerald-500
    constant: '#ef4444',    // red-500
    regex: '#f472b6',       // pink-400
  },
  terminal: {
    background: '#09090b',
    foreground: '#fafafa',
    cursor: '#4ade80',
    cursorAccent: '#09090b',
    selectionBackground: '#14532d',
  },
};

export const THEME_LIGHT: Theme = {
  id: 'light',
  name: 'Light',
  builtIn: true,
  colors: {
    accent: '#6366f1',
    accentHover: '#818cf8',
    accentActive: '#4f46e5',
    accentMuted: 'rgba(99, 102, 241, 0.12)',
    bgBase: '#f4f4f5',
    bgSurface: '#ffffff',
    bgOverlay: '#e4e4e7',
    bgHover: 'rgba(228, 228, 231, 0.6)',
    bgOverlayHover: '#d4d4d8',
    border: '#d4d4d8',
    borderSubtle: 'rgba(212, 212, 216, 0.5)',
    borderInput: '#a1a1aa',
    textPrimary: '#18181b',
    textSecondary: '#52525b',
    textMuted: '#71717a',
    textFaint: '#a1a1aa',
    success: '#16a34a',
    warning: '#ca8a04',
    danger: '#dc2626',
  },
  syntax: {
    keyword: '#7c3aed',     // violet-600
    string: '#059669',      // emerald-600
    number: '#dc2626',      // red-600
    comment: '#71717a',     // matches textMuted
    operator: '#374151',    // gray-700
    function: '#2563eb',    // blue-600
    variable: '#1f2937',    // gray-800
    type: '#0891b2',        // cyan-600
    constant: '#be185d',    // pink-600
    regex: '#c026d3',       // fuchsia-600
  },
  terminal: {
    background: '#f4f4f5',
    foreground: '#18181b',
    cursor: '#6366f1',
    cursorAccent: '#f4f4f5',
    selectionBackground: '#c7d2fe',
  },
};

export const THEME_DARK: Theme = {
  id: 'dark',
  name: 'Dark',
  builtIn: true,
  colors: {
    accent: '#a78bfa',
    accentHover: '#c4b5fd',
    accentActive: '#7c3aed',
    accentMuted: 'rgba(167, 139, 250, 0.15)',
    bgBase: '#0f172a',
    bgSurface: '#1e293b',
    bgOverlay: '#334155',
    bgHover: 'rgba(51, 65, 85, 0.5)',
    bgOverlayHover: '#475569',
    border: '#334155',
    borderSubtle: 'rgba(51, 65, 85, 0.5)',
    borderInput: '#475569',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    textFaint: '#475569',
    success: '#22c55e',
    warning: '#eab308',
    danger: '#ef4444',
  },
  syntax: {
    keyword: '#c4b5fd',     // violet-300
    string: '#86efac',      // green-300
    number: '#fdba74',      // orange-300
    comment: '#64748b',     // matches textMuted
    operator: '#a78bfa',    // accent color
    function: '#7dd3fc',    // sky-300
    variable: '#f1f5f9',    // textPrimary
    type: '#67e8f9',        // cyan-300
    constant: '#f472b6',    // pink-400
    regex: '#f9a8d4',       // pink-300
  },
  terminal: {
    background: '#0f172a',
    foreground: '#f1f5f9',
    cursor: '#a78bfa',
    cursorAccent: '#0f172a',
    selectionBackground: '#334155',
  },
};

export const THEME_MATRIX: Theme = {
  id: 'matrix',
  name: 'Matrix',
  builtIn: true,
  colors: {
    accent: '#22c55e',
    accentHover: '#4ade80',
    accentActive: '#16a34a',
    accentMuted: 'rgba(34, 197, 94, 0.12)',
    bgBase: '#000000',
    bgSurface: '#0a0a0a',
    bgOverlay: '#141414',
    bgHover: 'rgba(34, 197, 94, 0.08)',
    bgOverlayHover: '#242424',
    border: '#1a2e1a',
    borderSubtle: 'rgba(34, 197, 94, 0.1)',
    borderInput: '#1f3d1f',
    textPrimary: '#4ade80',
    textSecondary: '#22c55e',
    textMuted: '#15803d',
    textFaint: '#14532d',
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#ef4444',
  },
  syntax: {
    keyword: '#4ade80',     // green-400 - matrix green
    string: '#a3e635',      // lime-400
    number: '#22c55e',      // green-500
    comment: '#15803d',     // matches textMuted
    operator: '#22c55e',    // accent color
    function: '#84cc16',    // lime-500
    variable: '#4ade80',    // textPrimary
    type: '#10b981',        // emerald-500
    constant: '#16a34a',    // green-600
    regex: '#eab308',       // yellow-500
  },
  terminal: {
    background: '#000000',
    foreground: '#4ade80',
    cursor: '#22c55e',
    cursorAccent: '#000000',
    selectionBackground: '#14532d',
  },
};

export const THEME_SUMMER: Theme = {
  id: 'summer',
  name: 'Summer',
  builtIn: true,
  colors: {
    accent: '#0ea5e9',
    accentHover: '#38bdf8',
    accentActive: '#0284c7',
    accentMuted: 'rgba(14, 165, 233, 0.12)',
    bgBase: '#fefce8',
    bgSurface: '#fffbeb',
    bgOverlay: '#fef3c7',
    bgHover: 'rgba(254, 243, 199, 0.6)',
    bgOverlayHover: '#fde68a',
    border: '#fde68a',
    borderSubtle: 'rgba(253, 230, 138, 0.5)',
    borderInput: '#fcd34d',
    textPrimary: '#1c1917',
    textSecondary: '#57534e',
    textMuted: '#78716c',
    textFaint: '#a8a29e',
    success: '#16a34a',
    warning: '#ca8a04',
    danger: '#dc2626',
  },
  syntax: {
    keyword: '#0ea5e9',     // sky-500 - summer sky blue
    string: '#16a34a',      // green-600
    number: '#dc2626',      // red-600
    comment: '#78716c',     // matches textMuted
    operator: '#57534e',    // stone-600
    function: '#7c2d12',    // orange-800
    variable: '#1c1917',    // textPrimary
    type: '#0891b2',        // cyan-600
    constant: '#be185d',    // pink-600
    regex: '#a21caf',       // fuchsia-700
  },
  terminal: {
    background: '#fffbeb',
    foreground: '#1c1917',
    cursor: '#0ea5e9',
    cursorAccent: '#fffbeb',
    selectionBackground: '#bae6fd',
  },
};

export const THEME_FALL: Theme = {
  id: 'fall',
  name: 'Fall',
  builtIn: true,
  colors: {
    accent: '#d97706',
    accentHover: '#f59e0b',
    accentActive: '#b45309',
    accentMuted: 'rgba(217, 119, 6, 0.15)',
    bgBase: '#1c1210',
    bgSurface: '#292018',
    bgOverlay: '#3d2e1e',
    bgHover: 'rgba(61, 46, 30, 0.5)',
    bgOverlayHover: '#4d3a27',
    border: '#3d2e1e',
    borderSubtle: 'rgba(61, 46, 30, 0.5)',
    borderInput: '#5c4033',
    textPrimary: '#fef3c7',
    textSecondary: '#d6a87c',
    textMuted: '#a18072',
    textFaint: '#6b5347',
    success: '#22c55e',
    warning: '#fbbf24',
    danger: '#ef4444',
  },
  syntax: {
    keyword: '#f59e0b',     // amber-500 - fall orange
    string: '#84cc16',      // lime-500
    number: '#fbbf24',      // amber-400
    comment: '#a18072',     // matches textMuted
    operator: '#d97706',    // accent color
    function: '#fb923c',    // orange-400
    variable: '#fef3c7',    // textPrimary
    type: '#22d3ee',        // cyan-400
    constant: '#ef4444',    // red-500
    regex: '#f472b6',       // pink-400
  },
  terminal: {
    background: '#1c1210',
    foreground: '#fef3c7',
    cursor: '#d97706',
    cursorAccent: '#1c1210',
    selectionBackground: '#5c4033',
  },
};

export const THEME_LATTE: Theme = {
  id: 'latte',
  name: 'Catppuccin Latte',
  builtIn: true,
  colors: {
    accent: '#1e66f5',
    accentHover: '#7287fd',
    accentActive: '#209fb5',
    accentMuted: 'rgba(30, 102, 245, 0.12)',
    bgBase: '#eff1f5',
    bgSurface: '#e6e9ef',
    bgOverlay: '#dce0e8',
    bgHover: 'rgba(204, 208, 218, 0.5)',
    bgOverlayHover: '#c5cad6',
    border: '#ccd0da',
    borderSubtle: 'rgba(204, 208, 218, 0.5)',
    borderInput: '#bcc0cc',
    textPrimary: '#4c4f69',
    textSecondary: '#5c5f77',
    textMuted: '#6c6f85',
    textFaint: '#8c8fa1',
    success: '#40a02b',
    warning: '#df8e1d',
    danger: '#d20f39',
  },
  syntax: {
    keyword: '#8839ef',     // Catppuccin Latte Mauve
    string: '#40a02b',      // Catppuccin Latte Green
    number: '#fe640b',      // Catppuccin Latte Peach
    comment: '#6c6f85',     // matches textMuted
    operator: '#04a5e5',    // Catppuccin Latte Sapphire
    function: '#1e66f5',    // Catppuccin Latte Blue
    variable: '#4c4f69',    // textPrimary
    type: '#179299',        // Catppuccin Latte Teal
    constant: '#e64553',    // Catppuccin Latte Red
    regex: '#ea76cb',       // Catppuccin Latte Pink
  },
  terminal: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    cursorAccent: '#eff1f5',
    selectionBackground: 'rgba(124, 127, 147, 0.3)',
  },
};

export const BUILT_IN_THEMES: Theme[] = [
  THEME_EMBER,
  THEME_OCEAN,
  THEME_VERDANT,
  THEME_LIGHT,
  THEME_DARK,
  THEME_MATRIX,
  THEME_SUMMER,
  THEME_FALL,
  THEME_LATTE,
];

export const DEFAULT_THEME_ID = 'verdant';

const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  accent: '--theme-accent',
  accentHover: '--theme-accent-hover',
  accentActive: '--theme-accent-active',
  accentMuted: '--theme-accent-muted',
  bgBase: '--theme-bg-base',
  bgSurface: '--theme-bg-surface',
  bgOverlay: '--theme-bg-overlay',
  bgHover: '--theme-bg-hover',
  bgOverlayHover: '--theme-bg-overlay-hover',
  border: '--theme-border',
  borderSubtle: '--theme-border-subtle',
  borderInput: '--theme-border-input',
  textPrimary: '--theme-text-primary',
  textSecondary: '--theme-text-secondary',
  textMuted: '--theme-text-muted',
  textFaint: '--theme-text-faint',
  success: '--theme-success',
  warning: '--theme-warning',
  danger: '--theme-danger',
};

const SYNTAX_CSS_VAR_MAP: Record<keyof SyntaxThemeColors, string> = {
  keyword: '--syntax-keyword',
  string: '--syntax-string',
  number: '--syntax-number',
  comment: '--syntax-comment',
  operator: '--syntax-operator',
  function: '--syntax-function',
  variable: '--syntax-variable',
  type: '--syntax-type',
  constant: '--syntax-constant',
  regex: '--syntax-regex',
};

/** Parse a hex color (#rrggbb or #rgb) and return rgba(r, g, b, alpha) */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Apply theme colors
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    root.style.setProperty(cssVar, theme.colors[key as keyof ThemeColors]);
  }

  // Apply syntax colors
  for (const [key, cssVar] of Object.entries(SYNTAX_CSS_VAR_MAP)) {
    root.style.setProperty(cssVar, theme.syntax[key as keyof SyntaxThemeColors]);
  }

  // Computed glass variables (semi-transparent backgrounds for liquidglass effect)
  root.style.setProperty(
    '--theme-glass-surface',
    hexToRgba(theme.colors.bgSurface, 0.55),
  );
  root.style.setProperty(
    '--theme-glass-surface-dense',
    hexToRgba(theme.colors.bgSurface, 0.92),
  );
  root.style.setProperty(
    '--theme-glass-overlay',
    hexToRgba(theme.colors.bgOverlay, 0.55),
  );
}

export function resolveTheme(themeId: string, customThemes: Theme[]): Theme {
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === themeId);
  if (builtIn) return builtIn;

  const custom = customThemes.find((t) => t.id === themeId);
  if (custom) return custom;

  return THEME_VERDANT;
}

/** Relative luminance (0–1) of an #rrggbb / #rgb color. */
function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  // sRGB perceptual weighting — precise enough to separate light vs dark bases.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether a theme reads as "light" (bright base background). Drives the React
 * Flow `colorMode` so the workflow DAG canvas follows the active theme instead
 * of being permanently dark. Derived from the base background's luminance, so
 * it works for built-in AND custom themes without an extra declared field.
 */
export function isLightTheme(theme: Theme): boolean {
  return relativeLuminance(theme.colors.bgBase) > 0.5;
}
