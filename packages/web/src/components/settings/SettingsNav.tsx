import { useNavigate } from 'react-router-dom';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { cn } from '../../lib/cn';

const COLLAPSE_BTN = 'flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]';

const tabIcons: Record<SettingsTab, React.ReactNode> = {
  general: (
    // Monitor/display icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  appearance: (
    // Palette icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  ),
  repositories: (
    // Git branch icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  ),
  'pinned-icons': (
    // Pin icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  ),
  'worktree-actions': (
    // Wrench icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  'agent-tokens': (
    // Key/link icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  triggers: (
    // Clock icon
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
};

const tabs: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'repositories', label: 'Repositories' },
  { key: 'pinned-icons', label: 'Pinned Icons' },
  { key: 'worktree-actions', label: 'Worktree Actions' },
  { key: 'agent-tokens', label: 'Agent Tokens' },
  { key: 'triggers', label: 'Triggers' },
];

export function SettingsNav() {
  const navigate = useNavigate();
  const settingsTab = useUIStore((s) => s.settingsTab);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);

  return (
    <div className="flex h-full flex-col">
      {/* Header — matches SidebarHeader height */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Settings</span>
        <button
          onClick={toggleContentPanel}
          className={COLLAPSE_BTN}
          title="Collapse panel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <line x1="6" y1="1.5" x2="6" y2="14.5" />
          </svg>
        </button>
      </div>

      {/* Category list */}
      <nav className="flex flex-col py-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'flex items-center gap-3 border-l-2 py-2.5 pl-5 pr-3 text-left text-sm transition-colors',
              settingsTab === tab.key
                ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] font-semibold text-[var(--theme-text-primary)]'
                : 'border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]'
            )}
            onClick={() => navigate(`/settings/${tab.key}`, { replace: true })}
          >
            <span className="shrink-0 text-[var(--theme-text-muted)]">{tabIcons[tab.key]}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
