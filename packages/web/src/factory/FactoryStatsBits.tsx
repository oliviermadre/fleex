import { Select } from '../components/ui/Select';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { money, span } from './format';
import type { MachineStats } from './types';

const PERIODS = [{ value: '1', label: 'Last 24 hours' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }];
export const periodLabel = (days: number): string => PERIODS.find((p) => p.value === String(days))?.label ?? `Last ${days} days`;

/** The period every Factory figure is read over. One setting for the whole page. */
export function PeriodSelect({ id }: { id: string }) {
  const days = useFactoryStore((s) => s.statsDays), loadStats = useFactoryStore((s) => s.loadStats);
  return <Select id={id} aria-label="Period" value={String(days)} onChange={(e) => void loadStats(Number(e.target.value))} options={PERIODS} />;
}

export function Tile({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' | 'warning' }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--theme-border)] px-1.5 py-1.5 text-center">
      <div className="truncate text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]">{label}</div>
      <div className={cn('truncate font-mono text-sm', tone === 'danger' ? 'text-[var(--theme-danger)]' : tone === 'warning' ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-primary)]')}>{value}</div>
    </div>
  );
}

/** What one machine did over the period: its runs, how they ended, what they took and cost. */
export function MachineFigures({ m, gate, className }: { m: MachineStats | null; gate: boolean; className?: string }) {
  if (!m) return <p className="text-xs text-[var(--theme-text-muted)]">Nothing ran here over this period.</p>;
  const outcomes = Object.entries(m.outcomes).sort((a, b) => b[1] - a[1]), left = outcomes.reduce((n, [, c]) => n + c, 0);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="grid grid-cols-3 gap-2">
        <Tile label={gate ? 'Decisions' : 'Runs'} value={m.runs} />
        {gate ? <Tile label="Avg decision" value={span(m.avgHumanMs)} tone={m.avgHumanMs ? 'warning' : undefined} /> : <Tile label="Avg run" value={span(m.avgRunMs)} />}
        {gate ? <Tile label="Human wait" value={span(m.humanMs)} /> : <Tile label="Cost" value={money(m.costUsd)} />}
        {!gate && <Tile label="Failed" value={m.failed} tone={m.failed ? 'danger' : undefined} />}
        {!gate && <Tile label="Questions" value={m.questions} tone={m.questions ? 'warning' : undefined} />}
        {!gate && <Tile label="Human wait" value={m.humanWaits ? span(m.humanMs) : '–'} />}
      </div>
      {left > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--theme-bg-overlay)]" role="img" aria-label={outcomes.map(([o, c]) => `${o}: ${c}`).join(', ')}>
            {outcomes.map(([o, c], i) => <span key={o} style={{ width: `${(c / left) * 100}%`, opacity: 1 - i * 0.28 }} className="h-full bg-[var(--theme-accent)]" />)}
          </div>
          <div className="flex flex-wrap gap-x-3 text-[11px] text-[var(--theme-text-secondary)]">
            {outcomes.map(([o, c]) => <span key={o}><span className="font-mono text-[var(--theme-text-primary)]">{o}</span> {c} · {Math.round((c / left) * 100)}%</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
