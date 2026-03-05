import type { IClipboardProvider, ClipboardSelectionType } from '@xterm/addon-clipboard';

const LOG_PREFIX = '[FLEEX:Clipboard]';

export class AsmClipboardProvider implements IClipboardProvider {
  private pendingText: string | null = null;

  async writeText(selection: ClipboardSelectionType, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      console.debug(LOG_PREFIX, 'writeText OK', {
        selection,
        len: text.length,
      });
      this.pendingText = null;
    } catch (err) {
      console.warn(LOG_PREFIX, 'writeText FAILED, buffering for Cmd+C fallback', {
        selection,
        len: text.length,
        isSecureContext: window.isSecureContext,
        hasFocus: document.hasFocus(),
        error: err instanceof Error ? err.message : String(err),
      });
      this.pendingText = text;
    }
  }

  async readText(selection: ClipboardSelectionType): Promise<string> {
    try {
      const text = await navigator.clipboard.readText();
      console.debug(LOG_PREFIX, 'readText OK', { selection, len: text.length });
      return text;
    } catch (err) {
      console.warn(LOG_PREFIX, 'readText FAILED', {
        selection,
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  consumePendingText(): string | null {
    const text = this.pendingText;
    this.pendingText = null;
    return text;
  }
}
