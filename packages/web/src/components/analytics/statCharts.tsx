import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../lib/cn';

// ── Shared palette ────────────────────────────────────────────────────────
// A vivid, color-blind-friendly-ish palette that reads well across every
// Fleex theme (dark and light). Series keep stable colors via SERIES_COLORS.

export const PALETTE = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#ef4444', // red
  '#84cc16', // lime
  '#3b82f6', // blue
  '#f97316', // orange
  '#14b8a6', // teal
  '#eab308', // yellow
];

export function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length]!;
}

// ── Formatters ──────────────────────────────────────────────────────────────

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${formatCompact(n)}`;
}

export function formatTokens(n: number): string {
  if (n === 0) return '0';
  return formatCompact(n);
}

export function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}

export function formatDays(ms: number): string {
  const days = ms / 86_400_000;
  if (days < 1) return formatDuration(ms);
  return `${days.toFixed(1)}d`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem > 0 ? ` ${rem}s` : ''}`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h${remM > 0 ? ` ${remM}m` : ''}`;
}

/** Trim ISO-ish bucket labels (2024-05-12 → 05-12, 2024-05 → 2024-05). */
export function shortLabel(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(5);
  return date;
}

// ── Card shell ────────────────────────────────────────────────────────────

export function ChartCard({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4 shadow-sm',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-[var(--theme-text-muted)]">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-center text-xs text-[var(--theme-text-faint)]">
      {message}
    </div>
  );
}

// ── Custom tooltip ──────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export function StatTooltip({
  active,
  payload,
  label,
  format,
  hideZero,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  format?: (v: number) => string;
  hideZero?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const fmt = format ?? ((v: number) => formatCompact(v));
  const rows = payload.filter((p) => !hideZero || (typeof p.value === 'number' && p.value !== 0));
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, p) => sum + (typeof p.value === 'number' ? p.value : 0), 0);

  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-glass-surface-dense)] px-3 py-2 shadow-xl backdrop-blur-md">
      {label != null && (
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--theme-text-primary)]">{label}</div>
      )}
      <div className="space-y-1">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-[11px]">
            <span className="flex items-center gap-1.5 text-[var(--theme-text-secondary)]">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums text-[var(--theme-text-primary)]">
              {typeof p.value === 'number' ? fmt(p.value) : p.value}
            </span>
          </div>
        ))}
        {rows.length > 1 && (
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-[var(--theme-border)] pt-1 text-[11px]">
            <span className="text-[var(--theme-text-muted)]">Total</span>
            <span className="font-semibold tabular-nums text-[var(--theme-text-primary)]">{fmt(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export const AXIS_TICK = { fontSize: 10, fill: 'var(--theme-text-faint)' } as const;
export const GRID_STROKE = 'var(--theme-border-subtle)';

// ── Series definition ───────────────────────────────────────────────────────

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

type ChartRow = Record<string, unknown>;

// ── Stacked / overlaid area chart over time ─────────────────────────────────

export function TimeAreaChart({
  data,
  series,
  xKey,
  height = 260,
  stacked = true,
  expand = false,
  format,
}: {
  data: ReadonlyArray<ChartRow>;
  series: SeriesDef[];
  xKey: string;
  height?: number;
  stacked?: boolean;
  /** Normalize the stack to 100% (share-of-total view). */
  expand?: boolean;
  format?: (v: number) => string;
}) {
  const gid = useId().replace(/:/g, '');
  if (data.length === 0 || series.length === 0) return <EmptyChart message="No data for this period" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} stackOffset={expand ? 'expand' : undefined}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={expand ? 0.75 : 0.45} />
              <stop offset="100%" stopColor={s.color} stopOpacity={expand ? 0.35 : 0.04} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={expand ? [0, 1] : undefined}
          tickFormatter={(v) => (expand ? `${Math.round(Number(v) * 100)}%` : formatCompact(Number(v)))}
        />
        <Tooltip content={<StatTooltip format={format} hideZero />} cursor={{ stroke: GRID_STROKE }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'stack' : undefined}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#${gid}-${s.key})`}
            fillOpacity={1}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Multi-line chart over time (trend comparison) ───────────────────────────

/** A dashed horizontal reference line (e.g. a per-series average). */
export interface MeanLine {
  value: number;
  color: string;
  label?: string;
}

