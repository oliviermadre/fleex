/**
 * The desktop ticket browser (right panel): per-ticket tabs, address bar and the
 * element picker. A pick is screenshotted, uploaded, and lands as a chip in the
 * work composer (browserStore.pendingElements).
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../../lib/cn';
import { useBrowserStore, type BrowserTab, type TicketBrowser } from '../../../../stores/browserStore';
import { useWorkStore } from '../../../../stores/workStore';
import type { ElementContext } from '../../../shared/elementContext';
import { BrowserTabView } from './BrowserTabView';
import { NewTabPage } from './NewTabPage';
import { captureElement } from './capture';
import { normalizeUrl } from './url';
import type { ElectronWebview } from './webview';

const EMPTY: TicketBrowser = { tabs: [], activeId: null };

function IconButton({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
        active ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {children}
    </button>
  );
}

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function BrowserPanel({ ticketId }: { ticketId: string }) {
  const state = useBrowserStore((s) => s.byTicket[ticketId]) ?? EMPTY;
  const { openTab, closeTab, setActive, updateTab, addElement, setExpanded, requestComposerFocus } = useBrowserStore.getState();
  const expanded = useBrowserStore((s) => s.expanded);
  const setRightPanel = useWorkStore((s) => s.setRightPanel);
  const views = useRef(new Map<string, ElectronWebview>());
  const [picking, setPicking] = useState(false);
  const active = state.tabs.find((t) => t.id === state.activeId) ?? null;
  const [address, setAddress] = useState(active?.url ?? '');
  const addressFocused = useRef(false);

  // Always at least one tab.
  useEffect(() => {
    if (state.tabs.length === 0) openTab(ticketId, '');
  }, [state.tabs.length, ticketId, openTab]);

  // Pop-ups from any page open as a new tab of this ticket.
  useEffect(() => window.fleexDesktop?.onOpenTab((url) => openTab(ticketId, url)), [ticketId, openTab]);

  useEffect(() => {
    if (!addressFocused.current) setAddress(active?.url ?? '');
  }, [active?.url, active?.id]);

  const activeView = () => (state.activeId ? views.current.get(state.activeId) : undefined);

  const pickingRef = useRef(false);
  pickingRef.current = picking;

  // Switching tabs (or closing the panel) cancels a pick in progress in the tab we leave.
  useEffect(() => {
    const leaving = state.activeId;
    return () => {
      if (pickingRef.current && leaving) void views.current.get(leaving)?.send('picker:stop');
      setPicking(false);
    };
  }, [state.activeId]);

  const navigate = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url || !active) return;
    const wv = views.current.get(active.id);
    if (active.url && wv) void wv.loadURL(url);
    else updateTab(ticketId, active.id, { url }); // new-tab page → mounts a webview on this URL
  };

  const togglePicker = () => {
    const wv = activeView();
    if (!wv) return;
    if (picking) { void wv.send('picker:stop'); setPicking(false); return; }
    setPicking(true);
    void wv.send('picker:start');
  };

  const onPicked = async (wv: ElectronWebview, context: ElementContext) => {
    setPicking(false);
    const id = Math.random().toString(36).slice(2, 10);
    let screenshotUrl: string | undefined;
    try {
      screenshotUrl = await captureElement(wv, context);
    } catch {
      screenshotUrl = undefined;
    }
    addElement(ticketId, { id, context, screenshotUrl, captureFailed: !screenshotUrl });
    requestComposerFocus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tabs */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--theme-border)] px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {state.tabs.map((t: BrowserTab) => (
            <div
              key={t.id}
              className={cn(
                'group flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs',
                t.id === state.activeId ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
              )}
            >
              <button type="button" onClick={() => setActive(ticketId, t.id)} className="flex min-w-0 items-center gap-1.5">
                {t.favicon && <img src={t.favicon} alt="" className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{t.title || (t.url ? t.url.replace(/^https?:\/\//, '') : 'New tab')}</span>
              </button>
              <button type="button" title="Close tab" onClick={() => { views.current.delete(t.id); closeTab(ticketId, t.id); }} className="opacity-0 group-hover:opacity-100 hover:text-[var(--theme-text-primary)]">×</button>
            </div>
          ))}
          <IconButton title="New tab" onClick={() => openTab(ticketId, '')}>
            <svg {...svg}><path d="M12 5v14M5 12h14" /></svg>
          </IconButton>
        </div>
        <IconButton title={expanded ? 'Shrink' : 'Expand'} onClick={() => setExpanded(!expanded)}>
          <svg {...svg}>{expanded ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}</svg>
        </IconButton>
        <IconButton title="Close browser" onClick={() => { setExpanded(false); setRightPanel(null); }}>
          <svg {...svg}><path d="M18 6 6 18M6 6l12 12" /></svg>
        </IconButton>
      </div>

      {/* Navigation */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--theme-border)] px-2">
        <IconButton title="Back" onClick={() => activeView()?.goBack()}><svg {...svg}><path d="M19 12H5M12 19l-7-7 7-7" /></svg></IconButton>
        <IconButton title="Forward" onClick={() => activeView()?.goForward()}><svg {...svg}><path d="M5 12h14M12 5l7 7-7 7" /></svg></IconButton>
        <IconButton title="Reload" onClick={() => activeView()?.reload()}><svg {...svg}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg></IconButton>
        <form className="min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); navigate(address); }}>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => { addressFocused.current = true; e.target.select(); }}
            onBlur={() => { addressFocused.current = false; }}
            placeholder="Type a URL"
            className="h-7 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-2 text-xs text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
        </form>
        <IconButton title={picking ? 'Cancel selection (Esc)' : 'Select an element'} onClick={togglePicker} active={picking}>
          <svg {...svg}><path d="M3 3l7 17 2.5-7.5L20 10z" /></svg>
        </IconButton>
      </div>

      {/* Pages */}
      <div className="relative min-h-0 flex-1 bg-[var(--theme-bg-base)]">
        {state.tabs.map((t) =>
          t.url ? (
            <BrowserTabView
              key={t.id}
              tab={t}
              active={t.id === state.activeId}
              onReady={(tabId, wv) => views.current.set(tabId, wv)}
              onUpdate={(patch) => updateTab(ticketId, t.id, patch)}
              onPicked={(wv, ctx) => void onPicked(wv, ctx)}
              onPickCancelled={() => setPicking(false)}
            />
          ) : (
            t.id === state.activeId && <NewTabPage key={t.id} ticketId={ticketId} onOpen={(url) => updateTab(ticketId, t.id, { url })} />
          ),
        )}
      </div>
    </div>
  );
}
