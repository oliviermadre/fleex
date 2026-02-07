import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { PinnedIconButton } from './PinnedIcons';

export function CollapsedSidebar() {
  const expandSidebar = useUIStore((s) => s.expandSidebar);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const openSettingsModal = useUIStore((s) => s.openSettingsModal);
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const sessions = useSessionStore((s) => s.sessions);

  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-zinc-800 bg-zinc-900/50 py-2">
      {/* Expand button */}
      <button
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={expandSidebar}
        title="Expand sidebar (Cmd+B)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
          <polyline points="8.5,6 10.5,8 8.5,10" />
        </svg>
      </button>

      <div className="my-1.5 h-px w-6 bg-zinc-800" />

      {/* Pinned icons */}
      {pinnedIcons.map((icon) => (
        <PinnedIconButton key={icon.id} icon={icon} collapsed />
      ))}
      {pinnedIcons.length > 0 && <div className="my-1.5 h-px w-6 bg-zinc-800" />}

      {/* Sessions */}
      <button
        className="group relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={expandSidebar}
        title="Sessions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <polyline points="4.5,7 6,8.5 4.5,10" />
          <line x1="7.5" y1="10.5" x2="11" y2="10.5" />
        </svg>
        {sessions.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#b85a3a] text-[8px] font-bold text-white">
            {sessions.length > 9 ? '9+' : sessions.length}
          </span>
        )}
      </button>

      {/* New session */}
      <button
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={openCreateModal}
        title="New Session (Cmd+N)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="8" y1="3.5" x2="8" y2="12.5" />
          <line x1="3.5" y1="8" x2="12.5" y2="8" />
        </svg>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <button
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={openSettingsModal}
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="2" />
          <path d="M6.5 1h3l.3 1.5c.4.2.8.4 1.1.7l1.5-.5 1.5 2.6-1.2 1c0 .2.05.45.05.7s-.02.5-.05.7l1.2 1-1.5 2.6-1.5-.5c-.3.3-.7.5-1.1.7L9.5 15h-3l-.3-1.5c-.4-.2-.8-.4-1.1-.7l-1.5.5-1.5-2.6 1.2-1c-.03-.2-.05-.45-.05-.7s.02-.5.05-.7l-1.2-1 1.5-2.6 1.5.5c.3-.3.7-.5 1.1-.7L6.5 1z" />
        </svg>
      </button>
    </div>
  );
}
