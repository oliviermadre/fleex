import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ClaudeUsage, ClaudeUsageMetric } from '@asm/shared';

function parseTimeLeft(resetStr: string): string {
  // Formats: "Resets 12:59pm (Europe/Paris)", "Resets Feb 18 at 9am (Europe/Paris)"
  const tzMatch = resetStr.match(/\(([^)]+)\)/);
  const tz = tzMatch?.[1] ?? 'UTC';

  const now = new Date();

  // Try "Resets <time> (<tz>)" — same-day reset like "Resets 1pm" or "Resets 12:59pm"
  const sameDayMatch = resetStr.match(/Resets?\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)/i);
  // Try "Resets <Month> <Day> at <time> (<tz>)" — future-day reset
  const futureDayMatch = resetStr.match(/Resets?\s+(\w+)\s+(\d{1,2})\s+at\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)/i);

  let target: Date | null = null;

  if (sameDayMatch) {
    const [, timePart, ampm] = sameDayMatch;
    target = buildDate(now.getFullYear(), now.getMonth(), now.getDate(), timePart!, ampm!, tz);
    // If target is in the past, it resets tomorrow
    if (target <= now) {
      target = buildDate(now.getFullYear(), now.getMonth(), now.getDate() + 1, timePart!, ampm!, tz);
    }
  } else if (futureDayMatch) {
    const [, monthStr, dayStr, timePart, ampm] = futureDayMatch;
    const monthIndex = parseMonth(monthStr!);
    if (monthIndex >= 0) {
      let year = now.getFullYear();
      if (monthIndex < now.getMonth() || (monthIndex === now.getMonth() && parseInt(dayStr!) < now.getDate())) {
        year++;
      }
      target = buildDate(year, monthIndex, parseInt(dayStr!), timePart!, ampm!, tz);
    }
  }

  if (!target) return resetStr;

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'any moment';

  return formatDuration(diffMs);
}

function buildDate(year: number, month: number, day: number, timePart: string, ampm: string, tz: string): Date {
  const [hourStr, minuteStr] = timePart.includes(':') ? timePart.split(':') : [timePart, '0'];
  let hour = parseInt(hourStr!);
  const minute = parseInt(minuteStr!);

  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;

  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    const utcGuess = new Date(dateStr + 'Z');
    const parts = formatter.formatToParts(utcGuess);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0');

    const tzDate = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')));
    const offsetMs = tzDate.getTime() - utcGuess.getTime();

    return new Date(utcGuess.getTime() - offsetMs);
  } catch {
    return new Date(dateStr);
  }
}

function parseMonth(str: string): number {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return months.findIndex((m) => str.toLowerCase().startsWith(m));
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (totalHours < 24) {
    const remainingMin = totalMinutes % 60;
    return remainingMin > 0 ? `${totalHours}h ${remainingMin}m` : `${totalHours}h`;
  }
  const remainingHours = totalHours % 24;
  return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
}

function getFillColor(remaining: number): string {
  if (remaining > 50) return 'var(--theme-success, #22c55e)';
  if (remaining >= 20) return 'var(--theme-warning, #eab308)';
  return 'var(--theme-danger, #ef4444)';
}

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
}

function Tooltip({ children, content }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Position below the trigger, horizontally centered
    setCoords({
      top: rect.bottom + 6,
      left: rect.left + rect.width / 2,
    });
  }, []);

  useEffect(() => {
    if (visible) updatePosition();
  }, [visible, updatePosition]);

  return (
    <div
      ref={triggerRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && coords && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] min-w-[180px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 shadow-lg"
          style={{
            top: coords.top,
            left: coords.left,
            transform: 'translateX(-50%)',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </div>
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
  const timeLeft = parseTimeLeft(metric.reset);

  const tooltipContent = (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-[var(--theme-text-primary)]">
        {metric.label}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--theme-bg-overlay)]">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${remaining}%`, backgroundColor: fillColor }}
          />
        </div>
        <span className="text-[10px] font-medium text-[var(--theme-text-secondary)]">
          {remaining}% left
        </span>
      </div>
      <div className="text-[10px] text-[var(--theme-text-muted)]">
        Resets in {timeLeft}
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
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
    </Tooltip>
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

  return (
    <div className="flex items-center gap-2">
      {gauges.map((g) => (
        <Gauge key={g.label} metric={g.metric} label={g.label} />
      ))}
    </div>
  );
}
