import type { IClipboardProvider, ClipboardSelectionType } from '@xterm/addon-clipboard';
import { createLogger } from '../lib/logger';

const log = createLogger('services/clipboard');

export class AsmClipboardProvider implements IClipboardProvider {
  private pendingText: string | null = null;

  async writeText(selection: ClipboardSelectionType, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.pendingText = null;
    } catch (err) {
      log.warn('writeText FAILED, buffering for Cmd+C fallback', {
        selection,
        len: text.length,
        isSecureContext: window.isSecureContext,
        hasFocus: document.hasFocus(),
        err,
      });
      this.pendingText = text;
    }
  }

  async readText(selection: ClipboardSelectionType): Promise<string> {
    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (err) {
      log.warn('readText FAILED', { selection, err });
      return '';
    }
  }

  consumePendingText(): string | null {
    const text = this.pendingText;
    this.pendingText = null;
    return text;
  }
}
