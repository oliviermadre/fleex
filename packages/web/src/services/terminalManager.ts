import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TERMINAL_THEME, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK } from '../lib/constants';
import type { Theme } from '../lib/themes';
import { AsmClipboardProvider } from './clipboardProvider';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  clipboardProvider: AsmClipboardProvider;
  serializedBuffer: string | null;
  sessionId: string;
  lastActiveAt: number;
}

class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();
  private currentTerminalTheme = TERMINAL_THEME;

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
      macOptionClickForcesSelection: true,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    const clipboardProvider = new AsmClipboardProvider();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));
    terminal.loadAddon(new WebLinksAddon());

    // Diagnostic: log OSC 52 sequences from tmux
    terminal.parser.registerOscHandler(52, (data) => {
      console.debug('[FLEEX:OSC52] received', { len: data.length });
      return false; // let ClipboardAddon handle it too
    });

    // Cmd+C (macOS) / Ctrl+Shift+C (Linux): copy from xterm selection or pending OSC 52 text
    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown' || ev.key !== 'c') return true;

      const isMacCopy = ev.metaKey && !ev.shiftKey && !ev.ctrlKey;
      const isLinuxCopy = ev.ctrlKey && ev.shiftKey && !ev.metaKey;
      if (!isMacCopy && !isLinuxCopy) return true;

      // Priority 1: xterm.js native selection (user gesture → clipboard works)
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection()).then(
          () => console.debug('[FLEEX:Clipboard] copied xterm selection'),
          (err) => console.warn('[FLEEX:Clipboard] failed to copy xterm selection', err),
        );
        return false;
      }

      // Priority 2: pending OSC 52 text that failed auto-write
      const pending = clipboardProvider.consumePendingText();
      if (pending) {
        navigator.clipboard.writeText(pending).then(
          () => console.debug('[FLEEX:Clipboard] copied pending OSC52 text'),
          (err) => console.warn('[FLEEX:Clipboard] failed to copy pending OSC52 text', err),
        );
        return false;
      }

      // No selection, no pending → let event through (Ctrl+C = SIGINT, etc.)
      return true;
    });

    this.terminals.set(sessionId, {
      terminal,
      fitAddon,
      serializeAddon,
      clipboardProvider,
      serializedBuffer: null,
      sessionId,
      lastActiveAt: Date.now(),
    });

    this.loadWebGL(terminal);

    return terminal;
  }

  attach(sessionId: string, container: HTMLElement): void {
    const instance = this.terminals.get(sessionId);
    if (!instance) return;

    instance.lastActiveAt = Date.now();

    // Open terminal in container if not already opened
    if (!instance.terminal.element) {
      instance.terminal.open(container);
    } else {
      container.appendChild(instance.terminal.element);
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

    instance.terminal.dispose();
    this.terminals.delete(sessionId);
  }

  disposeAll(): void {
    for (const [id] of this.terminals) {
      this.dispose(id);
    }
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
