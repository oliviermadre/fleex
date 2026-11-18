import { useEffect } from 'react';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { RunLimits } from './FactoryLimits';
import { FactoryPopup } from './FactoryPopup';
import { PeriodSelect, Tile } from './FactoryStatsBits';
import { money, span } from './format';
import { standing } from './lens';

const Head = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{children}</h3>{right}</div>
);
const Hint = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-[var(--theme-text-muted)]">{children}</p>;

/**
 * The floor as a whole, opened from the command card when nothing is selected: what it did over the period, machine
 * by machine, where tickets stand right now, and its safety limits. A row leads to its machine on the floor.
 */
export function FactoryFloorPopup({ onClose, onGoTo }: { onClose: () => void; onGoTo: (machineId: string) => void }) {
  const snapshot = useFactoryStore((s) => s.snapshot), layout = useFactoryStore((s) => s.layout), stats = useFactoryStore((s) => s.stats);
  useEffect(() => { if (!useFactoryStore.getState().stats) void useFactoryStore.getState().loadStats(); }, []);
  if (!snapshot || !layout) return null;
  const jams = standing(layout, snapshot.tickets, snapshot.serverTime);
  const ran = stats ? stats.machines.filter((q) => q.runs > 0).sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs) : [];
  const go = (machineId: string) => { onGoTo(machineId); onClose(); };
  return (
    <FactoryPopup label="Factory floor" onClose={onClose} size="fit" maxWidth="max-w-6xl" bar={<b className="min-w-0 flex-1 truncate text-sm text-[var(--theme-text-primary)]">Factory floor</b>}>
      <div className="grid min-h-0 grid-cols-1 divide-y divide-[var(--theme-border)] overflow-y-auto lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <Head right={<PeriodSelect id="factory-floor-period" />}>What the floor did</Head>
          {!stats ? <Hint>Loading</Hint> : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Tile label="Shipped" value={stats.totals.shipped} />
                <Tile label="Lead time" value={span(stats.totals.avgLeadMs)} />
                <Tile label="Cost" value={money(stats.totals.costUsd)} />
                <Tile label="Runs" value={stats.totals.runs} />
                <Tile label="Failed" value={stats.totals.failed} tone={stats.totals.failed ? 'danger' : undefined} />
                <Tile label="Human wait" value={span(stats.totals.humanMs)} />
              </div>
              {stats.totals.shipped > 0 && stats.totals.costUsd > 0 && <Hint>{money(stats.totals.costUsd / stats.totals.shipped)} per ticket shipped.</Hint>}
              {ran.length === 0 ? <Hint>Nothing ran over this period.</Hint> : (
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]">
                    <th className="w-full py-1 font-semibold">Machine</th><th className="whitespace-nowrap px-2 py-1 text-right font-semibold">Runs</th><th className="whitespace-nowrap px-2 py-1 text-right font-semibold">Failed</th>
                    <th className="whitespace-nowrap px-2 py-1 text-right font-semibold">Questions</th><th className="whitespace-nowrap px-2 py-1 text-right font-semibold">Avg run</th><th className="whitespace-nowrap px-2 py-1 text-right font-semibold">Human wait</th><th className="py-1 pl-2 text-right font-semibold">Cost</th>
                  </tr></thead>
                  <tbody>
                    {ran.map((q) => (
                      <tr key={q.machineId} className="border-t border-[var(--theme-border)]">
                        <td className="w-full max-w-0 truncate py-1.5">
                          {q.onFloor ? <button type="button" className="max-w-full truncate text-[var(--theme-text-primary)] hover:underline" title="Go to this machine" onClick={() => go(q.machineId)}>{q.name}</button>
                            : <span className="text-[var(--theme-text-muted)]">{q.name} (removed)</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-[var(--theme-text-secondary)]">{q.runs}</td>
                        <td className={cn('px-2 py-1.5 text-right font-mono', q.failed ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-muted)]')}>{q.failed}</td>
                        <td className={cn('px-2 py-1.5 text-right font-mono', q.questions ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{q.questions}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-[var(--theme-text-secondary)]">{q.avgRunMs ? span(q.avgRunMs) : '–'}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-[var(--theme-text-secondary)]">{q.humanWaits ? span(q.humanMs) : '–'}</td>
                        <td className="py-1.5 pl-2 text-right font-mono text-[var(--theme-text-primary)]">{money(q.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <Head>Where tickets stand</Head>
          {jams.length === 0 && <Hint>Nothing stands in a station or a zone.</Hint>}
          {jams.slice(0, 8).map((j) => (
            <button key={j.machineId} type="button" onClick={() => go(j.machineId)} title="Go to this machine" className="flex w-full flex-col rounded-md border border-[var(--theme-border)] px-2 py-1.5 text-left hover:bg-[var(--theme-bg-overlay)]">
              <span className="flex items-baseline justify-between gap-2 text-xs"><span className="min-w-0 truncate font-medium text-[var(--theme-text-primary)]">{j.name}</span><span className="flex-none font-mono text-[var(--theme-text-secondary)]">{j.count} · {span(j.oldestMs)}</span></span>
              <span className={cn('text-[11px]', j.human ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{j.why}</span>
            </button>
          ))}
          {jams.length > 0 && <Hint>Count, and how long the oldest has been there. The worst first.</Hint>}
          <Head>Safety limits</Head>
          <RunLimits idPrefix="f" />
        </div>
      </div>
    </FactoryPopup>
  );
}
