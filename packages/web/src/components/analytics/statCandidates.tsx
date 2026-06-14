import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
  EmptyChart,
  GRID_STROKE,
  HBarChart,
  StatTooltip,
  TimeAreaChart,
  TimeLineChart,
  colorAt,
  formatCompact,
  formatDays,
  formatPct,
  formatUsd,
  shortLabel,
  type SeriesDef,
} from './statCharts';

// ── Shared small building blocks ────────────────────────────────────────────

type Row = Record<string, unknown>;

interface AxisMeanLine {
  value: number;
  color: string;
  axis: 'left' | 'right';
  label?: string;
}

/** Composed chart: bars on the left axis, a rate/line on the right axis. */
function DualAxisComposed({
  rows,
  bars,
  line,
  rightFormat = formatPct,
  rightDomain,
  meanLines,
  height = 260,
}: {
  rows: Row[];
  bars: SeriesDef[];
  line: SeriesDef;
  rightFormat?: (v: number) => string;
  rightDomain?: [number, number];
  meanLines?: AxisMeanLine[];
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
        {meanLines?.map((m, i) => (
          <ReferenceLine
            key={`mean-${i}`}
            yAxisId={m.axis}
            y={m.value}
            stroke={m.color}
            strokeDasharray="5 4"
            label={m.label ? { value: m.label, position: m.axis === 'right' ? 'insideTopRight' : 'insideTopLeft', fontSize: 9, fill: m.color } : undefined}
          />
        ))}
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
  yScale = 'linear',
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
  yScale?: 'linear' | 'sqrt';
  height?: number;
}) {
  if (points.length === 0) return <EmptyChart message="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* Extra right margin so reference-line labels (mean / UCL) aren't clipped. */}
      <ScatterChart margin={{ top: 8, right: 64, left: 0, bottom: 16 }}>
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
          scale={yScale}
          domain={yScale === 'sqrt' ? [0, 'auto'] : undefined}
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
            <Cell key={i} fill={p.color} fillOpacity={0.78} stroke="var(--theme-bg-surface)" strokeWidth={1} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Activity heatmap (custom CSS grid) ──────────────────────────────────────
// Rows run Monday → Sunday. Cells stay keyed by getDay() (0=Sun … 6=Sat).

const DOW_ROWS: { label: string; dow: number }[] = [
  { label: 'Mon', dow: 1 },
  { label: 'Tue', dow: 2 },
  { label: 'Wed', dow: 3 },
  { label: 'Thu', dow: 4 },
  { label: 'Fri', dow: 5 },
  { label: 'Sat', dow: 6 },
  { label: 'Sun', dow: 0 },
];

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
          {DOW_ROWS.map(({ label, dow }) => (
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

// ── Palettes ────────────────────────────────────────────────────────────────

/** C14 — semiologic ramp: more interactions before "done" = hotter = worse. */
const ITERATION_BIN_COLORS = ['#22c55e', '#38bdf8', '#f59e0b', '#f97316', '#ef4444'];

/** C17 — match the app's Kanban status colors (see lib/statusColors.ts). */
const STATUS_BAR_COLOR: Record<string, string> = {
  backlog: 'var(--theme-text-muted)',
  todo: '#fb923c', // orange-400
  doing: '#60a5fa', // blue-400
  reviewing: '#c084fc', // purple-400
  done: '#4ade80', // green-400
};

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
    id: 'C6',
    title: 'Cost per outcome',
    desc: 'Agentic $ spent per completed ticket. Are we getting cheaper per delivery?',
    chart: 'Line',
    render: (data) => {
      const rows: Row[] = data.timeSeries.map((b) => ({
        label: shortLabel(b.date),
        perTicket: b.ticketsCompleted > 0 ? b.totalCostUsd / b.ticketsCompleted : 0,
      }));
      // Average over buckets that actually completed tickets (ignore empty days).
      const vals = data.timeSeries.filter((b) => b.ticketsCompleted > 0).map((b) => b.totalCostUsd / b.ticketsCompleted);
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return (
        <TimeLineChart
          data={rows}
          xKey="label"
          format={formatUsd}
          series={[{ key: 'perTicket', label: '$ / ticket', color: colorAt(1) }]}
          meanLines={avg != null ? [{ value: avg, color: 'var(--theme-text-secondary)', label: `avg ${formatUsd(avg)}` }] : undefined}
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
      const n = data.timeSeries.length || 1;
      const avgCreated = data.timeSeries.reduce((s, b) => s + b.ticketsCreated, 0) / n;
      const avgCompleted = data.timeSeries.reduce((s, b) => s + b.ticketsCompleted, 0) / n;
      const rateVals = data.timeSeries.filter((b) => b.ticketsCreated > 0).map((b) => (b.ticketsCompleted / b.ticketsCreated) * 100);
      const avgRate = rateVals.length > 0 ? rateVals.reduce((a, b) => a + b, 0) / rateVals.length : null;
      return (
        <DualAxisComposed
          rows={rows}
          bars={[
            { key: 'created', label: 'Created', color: colorAt(0) },
            { key: 'completed', label: 'Completed', color: colorAt(1) },
          ]}
          line={{ key: 'rate', label: 'Completion %', color: colorAt(6) }}
          meanLines={[
            { value: avgCreated, color: colorAt(0), axis: 'left', label: `x̄ ${avgCreated.toFixed(1)}` },
            { value: avgCompleted, color: colorAt(1), axis: 'left', label: `x̄ ${avgCompleted.toFixed(1)}` },
            ...(avgRate != null ? [{ value: avgRate, color: colorAt(6), axis: 'right' as const, label: `x̄ ${avgRate.toFixed(0)}%` }] : []),
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
          legend
          series={[
            { key: 'agents', label: 'Agents', color: '#3b82f6' }, // blue
            { key: 'skills', label: 'Skills', color: '#22c55e' }, // green
            { key: 'panels', label: 'Panels', color: '#eab308' }, // yellow
            { key: 'workflows', label: 'Workflows', color: '#ef4444' }, // red
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
      const rows: Row[] = bins.map((b) => ({
        name: b.name,
        count: data.ticketIterations.filter((t) => b.test(t.total)).length,
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
                <Cell key={i} fill={ITERATION_BIN_COLORS[i] ?? '#ef4444'} />
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
    desc: 'One point per ticket: x = date done, y = days from first “doing” to done. Mean & upper control limit flag outliers/drift. Y axis is √-scaled to spread the dense low band.',
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
      // Deterministic ±12h horizontal jitter so same-day tickets fan out instead
      // of stacking on a single vertical line.
      const SIX_HOURS = 6 * 3_600_000;
      const points: ScatterPoint[] = pts.map((p, i) => {
        const d = p.leadTimeMs / 86_400_000;
        return {
          x: new Date(p.doneAt).getTime() + ((i % 5) - 2) * SIX_HOURS,
          y: d,
          z: 1,
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
          yScale="sqrt"
          xLabel="Done date"
          yLabel="Lead time (days)"
          xFormat={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          yFormat={(v) => `${v.toFixed(0)}d`}
          zRange={[44, 44]}
          refLines={[
            { y: 1, label: '1d', color: 'var(--theme-success)', dash: true },
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
        .map((c) => ({ name: c.status, value: c.avgMs as number, color: STATUS_BAR_COLOR[c.status] }));
      return <HBarChart data={rows} format={formatDays} />;
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
        <span className="font-semibold text-[var(--theme-text-primary)]">10 retained dataviz.</span> Each is independent and keeps its
        ID (C3, C4, C6, C11, C13–C18) so we can discuss it by name. <span className="text-[var(--theme-warning)]">★</span> marks my top
        picks. Filter the time range above — everything reacts.
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
