import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { TERMINAL_THEME, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK } from '../lib/constants';
import type { Theme } from '../lib/themes';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  serializedBuffer: string | null;
  sessionId: string;
  lastActiveAt: number;
}

class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();
  private activeSessionId: string | null = null;
  private containerEl: HTMLElement | null = null;
  private currentTerminalTheme = TERMINAL_THEME;

  setContainer(el: HTMLElement | null): void {
    this.containerEl = el;
  }

  create(sessionId: string): Terminal {
    const existing = this.terminals.get(sessionId);
    if (existing) return existing.terminal;

    const terminal = new Terminal({
      theme: this.currentTerminalTheme,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      scrollback: TERMINAL_SCROLLBACK,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);

    this.terminals.set(sessionId, {
      terminal,
      fitAddon,
      serializeAddon,
      serializedBuffer: null,
      sessionId,
      lastActiveAt: Date.now(),
    });

    this.loadWebGL(terminal);

    return terminal;
  }

  attach(sessionId: string): void {
    if (!this.containerEl) return;
    const instance = this.terminals.get(sessionId);
    if (!instance) return;

    // Detach current if different
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      this.detach(this.activeSessionId);
    }

    this.activeSessionId = sessionId;
    instance.lastActiveAt = Date.now();

    // Open terminal in container if not already opened
    if (!instance.terminal.element) {
      instance.terminal.open(this.containerEl);
    } else {
      this.containerEl.appendChild(instance.terminal.element);
    }

    // Restore serialized buffer if available
    if (instance.serializedBuffer) {
      instance.terminal.write(instance.serializedBuffer);
      instance.serializedBuffer = null;
    }

    // Fit to container
    try {
      instance.fitAddon.fit();
    } catch {
      // Container may not be visible yet
    }

    instance.terminal.focus();
  }

  detach(sessionId: string): void {
    const instance = this.terminals.get(sessionId);
    if (!instance) return;

    // Serialize buffer before detaching
    try {
      instance.serializedBuffer = instance.serializeAddon.serialize();
    } catch {
      instance.serializedBuffer = null;
    }

    // Remove terminal DOM element from container
    if (instance.terminal.element?.parentElement) {
      instance.terminal.element.parentElement.removeChild(instance.terminal.element);
    }

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  write(sessionId: string, data: string | Uint8Array): void {
    const instance = this.terminals.get(sessionId);
    if (!instance) return;
    instance.terminal.write(data);
  }

  resize(sessionId: string): void {
    const instance = this.terminals.get(sessionId);
    if (!instance) return;
    try {
      instance.fitAddon.fit();
    } catch {
      // ignore
    }
  }

  dispose(sessionId: string): void {
    const instance = this.terminals.get(sessionId);
    if (!instance) return;

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }

    instance.terminal.dispose();
    this.terminals.delete(sessionId);
  }

  disposeAll(): void {
    for (const [id] of this.terminals) {
      this.dispose(id);
    }
  }

  getActive(): TerminalInstance | null {
    if (!this.activeSessionId) return null;
    return this.terminals.get(this.activeSessionId) ?? null;
  }

  get(sessionId: string): TerminalInstance | null {
    return this.terminals.get(sessionId) ?? null;
  }

  updateTheme(theme: Theme): void {
    const termTheme = {
      ...TERMINAL_THEME,
      background: theme.terminal.background,
      foreground: theme.terminal.foreground,
      cursor: theme.terminal.cursor,
      cursorAccent: theme.terminal.cursorAccent,
      selectionBackground: theme.terminal.selectionBackground,
    };
    this.currentTerminalTheme = termTheme;
    for (const [, instance] of this.terminals) {
      instance.terminal.options.theme = termTheme;
    }
  }

  private async loadWebGL(terminal: Terminal): Promise<void> {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
      });
      terminal.loadAddon(webgl);
    } catch {
      // WebGL not available, fallback to canvas renderer
    }
  }
}

export const terminalManager = new TerminalManager();
