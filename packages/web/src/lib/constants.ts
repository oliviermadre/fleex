import type { TerminalTheme } from '@asm/shared';

export const TERMINAL_THEME: TerminalTheme = {
  background: '#09090b',
  foreground: '#fafafa',
  cursor: '#a78bfa',
  cursorAccent: '#09090b',
  selectionBackground: '#3f3f46',
  black: '#18181b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
};

export const TERMINAL_FONT_FAMILY = '"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace';
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_SCROLLBACK = 10000;

export const API_URL = '/api';
export const WS_BASE_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
