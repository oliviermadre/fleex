import { useState, useEffect } from 'react';
import type { TicketUsage, TicketUsageBreakdown } from '@fleex/shared';
import { fetchTicketUsage } from '../../services/api';

function formatTokens(n: number): string {
  if (!n || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Cell({ value }: { value: number }) {
  return (
    <td className="py-0.5 text-right font-mono tabular-nums text-[var(--theme-text-secondary)]">
      {formatTokens(value)}
    </td>
  );
}

const ROWS: { label: string; key: keyof TicketUsageBreakdown }[] = [
  { label: 'Input', key: 'inputTokens' },
  { label: 'Output', key: 'outputTokens' },
  { label: 'Cache in', key: 'cacheReadTokens' },
  { label: 'Cache write', key: 'cacheCreationTokens' },
];

export function TicketUsageSection({ ticketId }: { ticketId: string }) {
  const [usage, setUsage] = useState<TicketUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTicketUsage(ticketId)
      .then((u) => { if (!cancelled) setUsage(u); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticketId]);

  if (!usage || usage.total.executionCount === 0) return null;

  const { auto, manual, total } = usage;
  const totalTokens = total.inputTokens + total.outputTokens;
  const manualTokens = manual.inputTokens + manual.outputTokens;
  const manualShare = totalTokens > 0 ? Math.round((manualTokens / totalTokens) * 100) : 0;

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Usage &amp; Cost
      </label>
      <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2.5">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[var(--theme-text-faint)]">
              <th className="pb-1 text-left font-medium" />
              <th className="pb-1 text-right font-medium">Auto</th>
              <th className="pb-1 text-right font-medium">Manual</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const a = auto[row.key];
              const m = manual[row.key];
              if (a === 0 && m === 0) return null;
              return (
                <tr key={row.key}>
                  <td className="py-0.5 text-left text-[var(--theme-text-muted)]">{row.label}</td>
                  <Cell value={a} />
                  <Cell value={m} />
                </tr>
              );
            })}
            <tr className="border-t border-[var(--theme-border)]">
              <td className="pt-1 text-left text-[var(--theme-text-muted)]">Cost</td>
              <td className="pt-1 text-right font-mono tabular-nums text-amber-400">
                {auto.costUsd > 0 ? `$${auto.costUsd.toFixed(2)}` : '—'}
              </td>
              <td className="pt-1 text-right font-mono tabular-nums text-[var(--theme-text-faint)]">—</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between border-t border-[var(--theme-border)] pt-1.5 text-[10px] text-[var(--theme-text-faint)]">
          <span>{total.executionCount} run{total.executionCount !== 1 ? 's' : ''}</span>
          <span>{manualShare}% manual{manual.executionCount === 0 ? ' · full auto' : ''}</span>
        </div>
      </div>
    </div>
  );
}
