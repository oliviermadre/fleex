/**
 * One ticket-browser tab: a <webview> plus its events. `src` is only the URL the
 * tab was mounted with — later navigation goes through the element's own methods,
 * because changing the attribute would reload the page.
 */
import { useEffect, useRef, useState } from 'react';
import type { BrowserTab } from '../../../../stores/browserStore';
import type { ElectronWebview } from './webview';

interface Props {
  tab: BrowserTab;
  active: boolean;
  /** The webview exists (it may not be attached yet — see BrowserPanel.navigate). */
  onReady: (tabId: string, wv: ElectronWebview) => void;
  onUpdate: (patch: Partial<Omit<BrowserTab, 'id'>>) => void;
  /** Raw IPC payload, untrusted: the guest page can post anything. */
  onPicked: (wv: ElectronWebview, payload: unknown) => void;
  onPickCancelled: () => void;
  /** A main-frame document navigation started (a pick in progress is gone with the old page). */
  onNavigateStart: () => void;
}

export function BrowserTabView({ tab, active, ...handlers }: Props) {
  const ref = useRef<ElectronWebview>(null);
  const [initialUrl] = useState(tab.url);
  const [error, setError] = useState<string | null>(null);
  // Without `webviewTag` (the main process predates it) <webview> is an inert unknown element.
  const [unsupported, setUnsupported] = useState(false);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    if (typeof wv.getWebContentsId !== 'function') {
      setUnsupported(true);
      return;
    }
    const h = () => latest.current;
    h().onReady(tab.id, wv);
    const on: Record<string, (e: Event) => void> = {
      'did-start-navigation': (e) => {
        const ev = e as unknown as { isMainFrame: boolean; isInPlace: boolean };
        if (ev.isMainFrame && !ev.isInPlace) h().onNavigateStart();
      },
      'did-start-loading': () => setError(null),
      'did-navigate': (e) => h().onUpdate({ url: (e as unknown as { url: string }).url }),
      'did-navigate-in-page': (e) => {
        const ev = e as unknown as { url: string; isMainFrame: boolean };
        if (ev.isMainFrame) h().onUpdate({ url: ev.url });
      },
      'page-title-updated': (e) => h().onUpdate({ title: (e as unknown as { title: string }).title }),
      'page-favicon-updated': (e) => h().onUpdate({ favicon: (e as unknown as { favicons: string[] }).favicons[0] }),
      'did-fail-load': (e) => {
        const ev = e as unknown as { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };
        // -3 = ERR_ABORTED: a navigation replaced by another, not a failure.
        if (ev.isMainFrame && ev.errorCode !== -3) setError(`${ev.errorDescription} — ${ev.validatedURL}`);
      },
      'ipc-message': (e) => {
        const ev = e as unknown as { channel: string; args: unknown[] };
        if (ev.channel === 'picker:picked') h().onPicked(wv, ev.args[0]);
        else if (ev.channel === 'picker:cancelled') h().onPickCancelled();
      },
    };
    for (const [name, fn] of Object.entries(on)) wv.addEventListener(name, fn);
    return () => {
      for (const [name, fn] of Object.entries(on)) wv.removeEventListener(name, fn);
    };
  }, [tab.id]);

  return (
    // Inactive tabs stay mounted but hidden; never display:none (it breaks webviews).
    <div className={active ? 'absolute inset-0 z-10' : 'invisible pointer-events-none absolute inset-0'}>
      <webview
        ref={ref as React.Ref<HTMLWebViewElement>}
        src={initialUrl} partition="persist:fleex-browser"
        // Lets window.open / target=_blank reach main.js, which turns them into Fleex tabs.
        // A string: React drops a boolean `true` on this non-standard attribute.
        {...({ allowpopups: 'true' } as Record<string, string>)}
        className="h-full w-full"
      />
      {unsupported && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--theme-bg-base)] p-6 text-center text-sm text-[var(--theme-text-secondary)]">
          <p>Restart the Fleex desktop app to enable the browser.</p>
        </div>
      )}
      {error && !unsupported && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--theme-bg-base)] p-6 text-center text-sm text-[var(--theme-text-secondary)]">
          <p>Couldn't load the page.</p>
          <p className="font-mono text-xs text-[var(--theme-text-muted)]">{error}</p>
          <button
            type="button"
            onClick={() => ref.current?.reload()}
            className="rounded-md border border-[var(--theme-border)] px-3 py-1 hover:bg-[var(--theme-bg-hover)]"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
