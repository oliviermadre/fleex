import { useEffect, useMemo, useState } from 'react';
import type {
  StatisticsResponse,
  StatisticsSummary,
  StatisticsTimeBucket,
  AgentLeaderboardEntry,
  SkillLeaderboardEntry,
  PanelLeaderboardEntry,
} from '@fleex/shared';
import { useStatisticsStore, type Preset, type Granularity } from '../../stores/statisticsStore';
import { cn } from '../../lib/cn';
import {
  ChartCard,
  DeliveryComposedChart,
  DonutChart,
  EmptyChart,
  HBarChart,
  LegendChips,
  Sparkline,
  TimeAreaChart,
  TimeBarChart,
  colorAt,
  formatCompact,
  formatDuration,
  formatTokens,
  formatUsd,
  shortLabel,
  type DonutSlice,
  type SeriesDef,
} from './statCharts';
import { CandidateGallery } from './statCandidates';

// ── Focus tabs ──────────────────────────────────────────────────────────────

type Focus = 'overview' | 'delivery' | 'costs' | 'catalogue';

const FOCUSES: { key: Focus; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'costs', label: 'Agentic Costs' },
  { key: 'catalogue', label: 'Catalogue (10)' },
];

// ── Time range selector ──────────────────────────────────────────────────────

const PRESETS: { key: Exclude<Preset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '1y', label: '1Y' },
];

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

