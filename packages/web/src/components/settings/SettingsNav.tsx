import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { cn } from '../../lib/cn';

const tabs: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'repositories', label: 'Repositories' },
  { key: 'pinned-icons', label: 'Pinned Icons' },
  { key: 'worktree-actions', label: 'Worktree Actions' },
];

export function SettingsNav() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);

  return (
    <div className="flex h-full flex-col">
      {/* Header — matches SidebarHeader height */}
      <div className="flex items-center border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Settings</span>
      </div>

      {/* Category list */}
      <nav className="flex flex-col py-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'border-l-2 px-4 py-2 text-left text-sm transition-colors',
              settingsTab === tab.key
                ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] font-medium text-[var(--theme-text-primary)]'
                : 'border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]'
            )}
            onClick={() => setSettingsTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
