import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { StatisticsResponse } from '@fleex/shared';
import {
  AXIS_TICK,
  ChartCard,
  DonutChart,
  EmptyChart,
  GRID_STROKE,
  HBarChart,
  StatTooltip,
  TimeAreaChart,
  TimeLineChart,
  colorAt,
  formatCompact,
  formatDays,
  formatDuration,
  formatPct,
  formatTokens,
  formatUsd,
  shortLabel,
  type SeriesDef,
} from './statCharts';

// ── Shared small building blocks ────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Horizontal category bars — grouped or stacked — for per-entity comparisons. */
function CategoryBars({
  rows,
  segs,
  stacked = true,
  height = 260,
  format,
}: {
  rows: Row[];
  segs: SeriesDef[];
  stacked?: boolean;
  height?: number;
  format?: (v: number) => string;
}) {
  if (rows.length === 0) return <EmptyChart message="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => (format ? format(Number(v)) : formatCompact(Number(v)))} />
        <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={120} />
        <Tooltip content={<StatTooltip format={format} hideZero />} cursor={{ fill: 'var(--theme-bg-hover)' }} />
        {segs.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? 'stack' : undefined} fill={s.color} radius={stacked ? 0 : [0, 3, 3, 0]} maxBarSize={26} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Composed chart: bars on the left axis, a rate/line on the right axis. */
function DualAxisComposed({
  rows,
  bars,
  line,
  rightFormat = formatPct,
  rightDomain,
  height = 260,
}: {
  rows: Row[];
  bars: SeriesDef[];
  line: SeriesDef;
  rightFormat?: (v: number) => string;
  rightDomain?: [number, number];
  height?: number;
}) {
  if (rows.length === 0) return <EmptyChart message="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatCompact(Number(v))} />
        <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} domain={rightDomain} tickFormatter={(v) => rightFormat(Number(v))} />
        <Tooltip content={<StatTooltip hideZero />} cursor={{ fill: 'var(--theme-bg-hover)' }} />
        {bars.map((s) => (
          <Bar key={s.key} yAxisId="left" dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        ))}
        <Line yAxisId="right" type="monotone" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2.5} dot={{ r: 2, fill: line.color }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

interface ScatterPoint {
  x: number;
  y: number;
  z?: number;
  color: string;
  label: string;
  xDisplay: string;
  yDisplay: string;
  extra?: string;
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-glass-surface-dense)] px-3 py-2 shadow-xl backdrop-blur-md">
      <div className="mb-1 text-[11px] font-semibold text-[var(--theme-text-primary)]">{p.label}</div>
      <div className="space-y-0.5 text-[11px] text-[var(--theme-text-secondary)]">
        <div>{p.xDisplay}</div>
        <div>{p.yDisplay}</div>
        {p.extra && <div>{p.extra}</div>}
      </div>
    </div>
  );
}

