import { useEffect } from 'react';
import { useNotificationStore } from '../stores/notificationStore';
import { useRoutineStore } from '../stores/routineStore';
import { RepositoriesIcon } from '../components/sidebar/icons';
import { RoutineIcon } from '../lib/primitives';
import { cn } from '../lib/cn';
import { MobileSheet } from './MobileSheet';
import { MobilePageHeader } from './MobilePageHeader';
import { setMobileOverride } from './useMobileMode';
import { useMobileNavStore, type MobileMorePage } from './mobileNavStore';
import {
  MobileDocumentsPage,
  MobileNotesPage,
  MobileNotificationsPage,
  MobileReposPage,
  MobileRoutinesPage,
  MobileSettingsPage,
} from './MobileMorePages';

export function BellIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function MoreDotsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function NotesIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} aria-hidden>
      <rect x="3" y="5" width="14" height="12" rx="1.5" />
      <path d="M6 2h8M7 9h6M7 12h4" />
    </svg>
  );
}
function DocumentsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...stroke} aria-hidden>
      <path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z" />
      <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" strokeWidth="1" />
    </svg>
  );
}
function SettingsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

const PAGE_TITLES: Record<MobileMorePage, string> = {
  pulse: 'Notifications',
  routines: 'Routines',
  notes: 'Notes',
  documents: 'Documents',
  repos: 'Repositories',
  settings: 'Settings',
};

/** "Plus" bottom sheet: 3-column grid of tiles + connection row. */
export function MobileMoreSheet() {
  const setOpen = useMobileNavStore((s) => s.setMoreSheetOpen);
  const openMorePage = useMobileNavStore((s) => s.openMorePage);
  const unseen = useNotificationStore((s) => s.unseenCount);
  const routinesAwaiting = useRoutineStore((s) => s.routines.filter((r) => r.awaitingAttention).length);

  useEffect(() => {
    void useRoutineStore.getState().load();
  }, []);

  const tiles: { id: MobileMorePage; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'pulse', label: 'Notifications', icon: <BellIcon size={22} />, badge: unseen },
    { id: 'routines', label: 'Routines', icon: <RoutineIcon size={22} tinted={false} />, badge: routinesAwaiting },
    { id: 'notes', label: 'Notes', icon: <NotesIcon /> },
    { id: 'documents', label: 'Documents', icon: <DocumentsIcon /> },
    { id: 'repos', label: 'Repositories', icon: <RepositoriesIcon size={22} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
  ];

  return (
    <MobileSheet grabber onClose={() => setOpen(false)}>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => openMorePage(t.id)}
            className="relative flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] active:bg-[var(--theme-bg-overlay)]"
          >
            {t.icon}
            <span className="text-[12.5px] text-[var(--theme-text-primary)]">{t.label}</span>
            {!!t.badge && (
              <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-accent-active)] px-1 text-[9.5px] font-bold text-[var(--theme-accent-fg)]">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-success)]" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--theme-text-muted)]">
          {window.location.host}
        </span>
        <button
          type="button"
          onClick={() => setMobileOverride('desktop')}
          className="min-h-11 shrink-0 px-3 text-sm font-medium text-[var(--theme-accent)]"
        >
          Desktop
        </button>
      </div>
    </MobileSheet>
  );
}

/** A "Plus" sub-page, pushed over the current tab (the floating bar stays visible). */
export function MobileMorePageHost() {
  const page = useMobileNavStore((s) => s.morePage);
  const open = useMobileNavStore((s) => s.openMorePage);
  if (!page) return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--theme-bg-base)]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <MobilePageHeader title={PAGE_TITLES[page]} onBack={() => open(null)} />
      <div className={cn('min-h-0 flex-1 overflow-y-auto')} style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}>
        {page === 'pulse' && <MobileNotificationsPage />}
        {page === 'routines' && <MobileRoutinesPage />}
        {page === 'notes' && <MobileNotesPage />}
        {page === 'documents' && <MobileDocumentsPage />}
        {page === 'repos' && <MobileReposPage />}
        {page === 'settings' && <MobileSettingsPage />}
      </div>
    </div>
  );
}

