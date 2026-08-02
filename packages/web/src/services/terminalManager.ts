import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TERMINAL_THEME, TERMINAL_ANSI_LIGHT, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK } from '../lib/constants';
import { isLightTheme, type Theme } from '../lib/themes';
import { AsmClipboardProvider } from './clipboardProvider';
import {
  getTerminalAppearance,
  subscribeTerminalAppearance,
  type TerminalAppearance,
} from './terminalAppearance';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  clipboardProvider: AsmClipboardProvider;
  serializedBuffer: string | null;
  sessionId: string;
  lastActiveAt: number;
  webglAddon: import('@xterm/addon-webgl').WebglAddon | null;
  isFloating: boolean;
}

class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();
  private currentTerminalTheme = TERMINAL_THEME;
  private currentFontFamily = TERMINAL_FONT_FAMILY;
  private currentFontSize = TERMINAL_FONT_SIZE;
  private currentFontThicken = false;

  create(sessionId: string): Terminal {
    const existing = this.terminals.get(sessionId);
    if (existing) return existing.terminal;

    const terminal = new Terminal({
      theme: this.currentTerminalTheme,
      fontFamily: this.currentFontFamily,
      fontSize: this.currentFontSize,
      fontWeight: this.currentFontThicken ? '500' : 'normal',
      fontWeightBold: this.currentFontThicken ? '800' : 'bold',
      scrollback: TERMINAL_SCROLLBACK,
      // Apps emit 256-color/truecolor codes calibrated for dark backgrounds
      // (Claude Code grays, tmux status bars) that no palette can remap.
      // xterm adjusts each foreground at render time against the actual cell
      // background, preserving hue (same default as VS Code).
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      allowTransparency: true,
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

    // Cmd+C (macOS) / Ctrl+Shift+C (Linux): copy from xterm selection or pending OSC 52 text
    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown' || ev.key !== 'c') return true;

      const isMacCopy = ev.metaKey && !ev.shiftKey && !ev.ctrlKey;
      const isLinuxCopy = ev.ctrlKey && ev.shiftKey && !ev.metaKey;
      if (!isMacCopy && !isLinuxCopy) return true;

      // Priority 1: xterm.js native selection (user gesture → clipboard works)
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection()).catch(
          (err) => console.warn('[FLEEX:Clipboard] failed to copy xterm selection', err),
        );
        return false;
      }

      // Priority 2: pending OSC 52 text that failed auto-write
      const pending = clipboardProvider.consumePendingText();
      if (pending) {
        navigator.clipboard.writeText(pending).catch(
          (err) => console.warn('[FLEEX:Clipboard] failed to copy pending OSC52 text', err),
        );
        return false;
      }

      // No selection, no pending → let event through (Ctrl+C = SIGINT, etc.)
      return true;
    });

    const instance: TerminalInstance = {
      terminal,
      fitAddon,
      serializeAddon,
      clipboardProvider,
      serializedBuffer: null,
      sessionId,
      lastActiveAt: Date.now(),
      webglAddon: null,
      isFloating: false,
    };
    this.terminals.set(sessionId, instance);

    this.loadWebGL(instance);

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
      // The base ANSI palette is dark-calibrated; swap in the light palette
      // on light themes (custom themes covered via isLightTheme luminance).
      ...(isLightTheme(theme) ? TERMINAL_ANSI_LIGHT : null),
      background: theme.terminal.background,
      foreground: theme.terminal.foreground,
      cursor: theme.terminal.cursor,
      cursorAccent: theme.terminal.cursorAccent,
      selectionBackground: theme.terminal.selectionBackground,
    };
    this.currentTerminalTheme = termTheme;
    for (const [, instance] of this.terminals) {
      if (instance.isFloating) {
        // Preserve transparent background for floating terminals; update other props
        instance.terminal.options.theme = {
          ...termTheme,
          background: 'rgba(0, 0, 0, 0)',
        };
      } else {
        instance.terminal.options.theme = termTheme;
      }
    }
  }

  updateFont(fontFamily: string, fontSize: number, fontThicken: boolean): void {
    this.currentFontFamily = fontFamily;
    this.currentFontSize = fontSize;
    this.currentFontThicken = fontThicken;
    const fontWeight = fontThicken ? '500' : 'normal';
    const fontWeightBold = fontThicken ? '800' : 'bold';
    for (const [, instance] of this.terminals) {
      instance.terminal.options.fontFamily = fontFamily;
      instance.terminal.options.fontSize = fontSize;
      instance.terminal.options.fontWeight = fontWeight;
      instance.terminal.options.fontWeightBold = fontWeightBold;
      try { instance.fitAddon.fit(); } catch { /* ignore */ }
    }
  }

  /** Apply an appearance snapshot from terminalAppearance (theme may be unset yet). */
  applyAppearance(appearance: TerminalAppearance): void {
    if (appearance.theme) this.updateTheme(appearance.theme);
    this.updateFont(appearance.fontFamily, appearance.fontSize, appearance.fontThicken);
  }

  /**
   * Toggle floating mode: dispose WebGL and use transparent background,
   * or restore WebGL with opaque background.
   */
  setFloatingMode(sessionId: string, floating: boolean): void {
    const instance = this.terminals.get(sessionId);
    if (!instance || instance.isFloating === floating) return;
    instance.isFloating = floating;

    if (floating) {
      // Dispose WebGL so the canvas renderer respects allowTransparency
      if (instance.webglAddon) {
        try { instance.webglAddon.dispose(); } catch { /* ignore */ }
        instance.webglAddon = null;
      }
      // Set transparent background (rgba format — xterm doesn't parse 8-digit hex)
      instance.terminal.options.theme = {
        ...instance.terminal.options.theme,
        background: 'rgba(0, 0, 0, 0)',
      };
    } else {
      // Restore opaque background
      instance.terminal.options.theme = {
        ...instance.terminal.options.theme,
        background: this.currentTerminalTheme.background,
      };
      // Reload WebGL
      this.loadWebGL(instance);
    }

    // Re-fit after renderer change
    try { instance.fitAddon.fit(); } catch { /* ignore */ }
  }

  private async loadWebGL(instance: TerminalInstance): Promise<void> {
    // Don't load WebGL in floating mode (canvas renderer needed for transparency)
    if (instance.isFloating) return;
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        instance.webglAddon = null;
      });
      instance.terminal.loadAddon(webgl);
      instance.webglAddon = webgl;
    } catch {
      // WebGL not available, fallback to canvas renderer
    }
  }
}

export const terminalManager = new TerminalManager();

// This module is lazy-loaded (see LazyTerminalTabContent / AppLayout), so it may
// arrive long after useTheme()/useTerminalFont() first ran. Replay whatever the
// hooks already recorded, then keep following it.
terminalManager.applyAppearance(getTerminalAppearance());
subscribeTerminalAppearance((appearance) => terminalManager.applyAppearance(appearance));
