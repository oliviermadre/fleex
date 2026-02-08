import { useSessionStore } from '../../stores/sessionStore';

export function SidebarHeader() {
  const sessions = useSessionStore((s) => s.sessions);

  return (
    <div className="flex items-center border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Sessions</span>
        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-secondary)]">
          {sessions.length}
        </span>
      </div>
    </div>
  );
}
