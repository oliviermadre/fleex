import { useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTickets } from '../hooks/useTickets';
import { useAgentPersonas } from '../hooks/useAgentPersonas';
import { useFocusFeed } from '../hooks/useFocusFeed';
import { useNotifications } from '../hooks/useNotifications';
import { useSessions } from '../hooks/useSessions';
import { useRoutineLiveUpdates } from '../hooks/useRoutineLiveUpdates';
import { useTicketStore } from '../stores/ticketStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFocusCount } from '../stores/focusStore';
import { FocusIcon, TasksIcon } from '../components/sidebar/icons';
import { cn } from '../lib/cn';
import { MobileBoard } from './MobileBoard';
import { MobileFocus } from './MobileFocus';
import { MobileTasks } from './MobileTasks';
import { MobileTicketDetail } from './MobileTicketDetail';
import { MobileAssistant } from './MobileAssistant';
import { MobileMoreSheet, MobileMorePageHost, MoreDotsIcon } from './MobileMore';
import { useMobileNavStore, type MobileView } from './mobileNavStore';

const KanbanIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <rect x="3" y="3" width="5.5" height="18" rx="1" />
    <rect x="9.25" y="3" width="5.5" height="12" rx="1" />
    <rect x="15.5" y="3" width="5.5" height="8" rx="1" />
  </svg>
);
const AssistantIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
  </svg>
);

/**
 * Mobile shell — the phone is a remote control: Focus (home), Tasks, Kanban,
 * the assistant as a sheet and a "Plus" sheet for everything else, behind a
 * floating glass bar. Terminals, the DAG and the Monaco editor stay desktop-only.
 * Tabs stay mounted (`hidden`, never unmounted) so streams and scroll positions
 * survive a tab switch.
 */
export function MobileApp() {
  useWebSocket();
  useTickets();
  useAgentPersonas();
  useFocusFeed();
  useNotifications();
  useSessions();
  useRoutineLiveUpdates();

  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const ticket = useTicketStore((s) =>
    s.selectedTicketId ? s.tickets.find((t) => t.id === s.selectedTicketId) ?? null : null,
  );
  const view = useMobileNavStore((s) => s.view);
  const setView = useMobileNavStore((s) => s.setView);
  const assistantOpen = useMobileNavStore((s) => s.assistantOpen);
  const setAssistantOpen = useMobileNavStore((s) => s.setAssistantOpen);
  const moreSheetOpen = useMobileNavStore((s) => s.moreSheetOpen);
  const setMoreSheetOpen = useMobileNavStore((s) => s.setMoreSheetOpen);
  const morePage = useMobileNavStore((s) => s.morePage);
  const focusCount = useFocusCount();

  const tab = (id: MobileView) => (view === id ? 'flex min-h-0 flex-1 flex-col' : 'hidden');

  return (
    <div
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)]"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className={tab('focus')}>
        <MobileFocus />
      </div>
      <div className={tab('tasks')}>
        <MobileTasks />
      </div>
      <div className={tab('board')}>
        <MobileBoard />
      </div>
      <MobileMorePageHost />

      {/* Ticket detail: full screen, above the bar (which is hidden there) */}
      {ticket && (
        <div
          className="fixed inset-0 z-40 flex flex-col bg-[var(--theme-bg-base)]"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <MobileTicketDetail ticket={ticket} />
        </div>
      )}

      {/* Floating glass bar: Focus · Tasks · ✦ · Kanban · Plus */}
      {!ticket && (
        <nav
          className="fixed inset-x-3.5 z-30 flex h-16 items-center justify-around rounded-[32px] border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-[24px] backdrop-saturate-[1.4]"
          style={{
            bottom: 'max(26px, env(safe-area-inset-bottom))',
            background: 'color-mix(in srgb, var(--theme-bg-surface) 78%, transparent)',
          }}
        >
          <BarItem
            label="Focus"
            active={view === 'focus' && !morePage}
            onClick={() => setView('focus')}
            badge={focusCount}
            icon={<FocusIcon size={22} />}
          />
          <BarItem
            label="Tasks"
            active={view === 'tasks' && !morePage}
            onClick={() => setView('tasks')}
            icon={<TasksIcon size={22} />}
          />
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            aria-label="Assistant"
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]"
          >
            <AssistantIcon />
          </button>
          <BarItem
            label="Kanban"
            active={view === 'board' && !morePage}
            onClick={() => setView('board')}
            icon={<KanbanIcon />}
          />
          <BarItem
            label="Plus"
            active={!!morePage || moreSheetOpen}
            onClick={() => setMoreSheetOpen(!moreSheetOpen)}
            icon={<MoreDotsIcon />}
          />
        </nav>
      )}

      {moreSheetOpen && <MobileMoreSheet />}

      {/* Assistant sheet: mounted once, hidden (not unmounted) when closed so the
          conversation survives. */}
      <div className={cn('fixed inset-0 z-50 bg-black/50', !assistantOpen && 'hidden')} onClick={() => setAssistantOpen(false)}>
        <div
          className="absolute inset-x-0 bottom-0 top-[60px] flex flex-col overflow-hidden rounded-t-[20px] bg-[var(--theme-bg-base)] shadow-[0_-20px_60px_rgba(0,0,0,.5)]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setAssistantOpen(false)}
            aria-label="Fermer l’assistant"
            className="mx-auto flex h-6 w-16 shrink-0 items-center justify-center"
          >
            <span className="h-[5px] w-9 rounded-full bg-[var(--theme-border-input)]" />
          </button>
          <MobileAssistant ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

function BarItem({
  label,
  active,
  onClick,
  icon,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-14 w-14 flex-col items-center justify-center gap-0.5',
        active ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]',
      )}
    >
      <span className="relative">
        {icon}
        {!!badge && (
          <span className="absolute -right-[9px] -top-[5px] flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-accent-active)] px-1 text-[9.5px] font-bold text-[var(--theme-accent-fg)]">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
