import { useUIStore } from '../../stores/uiStore';

import { AuditTrailView } from './AuditTrailView';
import { StatisticsView } from './StatisticsView';

export function AnalyticsPanel() {
  const analyticsTab = useUIStore((s) => s.analyticsTab);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Breadcrumb header */}
      <div
        className="flex items-center gap-2 border-b border-[var(--theme-border)] px-6"
        style={{ height: 'var(--header-height)' }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--theme-text-muted)]"
        >
          <path d="M3 3v18h18" />
          <path d="M7 16l4-8 4 4 4-6" />
        </svg>
        <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Analytics</span>
        <span className="text-[var(--theme-text-faint)]">/</span>
        <span className="text-sm text-[var(--theme-text-secondary)]">
          {analyticsTab === 'audit-trail' ? 'Audit Trail' : 'Statistics'}
        </span>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {analyticsTab === 'audit-trail' && <AuditTrailView />}
        {analyticsTab === 'statistics' && <StatisticsView />}
      </div>
    </div>
  );
}
