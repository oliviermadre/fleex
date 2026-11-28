import { useEffect, useMemo, useState } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';
import { MobilePageHeader } from '../../mobile/MobilePageHeader';
import { TasksIcon } from '../../components/sidebar/icons';
import { useFactoryStore } from '../factoryStore';
import { watchFactory } from '../factoryLive';
import { needsOf } from '../needs';
import type { DeskSpec } from '../types';
import { MobileFactoryMap } from './MobileFactoryMap';
import { MobileFactoryFromFleex, MobileFactoryNewTicket, MobileFactoryPlus, type PlusStep } from './MobileFactoryPlus';
import { MobileFactoryTickets } from './MobileFactoryTickets';
import { useMobileFactoryStore, type FactoryTab } from './mobileFactoryStore';

/** Without the WS, how often the floor is read again while the phone shows it. */
const POLL_MS = 1500, POLL_HIDDEN_MS = 6000;

/** Whether the Factory is on for this workspace, asked once when the mobile shell starts; and whether the phone shows it. */
export function useMobileFactory(): { enabled: boolean; open: boolean } {
  const enabled = useFactoryStore((s) => s.enabled), loadStatus = useFactoryStore((s) => s.loadStatus);
  const open = useMobileFactoryStore((s) => s.open);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  return { enabled, open: enabled && open };
}

/** How many tickets of the floor wait for someone: the badge of the Factory's entry, and of its Tickets tab. */
export function useFactoryNeedCount(): number {
  const snapshot = useFactoryStore((s) => s.snapshot), pending = useMobileFactoryStore((s) => s.pending);
  return useMemo(() => (snapshot ? needsOf(snapshot.tickets.filter((t) => !t.item && !pending[t.ticketId]), snapshot.floor.layout.machines, snapshot.serverTime).length : 0), [snapshot, pending]);
}

function MapIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="7" height="6" rx="1.5" /><rect x="14" y="13" width="7" height="6" rx="1.5" /><path d="M10 8h4a3 3 0 0 1 3 3v2" />
    </svg>
  );
}
/** The Factory's mark in the shell: two machines and the belt between them. */
export const FactoryIcon = MapIcon;

/**
 * The Factory on the phone: a mode of its own, in place of Fleex's tabs and bar (picked on `docs/factory/mobile.html`).
 * Two screens, Tickets and Map, behind a bar of its own whose middle button brings a ticket onto the floor; the back
 * arrow of its header goes back to Fleex. A ticket opens in the shell's own full-screen detail, over this. The phone
 * follows the floor, settles what waits for someone and moves tickets; nothing is built from here.
 */
export function MobileFactory() {
  const tab = useMobileFactoryStore((s) => s.tab), setTab = useMobileFactoryStore((s) => s.setTab), setOpen = useMobileFactoryStore((s) => s.setOpen);
  const ticketOpen = useTicketStore((s) => s.selectedTicketId !== null);
  const halted = useFactoryStore((s) => s.snapshot?.floor.settings.halted === true), running = useFactoryStore((s) => s.snapshot?.running ?? 0);
  const count = useFactoryNeedCount();
  const [plus, setPlus] = useState<'menu' | PlusStep | null>(null);

  // Keep the floor live while the phone shows it (factoryLive.ts): pushed over the WS, polled when it is down.
  useEffect(() => watchFactory(() => (document.hidden ? POLL_HIDDEN_MS : POLL_MS)), []);
  // A gesture still in its undo window is sent when the page goes away: iOS may never bring it back.
  useEffect(() => {
    const flush = () => useMobileFactoryStore.getState().flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const item = (id: FactoryTab, label: string, icon: React.ReactNode, badge?: number) => (
    <button type="button" onClick={() => setTab(id)} aria-label={label} aria-current={tab === id ? 'page' : undefined}
      className={cn('relative flex h-14 w-16 flex-col items-center justify-center gap-0.5', tab === id ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]')}>
      <span className="relative">
        {icon}
        {!!badge && <span className="absolute -right-[11px] -top-[5px] flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-warning)] px-1 text-[9.5px] font-bold text-[var(--theme-bg-base)]">{badge}</span>}
      </span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--theme-bg-base)]" style={{ paddingTop: 'env(safe-area-inset-top)' }} aria-label="Factory">
      <MobilePageHeader title="Factory" onBack={() => setOpen(false)} count={count || undefined}
        trailing={<span className="truncate font-mono text-[11px] text-[var(--theme-text-muted)]">{running} running</span>}
        sub={halted ? <p className={cn('rounded-lg px-3 py-1.5 text-[12.5px] font-medium', tint('red'))} role="alert">The floor is stopped: nothing moves, nothing runs. Restart it from the desktop.</p> : undefined} />
      {tab === 'tickets' ? <MobileFactoryTickets /> : <MobileFactoryMap onNewTicket={(desk: DeskSpec) => setPlus({ new: desk })} />}

      {/* The Factory's own floating bar: Tickets · + · Map */}
      {!ticketOpen && (
        <nav className="fixed inset-x-3.5 z-30 flex h-16 items-center justify-around rounded-[32px] border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-[24px] backdrop-saturate-[1.4]"
          style={{ bottom: 'max(26px, env(safe-area-inset-bottom))', background: 'color-mix(in srgb, var(--theme-bg-surface) 78%, transparent)' }} aria-label="Factory">
          {item('tickets', 'Tickets', <TasksIcon size={22} />, count)}
          <button type="button" onClick={() => setPlus('menu')} aria-label="Add a ticket to the floor"
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--theme-accent)] text-[28px] font-light leading-none text-[var(--theme-accent-fg)]">+</button>
          {item('map', 'Map', <MapIcon />)}
        </nav>
      )}

      {plus === 'menu' && <MobileFactoryPlus onClose={() => setPlus(null)} onPick={setPlus} />}
      {plus === 'fleex' && <MobileFactoryFromFleex onClose={() => setPlus(null)} />}
      {plus !== null && plus !== 'menu' && plus !== 'fleex' && <MobileFactoryNewTicket desk={plus.new} onClose={() => setPlus(null)} />}
    </div>
  );
}

/** The Factory's tile among the phone's "Plus" pages: the way into the mode, with what waits there. Nothing while the Factory is off. */
export function MobileFactoryTile({ onOpen }: { onOpen: () => void }) {
  const enabled = useFactoryStore((s) => s.enabled), count = useFactoryNeedCount();
  // The tile counts what waits on the floor: read once when the sheet shows it, without watching the floor from Fleex's own screens.
  useEffect(() => { if (enabled) void useFactoryStore.getState().refresh(); }, [enabled]);
  if (!enabled) return null;
  return (
    <button type="button" onClick={() => { useMobileFactoryStore.getState().setOpen(true); onOpen(); }}
      className="relative flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] active:bg-[var(--theme-bg-overlay)]">
      <FactoryIcon />
      <span className="text-[12.5px] text-[var(--theme-text-primary)]">Factory</span>
      {!!count && <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-warning)] px-1 text-[9.5px] font-bold text-[var(--theme-bg-base)]">{count}</span>}
    </button>
  );
}