export function TimeLineChart({
  data,
  series,
  xKey,
  height = 260,
  format,
  legend = false,
  meanLines,
}: {
  data: ReadonlyArray<ChartRow>;
  series: SeriesDef[];
  xKey: string;
  height?: number;
  format?: (v: number) => string;
  legend?: boolean;
  meanLines?: MeanLine[];
}) {
  if (data.length === 0 || series.length === 0) return <EmptyChart message="No data for this period" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (format ? format(Number(v)) : formatCompact(Number(v)))} />
        <Tooltip content={<StatTooltip format={format} hideZero />} cursor={{ stroke: GRID_STROKE }} />
        {legend && <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />}
        {meanLines?.map((m, i) => (
          <ReferenceLine
            key={`mean-${i}`}
            y={m.value}
            stroke={m.color}
            strokeDasharray="5 4"
            label={m.label ? { value: m.label, position: 'insideTopLeft', fontSize: 9, fill: m.color } : undefined}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Stacked bar chart over time ─────────────────────────────────────────────

export function TimeBarChart({
  data,
  series,
  xKey,
  height = 240,
  stacked = true,
  format,
}: {
  data: ReadonlyArray<ChartRow>;
  series: SeriesDef[];
  xKey: string;
  height?: number;
  stacked?: boolean;
  format?: (v: number) => string;
}) {
  if (data.length === 0 || series.length === 0) return <EmptyChart message="No data for this period" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (format ? format(Number(v)) : formatCompact(Number(v)))} />
        <Tooltip content={<StatTooltip format={format} hideZero />} cursor={{ fill: 'var(--theme-bg-hover)' }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'stack' : undefined}
            fill={s.color}
            radius={stacked ? (i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]) : [3, 3, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Delivery composed chart (bars + completion line) ────────────────────────

export function DeliveryComposedChart({
  data,
  xKey,
  bars,
  line,
  height = 260,
}: {
  data: ReadonlyArray<ChartRow>;
  xKey: string;
  bars: SeriesDef[];
  line: SeriesDef;
  height?: number;
}) {
  if (data.length === 0) return <EmptyChart message="No delivery activity for this period" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatCompact(Number(v))} />
        <Tooltip content={<StatTooltip hideZero />} cursor={{ fill: 'var(--theme-bg-hover)' }} />
        {bars.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        ))}
        <Line
          type="monotone"
          dataKey={line.key}
          name={line.label}
          stroke={line.color}
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: line.color }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Donut breakdown ─────────────────────────────────────────────────────────

export interface DonutSlice {
  name: string;
  value: number;
  /** Optional explicit colour for this slice/bar (overrides the palette). */
  color?: string;
}

export function DonutChart({
  data,
  height = 240,
  format,
  centerLabel,
  centerValue,
}: {
  data: DonutSlice[];
  height?: number;
  format?: (v: number) => string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const slices = data.filter((d) => d.value > 0);
  if (slices.length === 0) return <EmptyChart message="No data for this period" />;

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip content={<StatTooltip format={format} />} />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="var(--theme-bg-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((_, i) => (
              <Cell key={i} fill={colorAt(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {(centerValue || centerLabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && <span className="text-lg font-bold tabular-nums text-[var(--theme-text-primary)]">{centerValue}</span>}
          {centerLabel && <span className="text-[10px] uppercase tracking-wide text-[var(--theme-text-muted)]">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ── Horizontal bar ranking ──────────────────────────────────────────────────

export function HBarChart({
  data,
  height = 240,
  format,
  color,
}: {
  data: DonutSlice[];
  height?: number;
  format?: (v: number) => string;
  color?: string;
}) {
  const rows = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length === 0) return <EmptyChart message="No data for this period" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => (format ? format(Number(v)) : formatCompact(Number(v)))} />
        <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={110} />
        <Tooltip content={<StatTooltip format={format} />} cursor={{ fill: 'var(--theme-bg-hover)' }} />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={26} isAnimationActive={false}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.color ?? color ?? colorAt(i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Legend chips with interactive toggling ──────────────────────────────────

export function LegendChips({
  series,
  active,
  onToggle,
}: {
  series: SeriesDef[];
  active: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {series.map((s) => {
        const on = active.has(s.key);
        return (
          <button
            key={s.key}
            onClick={() => onToggle(s.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-opacity',
              on ? 'opacity-100' : 'opacity-35',
            )}
            style={{ borderColor: `${s.color}55`, backgroundColor: `${s.color}1f`, color: s.color }}
          >
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Sparkline (KPI cards) ───────────────────────────────────────────────────

export function Sparkline({
  data,
  color,
  height = 36,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  const gid = useId().replace(/:/g, '');
  if (data.length < 2 || data.every((v) => v === 0)) return <div style={{ height }} />;
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${gid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
