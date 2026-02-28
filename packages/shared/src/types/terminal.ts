import type { TerminalDimensions } from './session.js';

export interface PtyHandle {
  write(data: string): void;
  resize(dims: TerminalDimensions): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (exitCode: number, signal: number) => void): void;
  kill(): void;
  readonly isAlive: boolean;
}

export interface TerminalConfig {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly theme: TerminalTheme;
  readonly cursorBlink: boolean;
  readonly scrollback: number;
}

export interface TerminalTheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}
