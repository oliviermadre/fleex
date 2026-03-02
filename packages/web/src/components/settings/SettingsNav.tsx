import { useNavigate } from 'react-router-dom';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { cn } from '../../lib/cn';

const COLLAPSE_BTN = 'flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]';

const tabs: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'repositories', label: 'Repositories' },
  { key: 'pinned-icons', label: 'Pinned Icons' },
  { key: 'worktree-actions', label: 'Worktree Actions' },
  { key: 'agent-tokens', label: 'Agent Tokens' },
  { key: 'gateways', label: 'Gateways' },
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
              'border-l-2 py-2.5 pl-6 pr-3 text-left text-sm transition-colors',
              settingsTab === tab.key
                ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] font-semibold text-[var(--theme-text-primary)]'
                : 'border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]'
            )}
            onClick={() => navigate(`/settings/${tab.key}`, { replace: true })}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
