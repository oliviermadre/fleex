/** The <webview> methods the ticket browser uses (Electron's WebviewTag subset). */
export interface ElectronWebview extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getWebContentsId(): number;
  getZoomFactor(): number;
  send(channel: string, ...args: unknown[]): Promise<void>;
}

export interface FleexDesktopBridge {
  capture(webContentsId: number, rect: { x: number; y: number; width: number; height: number }): Promise<string>;
  onOpenTab(cb: (url: string) => void): () => void;
}

declare global {
  interface Window {
    fleexDesktop?: FleexDesktopBridge;
  }
}

/** True inside the Electron shell — the ticket browser only exists there. */
export function hasDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.fleexDesktop;
}
