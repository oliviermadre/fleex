import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { TERMINAL_THEME, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK } from '../lib/constants';
import type { Theme } from '../lib/themes';
import { AsmClipboardProvider } from './clipboardProvider';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  clipboardProvider: AsmClipboardProvider;
  serializedBuffer: string | null;
  /** The PTY session this terminal is connected to */
  sessionId: string;
  /** Unique key for this instance (= sessionId in normal mode, cell-specific in group mode) */
  instanceKey: string;
  lastActiveAt: number;
}

class TerminalManager {
  /** All terminal instances, keyed by instanceKey */
  private terminals = new Map<string, TerminalInstance>();
  /** sessionId → Set of instanceKeys watching that session (for output broadcast) */
  private sessionInstances = new Map<string, Set<string>>();
  private currentTerminalTheme = TERMINAL_THEME;

  create(instanceKey: string, sessionId: string = instanceKey): Terminal {
    const existing = this.terminals.get(instanceKey);
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

    terminal.parser.registerOscHandler(52, (data) => {
      console.debug('[ASM:OSC52] received', { len: data.length });
      return false;
    });

    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown' || ev.key !== 'c') return true;
      const isMacCopy = ev.metaKey && !ev.shiftKey && !ev.ctrlKey;
      const isLinuxCopy = ev.ctrlKey && ev.shiftKey && !ev.metaKey;
      if (!isMacCopy && !isLinuxCopy) return true;
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection()).then(
          () => console.debug('[ASM:Clipboard] copied xterm selection'),
          (err) => console.warn('[ASM:Clipboard] failed to copy xterm selection', err),
        );
        return false;
      }
      const pending = clipboardProvider.consumePendingText();
      if (pending) {
        navigator.clipboard.writeText(pending).then(
          () => console.debug('[ASM:Clipboard] copied pending OSC52 text'),
          (err) => console.warn('[ASM:Clipboard] failed to copy pending OSC52 text', err),
        );
        return false;
      }
      return true;
    });

    this.terminals.set(instanceKey, {
      terminal,
      fitAddon,
      serializeAddon,
      clipboardProvider,
      serializedBuffer: null,
      sessionId,
      instanceKey,
      lastActiveAt: Date.now(),
    });

    // Register in session→instances map
    if (!this.sessionInstances.has(sessionId)) {
      this.sessionInstances.set(sessionId, new Set());
    }
    this.sessionInstances.get(sessionId)!.add(instanceKey);

    this.loadWebGL(terminal);
    return terminal;
  }

  attach(instanceKey: string, container: HTMLElement): void {
    const instance = this.terminals.get(instanceKey);
    if (!instance) return;
    instance.lastActiveAt = Date.now();
    if (!instance.terminal.element) {
      instance.terminal.open(container);
    } else {
      container.appendChild(instance.terminal.element);
    }
    if (instance.serializedBuffer) {
      instance.terminal.write(instance.serializedBuffer);
      instance.serializedBuffer = null;
    }
    try { instance.fitAddon.fit(); } catch { /* not visible yet */ }
  }

  detach(instanceKey: string): void {
    const instance = this.terminals.get(instanceKey);
    if (!instance) return;
    try { instance.serializedBuffer = instance.serializeAddon.serialize(); } catch { instance.serializedBuffer = null; }
    if (instance.terminal.element?.parentElement) {
      instance.terminal.element.parentElement.removeChild(instance.terminal.element);
    }
  }

  /** Write output data to ALL terminal instances watching this sessionId */
  write(sessionId: string, data: string | Uint8Array): void {
    const instanceKeys = this.sessionInstances.get(sessionId);
    if (!instanceKeys) return;
    for (const key of instanceKeys) {
      this.terminals.get(key)?.terminal.write(data);
    }
  }

  resize(instanceKey: string): void {
    const instance = this.terminals.get(instanceKey);
    if (!instance) return;
    try { instance.fitAddon.fit(); } catch { /* ignore */ }
  }

  dispose(instanceKey: string): void {
    const instance = this.terminals.get(instanceKey);
    if (!instance) return;
    // Remove from session→instances map
    const set = this.sessionInstances.get(instance.sessionId);
    if (set) {
      set.delete(instanceKey);
      if (set.size === 0) this.sessionInstances.delete(instance.sessionId);
    }
    instance.terminal.dispose();
    this.terminals.delete(instanceKey);
  }

  disposeAll(): void {
    for (const [key] of this.terminals) this.dispose(key);
  }

  get(instanceKey: string): TerminalInstance | null {
    return this.terminals.get(instanceKey) ?? null;
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
      webgl.onContextLoss(() => { webgl.dispose(); });
      terminal.loadAddon(webgl);
    } catch { /* fallback to canvas */ }
  }
}

export const terminalManager = new TerminalManager();
