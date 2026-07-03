import type { ClaudeUsage, ClaudeUsageMetric } from '@fleex/shared';
import { useTooltip, FloatingPortal } from '../../hooks/usePopover';
import {
  MS_IN_MINUTE,
  MINUTES_IN_HOUR,
  HOURS_IN_DAY,
  USAGE_WARN_THRESHOLD_PCT,
  USAGE_DANGER_THRESHOLD_PCT,
} from '@fleex/shared';

function parseTimeLeft(resetsAt: string): string {
  // resetsAt is an ISO 8601 timestamp from the OAuth usage endpoint.
  if (!resetsAt) return '—';
  const target = new Date(resetsAt);
  if (Number.isNaN(target.getTime())) return '—';

  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'any moment';

  return formatDuration(diffMs);
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / MS_IN_MINUTE);
  const totalHours = Math.floor(totalMinutes / MINUTES_IN_HOUR);
  const totalDays = Math.floor(totalHours / HOURS_IN_DAY);

  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < MINUTES_IN_HOUR) return `${totalMinutes}m`;
  if (totalHours < HOURS_IN_DAY) {
    const remainingMin = totalMinutes % MINUTES_IN_HOUR;
    return remainingMin > 0 ? `${totalHours}h ${remainingMin}m` : `${totalHours}h`;
  }
  const remainingHours = totalHours % HOURS_IN_DAY;
  return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
}

function getFillColor(remaining: number): string {
  if (remaining > USAGE_WARN_THRESHOLD_PCT) return 'var(--theme-success, #22c55e)';
  if (remaining >= USAGE_DANGER_THRESHOLD_PCT) return 'var(--theme-warning, #eab308)';
  return 'var(--theme-danger, #ef4444)';
}

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
}

function Tooltip({ children, content }: TooltipProps) {
  const { open, refs, floatingStyles, getReferenceProps, getFloatingProps } = useTooltip({ placement: 'bottom' });

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </div>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="pointer-events-none z-[9999] min-w-[180px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 shadow-lg"
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

interface GaugeProps {
  metric: ClaudeUsageMetric;
  label: string;
}

function Gauge({ metric, label }: GaugeProps) {
  const remaining = 100 - metric.percentage;
  const fillHeight = remaining / 100;
  const fillColor = getFillColor(remaining);

  return (
    <div className="flex cursor-pointer items-center gap-0.5">
      <span
        className="font-medium leading-none text-[var(--theme-text-muted)]"
        style={{ fontSize: '8px' }}
      >
        {label}
      </span>
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
        <rect
          x="1" y="2" width="8" height="12" rx="1"
          stroke="var(--theme-border-input, #3f3f46)" strokeWidth="0.8" fill="none"
        />
        <line x1="0" y1="2" x2="10" y2="2" stroke="var(--theme-border-input, #3f3f46)" strokeWidth="0.8" />
        <rect
          x="1.4" y={2.4 + 11.2 * (1 - fillHeight)} width="7.2" height={11.2 * fillHeight}
          rx="0.5" fill={fillColor} opacity="0.8"
        />
      </svg>
      <span
        className="leading-none text-[var(--theme-text-secondary)]"
        style={{ fontSize: '9px' }}
      >
        {remaining}%
      </span>
    </div>
  );
}

function UsageTooltipRow({ metric, label }: { metric: ClaudeUsageMetric; label: string }) {
  const remaining = 100 - metric.percentage;
  const fillColor = getFillColor(remaining);
  const timeLeft = parseTimeLeft(metric.resetsAt);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-semibold text-[var(--theme-text-primary)]">{label}</span>
        <span className="text-[10px] font-medium text-[var(--theme-text-secondary)]">
          {remaining}% left
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--theme-bg-overlay)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${remaining}%`, backgroundColor: fillColor }}
        />
      </div>
      <div className="text-[10px] text-[var(--theme-text-muted)]">
        Resets in {timeLeft}
      </div>
    </div>
  );
}

interface UsageGaugesProps {
  usage: ClaudeUsage | null;
  loading: boolean;
}

export function UsageGauges({ usage, loading }: UsageGaugesProps) {
  if (loading || !usage) return null;

  const gauges: Array<{ metric: ClaudeUsageMetric; label: string }> = [];

  if (usage.session) {
    gauges.push({ metric: usage.session, label: '5h' });
  }
  if (usage.weeklyAllModels) {
    gauges.push({ metric: usage.weeklyAllModels, label: '7d' });
  }

  if (gauges.length === 0) return null;

  const tooltipRows: Array<{ metric: ClaudeUsageMetric; label: string }> = [];
  if (usage.session) tooltipRows.push({ metric: usage.session, label: 'Current session (5h)' });
  if (usage.weeklyAllModels) tooltipRows.push({ metric: usage.weeklyAllModels, label: 'Weekly — all models' });
  if (usage.weeklySonnet) tooltipRows.push({ metric: usage.weeklySonnet, label: 'Weekly — Sonnet' });

  const tooltipContent = (
    <div className="space-y-2.5">
      {tooltipRows.map((r) => (
        <UsageTooltipRow key={r.label} metric={r.metric} label={r.label} />
      ))}
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
      <div className="flex items-center gap-2">
        {gauges.map((g) => (
          <Gauge key={g.label} metric={g.metric} label={g.label} />
        ))}
      </div>
    </Tooltip>
  );
}