function BubbleScatter({
  points,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
  zRange = [60, 500],
  refLines = [],
  xType = 'number',
  height = 300,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  zRange?: [number, number];
  refLines?: Array<{ y: number; label: string; color: string; dash?: boolean }>;
  xType?: 'number' | 'time';
  height?: number;
}) {
  if (points.length === 0) return <EmptyChart message="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          domain={xType === 'time' ? ['dataMin', 'dataMax'] : [0, 'dataMax']}
          tickFormatter={(v) => xFormat(Number(v))}
          label={{ value: xLabel, position: 'insideBottom', offset: -8, fontSize: 10, fill: 'var(--theme-text-muted)' }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => yFormat(Number(v))}
        />
        <ZAxis type="number" dataKey="z" range={zRange} />
        <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} />
        {refLines.map((r, i) => (
          <ReferenceLine
            key={i}
            y={r.y}
            yAxisId={0}
            stroke={r.color}
            strokeDasharray={r.dash ? '5 4' : undefined}
            label={{ value: r.label, position: 'right', fontSize: 9, fill: r.color }}
          />
        ))}
        <Scatter data={points} isAnimationActive={false}>
          {points.map((p, i) => (
            <Cell key={i} fill={p.color} fillOpacity={0.7} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Activity heatmap (custom CSS grid) ──────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ActivityHeatmap({ data }: { data: StatisticsResponse['activityHeatmap'] }) {
  if (data.length === 0) return <EmptyChart message="No agent activity to map" />;
  const grid = new Map<string, number>();
  let max = 0;
  for (const c of data) {
    grid.set(`${c.dow}:${c.hour}`, c.count);
    if (c.count > max) max = c.count;
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid" style={{ gridTemplateColumns: '34px repeat(24, 1fr)', gap: 2 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[8px] text-[var(--theme-text-faint)]">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
          {DOW_LABELS.map((label, dow) => (
            <div key={dow} className="contents">
              <div className="flex items-center text-[9px] text-[var(--theme-text-muted)]">{label}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const v = grid.get(`${dow}:${h}`) ?? 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <div
                    key={h}
                    title={`${label} ${h}:00 — ${v} run${v === 1 ? '' : 's'}`}
                    className="aspect-square rounded-sm"
                    style={{
                      backgroundColor: v === 0 ? 'var(--theme-bg-overlay)' : 'var(--theme-accent)',
                      opacity: v === 0 ? 0.4 : 0.25 + intensity * 0.75,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[9px] text-[var(--theme-text-muted)]">
          <span>less</span>
          {[0.15, 0.4, 0.65, 0.9].map((o) => (
            <span key={o} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'var(--theme-accent)', opacity: o }} />
          ))}
          <span>more</span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function reliabilityColor(rate: number): string {
  if (rate >= 0.9) return '#22c55e';
  if (rate >= 0.7) return '#eab308';
  return '#ef4444';
}

function cumulative(series: ReadonlyArray<{ date: string }>, keys: string[]): Row[] {
  const acc: Record<string, number> = {};
  return series.map((b) => {
    const row: Row = { label: shortLabel(b.date) };
    for (const k of keys) {
      acc[k] = (acc[k] ?? 0) + Number((b as Record<string, unknown>)[k] ?? 0);
      row[k] = acc[k];
    }
    return row;
  });
}

// ── Candidate registry ──────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  title: string;
  desc: string;
  chart: string;
  starred?: boolean;
  render: (data: StatisticsResponse) => React.ReactNode;
}

export const CANDIDATES: Candidate[] = [
  {
    id: 'C1',
    title: 'Agent efficiency quadrant',
    desc: 'Cost vs duration per agent — bubble size = spawns, colour = success rate. Spot the expensive & slow.',
    chart: 'Bubble scatter',
    starred: true,
    render: (data) => {
      const points: ScatterPoint[] = data.agentLeaderboard
        .filter((a) => a.avgDurationMs != null && a.avgCostUsd != null)
        .map((a) => {
          const done = a.completedCount + a.failedCount;
          const rate = done > 0 ? a.completedCount / done : 1;
          return {
            x: a.avgDurationMs!,
            y: a.avgCostUsd ?? 0,
            z: a.spawnCount,
            color: reliabilityColor(rate),
            label: a.personaDisplayName,
            xDisplay: `Avg duration: ${formatDuration(a.avgDurationMs!)}`,
            yDisplay: `Avg cost: ${formatUsd(a.avgCostUsd ?? 0)}`,
            extra: `${a.spawnCount} spawns · ${Math.round(rate * 100)}% success`,
          };
        });
      return <BubbleScatter points={points} xLabel="Avg duration" yLabel="Avg cost" xFormat={formatDuration} yFormat={formatUsd} />;
    },
  },
  {
    id: 'C2',
    title: 'Agent reliability',
    desc: 'Completed vs failed runs per agent. Who needs babysitting.',
    chart: 'Stacked H-bar',
    render: (data) => {
      const rows: Row[] = data.agentLeaderboard
        .filter((a) => a.completedCount + a.failedCount > 0)
        .map((a) => ({ name: a.personaDisplayName, completed: a.completedCount, failed: a.failedCount }));
      return (
        <CategoryBars
          rows={rows}
          segs={[
            { key: 'completed', label: 'Completed', color: '#22c55e' },
            { key: 'failed', label: 'Failed', color: '#ef4444' },
          ]}
        />
      );
    },
  },
  {
    id: 'C3',
    title: 'Cost Pareto by agent',
    desc: 'Spend per agent (desc) with cumulative %. The 80/20 of your budget.',
    chart: 'Bar + cumulative line',
    starred: true,
    render: (data) => {
      const sorted = data.agentLeaderboard.filter((a) => a.totalCostUsd > 0).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
      const total = sorted.reduce((s, a) => s + a.totalCostUsd, 0);
      let run = 0;
      const rows: Row[] = sorted.map((a) => {
        run += a.totalCostUsd;
        return { label: a.personaDisplayName, cost: a.totalCostUsd, cumulative: total > 0 ? (run / total) * 100 : 0 };
      });
      return (
        <DualAxisComposed
          rows={rows}
          bars={[{ key: 'cost', label: 'Cost', color: colorAt(2) }]}
          line={{ key: 'cumulative', label: 'Cumulative %', color: colorAt(8) }}
          rightDomain={[0, 100]}
        />
      );
    },
  },
  {
    id: 'C4',
    title: 'Activity heatmap',
    desc: 'Agent runs by weekday × hour. When Fleex works — including off-hours autonomy.',
    chart: 'Heatmap',
    render: (data) => <ActivityHeatmap data={data.activityHeatmap} />,
  },
  {
    id: 'C5',
    title: 'Delivery burn-up',
    desc: 'Cumulative tickets completed and PRs created. Momentum over the period.',
    chart: 'Cumulative line',
    render: (data) => {
      const rows = cumulative(data.timeSeries, ['ticketsCompleted', 'prsCreated']);
      return (
        <TimeLineChart
          data={rows}
          xKey="label"
          series={[
            { key: 'ticketsCompleted', label: 'Tickets done', color: colorAt(1) },
            { key: 'prsCreated', label: 'PRs', color: colorAt(8) },
          ]}
        />
      );
    },
  },
  {
    id: 'C6',
    title: 'Cost per outcome',
    desc: 'Agentic $ spent per completed ticket and per PR. Are we getting cheaper per delivery?',
    chart: 'Line',
    render: (data) => {
      const rows: Row[] = data.timeSeries.map((b) => ({
        label: shortLabel(b.date),
        perTicket: b.ticketsCompleted > 0 ? b.totalCostUsd / b.ticketsCompleted : 0,
        perPR: b.prsCreated > 0 ? b.totalCostUsd / b.prsCreated : 0,
      }));
      return (
        <TimeLineChart
          data={rows}
          xKey="label"
          format={formatUsd}
          series={[
            { key: 'perTicket', label: '$ / ticket', color: colorAt(1) },
            { key: 'perPR', label: '$ / PR', color: colorAt(8) },
          ]}
        />
      );
    },
  },
  {
    id: 'C7',
    title: 'Human vs agent mix',
    desc: 'Share of comments written by humans vs agents over time. Degree of autonomy.',
    chart: '100% stacked area',
    render: (data) => {
      const rows: Row[] = data.timeSeries.map((b) => ({
        label: shortLabel(b.date),
        user: b.commentsCreatedByUser,
        agent: b.commentsCreatedByAgent,
      }));
      const hasData = data.timeSeries.some((b) => b.commentsCreatedByUser + b.commentsCreatedByAgent > 0);
      return hasData ? (
        <TimeAreaChart
          data={rows}
          xKey="label"
          expand
          series={[
            { key: 'agent', label: 'Agent', color: colorAt(0) },
            { key: 'user', label: 'Human', color: colorAt(3) },
          ]}
        />
      ) : (
        <EmptyChart message="No comments in this period" />
      );
    },
  },
  {
    id: 'C8',
    title: 'Mention resolution funnel',
    desc: 'Mentions created → resolved, with the resolution rate.',
    chart: 'Funnel',
    render: (data) => {
      const created = data.summary.mentionsCreated;
      const resolved = data.summary.mentionsResolved;
      if (created === 0) return <EmptyChart message="No mentions in this period" />;
      const funnelData = [
        { name: `Created (${created})`, value: created, fill: colorAt(4) },
        { name: `Resolved (${resolved})`, value: Math.max(resolved, 0), fill: colorAt(1) },
      ];
      return (
        <div>
          <ResponsiveContainer width="100%" height={220}>
            <FunnelChart>
              <Tooltip content={<StatTooltip />} />
              <Funnel dataKey="value" data={funnelData} isAnimationActive={false}>
                <LabelList position="right" fill="var(--theme-text-secondary)" stroke="none" dataKey="name" fontSize={11} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
          <p className="mt-1 text-center text-xs text-[var(--theme-text-muted)]">
            Resolution rate: <span className="font-semibold text-[var(--theme-text-primary)]">{formatPct((resolved / created) * 100)}</span>
          </p>
        </div>
      );
    },
  },
  {
    id: 'C9',
    title: 'Cost share over time',
    desc: 'How the spend split between agents shifts week to week (normalized to 100%).',
    chart: '100% stacked area',
    render: (data) => {
      const names = new Set<string>();
      for (const b of data.timeSeries) for (const n of Object.keys(b.costByAgent ?? {})) names.add(n);
      const list = [...names];
      if (list.length === 0) return <EmptyChart message="No cost recorded yet" />;
      const series: SeriesDef[] = list.map((name, i) => ({ key: name, label: name, color: colorAt(i) }));
      const rows: Row[] = data.timeSeries.map((b) => {
        const row: Row = { label: shortLabel(b.date) };
        for (const n of list) row[n] = b.costByAgent?.[n] ?? 0;
        return row;
      });
      return <TimeAreaChart data={rows} xKey="label" series={series} expand format={formatUsd} />;
    },
  },
  {
    id: 'C10',
    title: 'Tokens in vs out by agent',
    desc: 'Input vs output tokens per agent. Context size and verbosity.',
    chart: 'Grouped H-bar',
    render: (data) => {
      const rows: Row[] = data.agentLeaderboard
        .filter((a) => a.totalInputTokens + a.totalOutputTokens > 0)
        .map((a) => ({ name: a.personaDisplayName, input: a.totalInputTokens, output: a.totalOutputTokens }));
      return (
        <CategoryBars
          rows={rows}
          stacked={false}
          format={formatTokens}
          segs={[
            { key: 'input', label: 'Input', color: colorAt(0) },
            { key: 'output', label: 'Output', color: colorAt(8) },
          ]}
        />
      );
    },
  },
  {
    id: 'C11',
    title: 'Throughput + completion rate',
    desc: 'Tickets created vs completed (bars) with the completion rate (line).',
    chart: 'Bar + rate line',
    render: (data) => {
      const rows: Row[] = data.timeSeries.map((b) => ({
        label: shortLabel(b.date),
        created: b.ticketsCreated,
        completed: b.ticketsCompleted,
        rate: b.ticketsCreated > 0 ? (b.ticketsCompleted / b.ticketsCreated) * 100 : 0,
      }));
      return (
        <DualAxisComposed
          rows={rows}
          bars={[
            { key: 'created', label: 'Created', color: colorAt(0) },
            { key: 'completed', label: 'Completed', color: colorAt(1) },
          ]}
          line={{ key: 'rate', label: 'Completion %', color: colorAt(6) }}
        />
      );
    },
  },
  {
    id: 'C12',
    title: 'Skills: usage × reliability',
    desc: 'Executions per skill, split completed vs failed.',
    chart: 'Stacked H-bar',
    render: (data) => {
      const rows: Row[] = data.skillLeaderboard
        .filter((s) => s.executionCount > 0)
        .map((s) => ({ name: s.skillDisplayName, completed: s.completedCount, failed: s.failedCount }));
      return (
        <CategoryBars
          rows={rows}
          segs={[
            { key: 'completed', label: 'Completed', color: '#22c55e' },
            { key: 'failed', label: 'Failed', color: '#ef4444' },
          ]}
        />
      );
    },
  },
  {
    id: 'C13',
    title: 'Usage by type over time',
    desc: 'Agents vs skills vs panels vs workflows — which execution modes you actually use.',
    chart: 'Multi-line',
    starred: true,
    render: (data) => {
      const rows: Row[] = data.usageByType.map((b) => ({ ...b, label: shortLabel(b.date) }));
      return (
        <TimeLineChart
          data={rows}
          xKey="label"
          series={[
            { key: 'agents', label: 'Agents', color: colorAt(0) },
            { key: 'skills', label: 'Skills', color: colorAt(6) },
            { key: 'panels', label: 'Panels', color: colorAt(4) },
            { key: 'workflows', label: 'Workflows', color: colorAt(8) },
          ]}
        />
      );
    },
  },
  {
    id: 'C14',
    title: 'Iterations per ticket',
    desc: 'Distribution of conversation length (comments + mentions + workflows) before a ticket is done. Left-heavy = good one-shot rate.',
    chart: 'Histogram',
    starred: true,
    render: (data) => {
      if (data.ticketIterations.length === 0) return <EmptyChart message="No tickets completed in this period" />;
      const bins = [
        { name: '1', test: (n: number) => n <= 1 },
        { name: '2–3', test: (n: number) => n >= 2 && n <= 3 },
        { name: '4–6', test: (n: number) => n >= 4 && n <= 6 },
        { name: '7–10', test: (n: number) => n >= 7 && n <= 10 },
        { name: '11+', test: (n: number) => n >= 11 },
      ];
      const rows: Row[] = bins.map((b, i) => ({
        name: b.name,
        count: data.ticketIterations.filter((t) => b.test(t.total)).length,
        color: colorAt(i),
      }));
      return (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} label={{ value: 'interactions / ticket', position: 'insideBottom', offset: -2, fontSize: 9, fill: 'var(--theme-text-muted)' }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <Tooltip content={<StatTooltip format={(v) => `${v} tickets`} />} cursor={{ fill: 'var(--theme-bg-hover)' }} />
            <Bar dataKey="count" name="Tickets" radius={[3, 3, 0, 0]} maxBarSize={64} isAnimationActive={false}>
              {rows.map((_, i) => (
                <Cell key={i} fill={colorAt(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    },
  },
  {
    id: 'C15',
    title: 'Lead time control chart',
    desc: 'One point per ticket: x = date done, y = days from first “doing” to done. Mean & upper control limit flag outliers/drift.',
    chart: 'Control chart',
    starred: true,
    render: (data) => {
      const pts = data.leadTime.points;
      if (pts.length === 0) return <EmptyChart message="No tickets with a doing→done history in this period" />;
      const days = pts.map((p) => p.leadTimeMs / 86_400_000);
      const mean = days.reduce((a, b) => a + b, 0) / days.length;
      const variance = days.reduce((a, b) => a + (b - mean) ** 2, 0) / days.length;
      const sigma = Math.sqrt(variance);
      const ucl = mean + 3 * sigma;
      const points: ScatterPoint[] = pts.map((p) => {
        const d = p.leadTimeMs / 86_400_000;
        return {
          x: new Date(p.doneAt).getTime(),
          y: d,
          z: 120,
          color: d > ucl ? '#ef4444' : colorAt(0),
          label: p.title || p.ticketId,
          xDisplay: `Done: ${new Date(p.doneAt).toLocaleDateString()}`,
          yDisplay: `Lead time: ${formatDays(p.leadTimeMs)}`,
        };
      });
      return (
        <BubbleScatter
          points={points}
          xType="time"
          xLabel="Done date"
          yLabel="Lead time (days)"
          xFormat={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          yFormat={(v) => `${v.toFixed(0)}d`}
          zRange={[80, 120]}
          refLines={[
            { y: mean, label: `mean ${mean.toFixed(1)}d`, color: 'var(--theme-text-muted)' },
            { y: ucl, label: `UCL ${ucl.toFixed(1)}d`, color: '#ef4444', dash: true },
          ]}
        />
      );
    },
  },
  {
    id: 'C16',
    title: 'Cumulative flow (CFD)',
    desc: 'Tickets in each status over time. Widening bands reveal bottlenecks and growing WIP.',
    chart: 'Stacked area',
    starred: true,
    render: (data) => {
      if (data.cumulativeFlow.length === 0) return <EmptyChart message="No ticket history in this period" />;
      const rows: Row[] = data.cumulativeFlow.map((b) => ({ ...b, label: shortLabel(b.date) }));
      return (
        <TimeAreaChart
          data={rows}
          xKey="label"
          series={[
            { key: 'done', label: 'Done', color: '#22c55e' },
            { key: 'reviewing', label: 'Reviewing', color: colorAt(8) },
            { key: 'doing', label: 'Doing', color: colorAt(2) },
            { key: 'todo', label: 'Todo', color: colorAt(4) },
            { key: 'backlog', label: 'Backlog', color: colorAt(11) },
          ]}
        />
      );
    },
  },
  {
    id: 'C17',
    title: 'Cycle time by status',
    desc: 'Average time tickets sit in each status before moving on. Where the time really goes.',
    chart: 'H-bar',
    render: (data) => {
      const rows = data.cycleTimeByStatus
        .filter((c) => c.avgMs != null && c.avgMs > 0)
        .map((c) => ({ name: c.status, value: c.avgMs as number }));
      return <HBarChart data={rows} format={formatDays} color={colorAt(2)} />;
    },
  },
  {
    id: 'C18',
    title: 'Throughput vs WIP',
    desc: 'Tickets completed per bucket (bars) against work-in-progress (line). Little’s law sanity check.',
    chart: 'Bar + line',
    render: (data) => {
      if (data.throughputWip.length === 0) return <EmptyChart message="No ticket history in this period" />;
      const rows: Row[] = data.throughputWip.map((b) => ({ ...b, label: shortLabel(b.date) }));
      return (
        <DualAxisComposed
          rows={rows}
          bars={[{ key: 'completed', label: 'Completed', color: colorAt(1) }]}
          line={{ key: 'wip', label: 'WIP (doing+review)', color: colorAt(2) }}
          rightFormat={(v) => formatCompact(v)}
        />
      );
    },
  },
];

// ── Gallery ─────────────────────────────────────────────────────────────────

export function CandidateGallery({ data }: { data: StatisticsResponse }) {
  return (
    <div>
      <div className="mb-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-3 text-xs text-[var(--theme-text-secondary)]">
        <span className="font-semibold text-[var(--theme-text-primary)]">18 dataviz candidates.</span> Each is independent and tagged
        with an ID (C1–C18) so we can discuss it by name. <span className="text-[var(--theme-warning)]">★</span> marks the 6 I'd pick
        for the real dashboard. Filter the time range above — everything reacts.
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {CANDIDATES.map((c) => (
          <ChartCard
            key={c.id}
            title={c.title}
            subtitle={c.desc}
            action={
              <div className="flex shrink-0 items-center gap-1.5">
                {c.starred && <span className="text-sm text-[var(--theme-warning)]" title="Top pick">★</span>}
                <span className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--theme-text-secondary)]">
                  {c.id}
                </span>
                <span className="rounded-md bg-[var(--theme-accent-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-accent)]">
                  {c.chart}
                </span>
              </div>
            }
          >
            {c.render(data)}
          </ChartCard>
        ))}
      </div>
    </div>
  );
}