function Toolbar({
  preset,
  granularity,
  customFrom,
  customTo,
  loading,
  onPreset,
  onGranularity,
  onCustomRange,
  onRefresh,
}: {
  preset: Preset;
  granularity: Granularity;
  customFrom: string;
  customTo: string;
  loading: boolean;
  onPreset: (p: Preset) => void;
  onGranularity: (g: Granularity) => void;
  onCustomRange: (from: string, to: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-[var(--theme-border)]">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              preset === p.key
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
            onClick={() => onPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
        <input
          type="date"
          value={customFrom}
          max={customTo}
          onChange={(e) => e.target.value && onCustomRange(e.target.value, customTo)}
          className={cn(
            'bg-transparent text-xs text-[var(--theme-text-secondary)] outline-none',
            preset === 'custom' && 'text-[var(--theme-text-primary)]',
          )}
        />
        <span className="text-[var(--theme-text-faint)]">→</span>
        <input
          type="date"
          value={customTo}
          min={customFrom}
          onChange={(e) => e.target.value && onCustomRange(customFrom, e.target.value)}
          className={cn(
            'bg-transparent text-xs text-[var(--theme-text-secondary)] outline-none',
            preset === 'custom' && 'text-[var(--theme-text-primary)]',
          )}
        />
      </div>

      <div className="flex overflow-hidden rounded-lg border border-[var(--theme-border)]">
        {GRANULARITIES.map((g) => (
          <button
            key={g.key}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              granularity === g.key
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
            onClick={() => onGranularity(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] disabled:opacity-50"
        title="Refresh"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn(loading && 'animate-spin')}>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" />
        </svg>
      </button>
    </div>
  );
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

interface KpiDef {
  key: keyof StatisticsSummary;
  label: string;
  color: string;
  sparkKey?: keyof StatisticsTimeBucket;
  format: (v: number) => string;
  /** When true, a downward trend is the good outcome (cost, duration). */
  goodWhenDown?: boolean;
}

const KPI_GROUPS: Record<Exclude<Focus, 'catalogue'>, KpiDef[]> = {
  overview: [
    { key: 'agentsSpawned', label: 'Agents Spawned', color: colorAt(0), sparkKey: 'agentsSpawned', format: formatCompact },
    { key: 'ticketsCompleted', label: 'Tickets Completed', color: colorAt(1), sparkKey: 'ticketsCompleted', format: formatCompact },
    { key: 'prsCreated', label: 'PRs Created', color: colorAt(8), sparkKey: 'prsCreated', format: formatCompact },
    { key: 'totalCostUsd', label: 'Total Cost', color: colorAt(2), sparkKey: 'totalCostUsd', format: formatUsd, goodWhenDown: true },
    { key: 'deliverablesCreated', label: 'Deliverables', color: colorAt(5), sparkKey: 'deliverablesCreated', format: formatCompact },
    { key: 'skillsExecuted', label: 'Skills Run', color: colorAt(6), sparkKey: 'skillsExecuted', format: formatCompact },
    { key: 'mentionsCreated', label: 'Mentions', color: colorAt(4), sparkKey: 'mentionsCreated', format: formatCompact },
    { key: 'avgAgentDurationMs', label: 'Avg Agent Duration', color: colorAt(10), format: formatDuration, goodWhenDown: true },
  ],
  delivery: [
    { key: 'ticketsCreated', label: 'Tickets Created', color: colorAt(0), sparkKey: 'ticketsCreated', format: formatCompact },
    { key: 'ticketsCompleted', label: 'Tickets Completed', color: colorAt(1), sparkKey: 'ticketsCompleted', format: formatCompact },
    { key: 'prsCreated', label: 'PRs Created', color: colorAt(8), sparkKey: 'prsCreated', format: formatCompact },
    { key: 'prsMerged', label: 'PRs Merged', color: colorAt(5), format: formatCompact },
    { key: 'deliverablesCreated', label: 'Deliverables', color: colorAt(2), sparkKey: 'deliverablesCreated', format: formatCompact },
    { key: 'commentsCreated', label: 'Comments', color: colorAt(3), sparkKey: 'commentsCreated', format: formatCompact },
    { key: 'worktreesCreated', label: 'Worktrees', color: colorAt(4), sparkKey: 'worktreesCreated', format: formatCompact },
    { key: 'mentionsResolved', label: 'Mentions Resolved', color: colorAt(6), sparkKey: 'mentionsResolved', format: formatCompact },
  ],
  costs: [
    { key: 'totalCostUsd', label: 'Total Cost', color: colorAt(2), sparkKey: 'totalCostUsd', format: formatUsd, goodWhenDown: true },
    { key: 'totalInputTokens', label: 'Input Tokens', color: colorAt(0), format: formatTokens },
    { key: 'totalOutputTokens', label: 'Output Tokens', color: colorAt(8), format: formatTokens },
    { key: 'agentsSpawned', label: 'Agent Runs', color: colorAt(1), sparkKey: 'agentsSpawned', format: formatCompact },
    { key: 'skillsExecuted', label: 'Skills Run', color: colorAt(6), sparkKey: 'skillsExecuted', format: formatCompact },
    { key: 'panelsExecuted', label: 'Panels Run', color: colorAt(4), format: formatCompact },
    { key: 'avgAgentDurationMs', label: 'Avg Duration', color: colorAt(10), format: formatDuration, goodWhenDown: true },
    { key: 'activeSessions', label: 'Active Sessions', color: colorAt(5), format: formatCompact },
  ],
};

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function DeltaBadge({ delta, goodWhenDown }: { delta: number | null; goodWhenDown?: boolean }) {
  if (delta === null) {
    return <span className="text-[10px] font-medium text-[var(--theme-text-faint)]">new</span>;
  }
  if (Math.round(delta) === 0) {
    return <span className="text-[10px] font-medium text-[var(--theme-text-faint)]">±0%</span>;
  }
  const up = delta > 0;
  const good = goodWhenDown ? !up : up;
  const color = good ? 'var(--theme-success)' : 'var(--theme-danger)';
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold tabular-nums" style={{ color }}>
      <span>{up ? '▲' : '▼'}</span>
      {Math.abs(delta).toFixed(0)}%
    </span>
  );
}

function KpiCard({
  def,
  current,
  previous,
  spark,
}: {
  def: KpiDef;
  current: number;
  previous: number | undefined;
  spark: number[];
}) {
  const delta = previous !== undefined ? pctDelta(current, previous) : null;
  return (
    <div className="flex flex-col justify-between rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: def.color }} />
          <span className="text-[11px] font-medium text-[var(--theme-text-muted)]">{def.label}</span>
        </div>
        {previous !== undefined && <DeltaBadge delta={delta} goodWhenDown={def.goodWhenDown} />}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--theme-text-primary)]">{def.format(current)}</div>
      <div className="mt-1 h-9">
        {def.sparkKey && <Sparkline data={spark} color={def.color} />}
      </div>
    </div>
  );
}

// ── Activity series ───────────────────────────────────────────────────────────

const ACTIVITY_SERIES: SeriesDef[] = [
  { key: 'agentsSpawned', label: 'Agents', color: colorAt(0) },
  { key: 'ticketsCreated', label: 'Tickets', color: colorAt(1) },
  { key: 'ticketsCompleted', label: 'Completed', color: colorAt(2) },
  { key: 'commentsCreated', label: 'Comments', color: colorAt(3) },
  { key: 'mentionsCreated', label: 'Mentions', color: colorAt(4) },
  { key: 'deliverablesCreated', label: 'Deliverables', color: colorAt(5) },
  { key: 'skillsExecuted', label: 'Skills', color: colorAt(6) },
  { key: 'prsCreated', label: 'PRs', color: colorAt(8) },
];

// ── Leaderboard table ─────────────────────────────────────────────────────────

interface Column<T> {
  header: string;
  align?: 'left' | 'right';
  render: (row: T, i: number) => React.ReactNode;
}

function LeaderboardTable<T>({
  title,
  rows,
  columns,
  empty,
  keyOf,
}: {
  title: string;
  rows: T[];
  columns: Column<T>[];
  empty: string;
  keyOf: (row: T) => string;
}) {
  return (
    <ChartCard title={title}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-[var(--theme-text-faint)]">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--theme-border)]">
                {columns.map((c, i) => (
                  <th
                    key={i}
                    className={cn(
                      'pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]',
                      c.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={keyOf(row)} className="border-b border-[var(--theme-border)] transition-colors last:border-0 hover:bg-[var(--theme-bg-hover)]">
                  {columns.map((c, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'py-2 text-sm tabular-nums',
                        c.align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

function RankCell({ index, name }: { index: number; name: string }) {
  return (
    <span className="flex items-center gap-2 text-[var(--theme-text-primary)]">
      <span className="w-5 text-right text-xs text-[var(--theme-text-faint)]">#{index + 1}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Inline bar showing this value relative to the column max. */
function BarValue({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-[var(--theme-text-secondary)]">{label}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--theme-bg-overlay)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
    </div>
  );
}

// ── Flatten Record<name, number> time series into stacked-chart rows ───────────

function flattenByKey(
  buckets: StatisticsTimeBucket[],
  pick: (b: StatisticsTimeBucket) => Record<string, number>,
): { rows: Array<Record<string, unknown>>; series: SeriesDef[] } {
  const names = new Set<string>();
  for (const b of buckets) for (const n of Object.keys(pick(b) ?? {})) names.add(n);
  const list = [...names];
  const series: SeriesDef[] = list.map((name, i) => ({ key: name, label: name, color: colorAt(i) }));
  const rows = buckets.map((b) => {
    const src = pick(b) ?? {};
    const row: Record<string, unknown> = { label: shortLabel(b.date) };
    for (const name of list) row[name] = src[name] ?? 0;
    return row;
  });
  return { rows, series };
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function StatisticsView() {
  const data = useStatisticsStore((s) => s.data);
  const previous = useStatisticsStore((s) => s.previous);
  const loading = useStatisticsStore((s) => s.loading);
  const preset = useStatisticsStore((s) => s.preset);
  const granularity = useStatisticsStore((s) => s.granularity);
  const customFrom = useStatisticsStore((s) => s.customFrom);
  const customTo = useStatisticsStore((s) => s.customTo);
  const fetch = useStatisticsStore((s) => s.fetch);
  const setPreset = useStatisticsStore((s) => s.setPreset);
  const setGranularity = useStatisticsStore((s) => s.setGranularity);
  const setCustomRange = useStatisticsStore((s) => s.setCustomRange);

  const [focus, setFocus] = useState<Focus>('overview');
  const [activeSeries, setActiveSeries] = useState<Set<string>>(
    () => new Set(ACTIVITY_SERIES.map((s) => s.key)),
  );

  useEffect(() => {
    fetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSeries = (key: string) =>
    setActiveSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-[var(--theme-border)] px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-0.5">
            {FOCUSES.map((f) => (
              <button
                key={f.key}
                onClick={() => setFocus(f.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  focus === f.key
                    ? 'bg-[var(--theme-accent)] text-white'
                    : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Toolbar
            preset={preset}
            granularity={granularity}
            customFrom={customFrom}
            customTo={customTo}
            loading={loading}
            onPreset={setPreset}
            onGranularity={setGranularity}
            onCustomRange={setCustomRange}
            onRefresh={fetch}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-[var(--theme-text-faint)]">
            <span className="text-sm">Loading statistics…</span>
          </div>
        )}

        {data && focus === 'catalogue' && <CandidateGallery data={data} />}

        {data && focus !== 'catalogue' && (
          <DashboardContent data={data} previous={previous} focus={focus} activeSeries={activeSeries} onToggleSeries={toggleSeries} />
        )}

        {!loading && !data && (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--theme-text-faint)]">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 opacity-30">
              <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" />
            </svg>
            <p className="text-sm">No statistics available</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardContent({
  data,
  previous,
  focus,
  activeSeries,
  onToggleSeries,
}: {
  data: StatisticsResponse;
  previous: StatisticsResponse | null;
  focus: Focus;
  activeSeries: Set<string>;
  onToggleSeries: (key: string) => void;
}) {
  const kpis = KPI_GROUPS[focus as Exclude<Focus, 'catalogue'>];

  const sparkData = (key: keyof StatisticsTimeBucket): number[] =>
    data.timeSeries.map((b) => Number(b[key] ?? 0));

  const activityRows = useMemo<Record<string, unknown>[]>(
    () => data.timeSeries.map((b) => ({ ...b, label: shortLabel(b.date) })),
    [data.timeSeries],
  );
  const shownActivity = ACTIVITY_SERIES.filter((s) => activeSeries.has(s.key));

  const cost = useMemo(() => flattenByKey(data.timeSeries, (b) => b.costByAgent), [data.timeSeries]);
  const boards = useMemo(() => flattenByKey(data.timeSeries, (b) => b.ticketsDoneByBoard), [data.timeSeries]);

  const costByAgent: DonutSlice[] = useMemo(
    () =>
      data.agentLeaderboard
        .filter((a) => a.totalCostUsd > 0)
        .map((a) => ({ name: a.personaDisplayName, value: a.totalCostUsd })),
    [data.agentLeaderboard],
  );

  const tokensByAgent: DonutSlice[] = useMemo(
    () =>
      data.agentLeaderboard
        .map((a) => ({ name: a.personaDisplayName, value: a.totalInputTokens + a.totalOutputTokens }))
        .filter((a) => a.value > 0),
    [data.agentLeaderboard],
  );

  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((def) => (
          <KpiCard
            key={def.key}
            def={def}
            current={Number(data.summary[def.key] ?? 0)}
            previous={previous ? Number(previous.summary[def.key] ?? 0) : undefined}
            spark={def.sparkKey ? sparkData(def.sparkKey) : []}
          />
        ))}
      </div>

      {focus === 'overview' && (
        <>
          <ChartCard
            title="Activity Over Time"
            subtitle="Stacked volume of every tracked event. Click a chip to toggle a series."
            action={<LegendChips series={ACTIVITY_SERIES} active={activeSeries} onToggle={onToggleSeries} />}
          >
            {shownActivity.length > 0 ? (
              <TimeAreaChart data={activityRows} series={shownActivity} xKey="label" />
            ) : (
              <EmptyChart message="Select at least one series" />
            )}
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title="Delivery Throughput" subtitle="Tickets created vs completed, with PRs created">
              <DeliveryComposedChart
                data={activityRows}
                xKey="label"
                bars={[
                  { key: 'ticketsCreated', label: 'Created', color: colorAt(0) },
                  { key: 'ticketsCompleted', label: 'Completed', color: colorAt(1) },
                ]}
                line={{ key: 'prsCreated', label: 'PRs', color: colorAt(8) }}
              />
            </ChartCard>

            <ChartCard title="Cost Over Time" subtitle="Agentic spend per bucket, stacked by agent">
              {cost.series.length > 0 ? (
                <TimeBarChart data={cost.rows} series={cost.series} xKey="label" format={formatUsd} />
              ) : (
                <EmptyChart message="No cost recorded — run an agent to start tracking" />
              )}
            </ChartCard>
          </div>
        </>
      )}

      {focus === 'delivery' && (
        <>
          <ChartCard title="Delivery Throughput" subtitle="Tickets created vs completed, with PRs created over time">
            <DeliveryComposedChart
              data={activityRows}
              xKey="label"
              bars={[
                { key: 'ticketsCreated', label: 'Created', color: colorAt(0) },
                { key: 'ticketsCompleted', label: 'Completed', color: colorAt(1) },
              ]}
              line={{ key: 'prsCreated', label: 'PRs', color: colorAt(8) }}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title="Tickets Done by Board" subtitle="When tickets moved to done, grouped by board">
              {boards.series.length > 0 ? (
                <TimeBarChart data={boards.rows} series={boards.series} xKey="label" />
              ) : (
                <EmptyChart message="No tickets moved to done in this period" />
              )}
            </ChartCard>

            <ChartCard title="Collaboration Volume" subtitle="Comments, mentions and deliverables produced">
              <TimeAreaChart
                data={activityRows}
                xKey="label"
                series={[
                  { key: 'commentsCreated', label: 'Comments', color: colorAt(3) },
                  { key: 'mentionsCreated', label: 'Mentions', color: colorAt(4) },
                  { key: 'deliverablesCreated', label: 'Deliverables', color: colorAt(5) },
                ]}
              />
            </ChartCard>
          </div>
        </>
      )}

      {focus === 'costs' && (
        <>
          <ChartCard title="Cost Over Time" subtitle="Agentic spend per bucket, stacked by agent">
            {cost.series.length > 0 ? (
              <TimeBarChart data={cost.rows} series={cost.series} xKey="label" format={formatUsd} />
            ) : (
              <EmptyChart message="No cost recorded — run an agent to start tracking" />
            )}
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title="Cost Share by Agent" subtitle="Where the budget goes">
              <DonutChart
                data={costByAgent}
                format={formatUsd}
                centerLabel="total"
                centerValue={formatUsd(data.summary.totalCostUsd)}
              />
            </ChartCard>

            <ChartCard title="Tokens by Agent" subtitle="Total input + output tokens">
              <HBarChart data={tokensByAgent} format={formatTokens} color={colorAt(0)} />
            </ChartCard>
          </div>
        </>
      )}

      {/* Leaderboards */}
      <AgentLeaderboard entries={data.agentLeaderboard} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkillLeaderboard entries={data.skillLeaderboard} />
        <PanelLeaderboard entries={data.panelLeaderboard} />
      </div>
    </div>
  );
}

// ── Concrete leaderboards ─────────────────────────────────────────────────────

function AgentLeaderboard({ entries }: { entries: AgentLeaderboardEntry[] }) {
  const maxSpawn = Math.max(1, ...entries.map((e) => e.spawnCount));
  const maxCost = Math.max(0.0001, ...entries.map((e) => e.totalCostUsd));
  return (
    <LeaderboardTable
      title="Agent Leaderboard"
      rows={entries}
      empty="No agent executions yet"
      keyOf={(e) => e.personaId}
      columns={[
        { header: 'Agent', render: (e, i) => <RankCell index={i} name={e.personaDisplayName} /> },
        {
          header: 'Spawns',
          align: 'right',
          render: (e) => <BarValue value={e.spawnCount} max={maxSpawn} color={colorAt(0)} label={String(e.spawnCount)} />,
        },
        { header: 'Avg Duration', align: 'right', render: (e) => <span className="text-[var(--theme-text-secondary)]">{e.avgDurationMs != null ? formatDuration(e.avgDurationMs) : '—'}</span> },
        {
          header: 'Cost',
          align: 'right',
          render: (e) => <BarValue value={e.totalCostUsd} max={maxCost} color={colorAt(2)} label={e.totalCostUsd > 0 ? formatUsd(e.totalCostUsd) : '—'} />,
        },
        { header: 'Tokens', align: 'right', render: (e) => <span className="text-[var(--theme-text-secondary)]">{e.totalInputTokens + e.totalOutputTokens > 0 ? formatTokens(e.totalInputTokens + e.totalOutputTokens) : '—'}</span> },
        { header: 'Done', align: 'right', render: (e) => <span style={{ color: 'var(--theme-success)' }}>{e.completedCount}</span> },
        { header: 'Failed', align: 'right', render: (e) => <span style={{ color: e.failedCount > 0 ? 'var(--theme-danger)' : 'var(--theme-text-faint)' }}>{e.failedCount}</span> },
      ]}
    />
  );
}

function SkillLeaderboard({ entries }: { entries: SkillLeaderboardEntry[] }) {
  const max = Math.max(1, ...entries.map((e) => e.executionCount));
  return (
    <LeaderboardTable
      title="Skill Leaderboard"
      rows={entries}
      empty="No skill executions yet"
      keyOf={(e) => e.skillId}
      columns={[
        { header: 'Skill', render: (e, i) => <RankCell index={i} name={e.skillDisplayName} /> },
        {
          header: 'Runs',
          align: 'right',
          render: (e) => <BarValue value={e.executionCount} max={max} color={colorAt(6)} label={String(e.executionCount)} />,
        },
        { header: 'Done', align: 'right', render: (e) => <span style={{ color: 'var(--theme-success)' }}>{e.completedCount}</span> },
        { header: 'Failed', align: 'right', render: (e) => <span style={{ color: e.failedCount > 0 ? 'var(--theme-danger)' : 'var(--theme-text-faint)' }}>{e.failedCount}</span> },
      ]}
    />
  );
}

function PanelLeaderboard({ entries }: { entries: PanelLeaderboardEntry[] }) {
  const max = Math.max(1, ...entries.map((e) => e.executionCount));
  return (
    <LeaderboardTable
      title="Panel Leaderboard"
      rows={entries}
      empty="No panel executions yet"
      keyOf={(e) => e.panelId}
      columns={[
        { header: 'Panel', render: (e, i) => <RankCell index={i} name={e.panelDisplayName} /> },
        {
          header: 'Runs',
          align: 'right',
          render: (e) => <BarValue value={e.executionCount} max={max} color={colorAt(4)} label={String(e.executionCount)} />,
        },
        { header: 'Avg Duration', align: 'right', render: (e) => <span className="text-[var(--theme-text-secondary)]">{e.avgDurationMs != null ? formatDuration(e.avgDurationMs) : '—'}</span> },
        { header: 'Done', align: 'right', render: (e) => <span style={{ color: 'var(--theme-success)' }}>{e.completedCount}</span> },
        { header: 'Failed', align: 'right', render: (e) => <span style={{ color: e.failedCount > 0 ? 'var(--theme-danger)' : 'var(--theme-text-faint)' }}>{e.failedCount}</span> },
      ]}
    />
  );
}
