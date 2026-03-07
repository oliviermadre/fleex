import { useNavigate } from 'react-router-dom';
import { useUIStore, type AnalyticsTab } from '../../stores/uiStore';
import { cn } from '../../lib/cn';

const COLLAPSE_BTN = 'flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]';

const tabIcons: Record<AnalyticsTab, React.ReactNode> = {
  'audit-trail': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  statistics: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
    </svg>
  ),
};

const tabs: { key: AnalyticsTab; label: string }[] = [
  { key: 'audit-trail', label: 'Audit Trail' },
  { key: 'statistics', label: 'Statistics' },
];

export function AnalyticsNav() {
  const navigate = useNavigate();
  const analyticsTab = useUIStore((s) => s.analyticsTab);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Analytics</span>
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

      <nav className="flex flex-col py-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'flex items-center gap-3 border-l-2 py-2.5 pl-5 pr-3 text-left text-sm transition-colors',
              analyticsTab === tab.key
                ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)] font-semibold text-[var(--theme-text-primary)]'
                : 'border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]'
            )}
            onClick={() => navigate(`/analytics/${tab.key}`, { replace: true })}
          >
            <span className="shrink-0 text-[var(--theme-text-muted)]">{tabIcons[tab.key]}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
