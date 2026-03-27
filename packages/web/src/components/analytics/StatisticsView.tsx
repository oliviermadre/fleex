import { useEffect } from 'react';
import type { StatisticsResponse, StatisticsTimeBucket, AgentLeaderboardEntry, SkillLeaderboardEntry, PanelLeaderboardEntry } from '@fleex/shared';
import { useStatisticsStore } from '../../stores/statisticsStore';
import { cn } from '../../lib/cn';

// ── Time Range Selector ──

type Preset = 'today' | '7d' | '30d' | '90d' | '1y';
type Granularity = 'day' | 'week' | 'month';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '1y', label: '1Y' },
];

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Wk' },
  { key: 'month', label: 'Mo' },
];

function TimeRangeSelector({
  preset,
  granularity,
  onPresetChange,
  onGranularityChange,
}: {
  preset: Preset;
  granularity: Granularity;
  onPresetChange: (p: Preset) => void;
  onGranularityChange: (g: Granularity) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex rounded-lg border border-[var(--theme-border)] overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              preset === p.key
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
            onClick={() => onPresetChange(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex rounded-lg border border-[var(--theme-border)] overflow-hidden">
        {GRANULARITIES.map((g) => (
          <button
            key={g.key}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              granularity === g.key
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
            onClick={() => onGranularityChange(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Stat Card ──

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)]">
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold tabular-nums text-[var(--theme-text-primary)]">{value}</div>
        <div className="text-[11px] text-[var(--theme-text-muted)]">{label}</div>
      </div>
    </div>
  );
}

// ── Stacked Bar Chart (Pure SVG) ──

function StackedBarChart({ data, metrics, height = 200 }: {
  data: StatisticsTimeBucket[];
  metrics: { key: keyof StatisticsTimeBucket; label: string; color: string }[];
  height?: number;
}) {
  if (data.length === 0) return null;

  const totals = data.map((d) =>
    metrics.reduce((sum, m) => sum + ((d[m.key] as number) ?? 0), 0),
  );
  const maxVal = Math.max(...totals, 1);
  const barWidth = Math.max(4, Math.min(40, (600 - data.length * 2) / data.length));
  const width = data.length * (barWidth + 2) + 40;
  const chartH = height - 30;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMid meet">
      {data.map((d, i) => {
        const x = 30 + i * (barWidth + 2);
        let offsetY = 0;

        return (
          <g key={i}>
            {metrics.map((m) => {
              const val = (d[m.key] as number) ?? 0;
              if (val === 0) return null;
              const segH = (val / maxVal) * chartH;
              const y = height - 20 - offsetY - segH;
              offsetY += segH;
              return (
                <rect
                  key={String(m.key)}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={segH}
                  fill={m.color}
                  opacity={0.85}
                >
                  <title>{`${m.label}: ${val}`}</title>
                </rect>
              );
            })}
            {(i === 0 || i === data.length - 1 || i % Math.max(1, Math.floor(data.length / 6)) === 0) && (
              <text
                x={x + barWidth / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize="9"
                fill="var(--theme-text-faint)"
              >
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      <text x="0" y="12" fontSize="9" fill="var(--theme-text-faint)">{maxVal}</text>
      <text x="0" y={height - 22} fontSize="9" fill="var(--theme-text-faint)">0</text>
    </svg>
  );
}

// ── Time Series Chart with Metric Toggle ──

const METRICS: { key: keyof StatisticsTimeBucket; label: string; color: string }[] = [
  { key: 'agentsSpawned', label: 'Agents', color: '#f59e0b' },
  { key: 'ticketsCreated', label: 'Tickets', color: '#3b82f6' },
  { key: 'commentsCreated', label: 'Comments', color: '#8b5cf6' },
  { key: 'mentionsCreated', label: 'Mentions', color: '#10b981' },
  { key: 'deliverablesCreated', label: 'Deliverables', color: '#eab308' },
  { key: 'skillsExecuted', label: 'Skills', color: '#ec4899' },
];

function TimeSeriesChart({ data }: { data: StatisticsTimeBucket[] }) {
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Activity Over Time</h3>
        <div className="flex gap-1.5">
          {METRICS.map((m) => (
            <span
              key={String(m.key)}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${m.color}30`,
                color: m.color,
                border: `1px solid ${m.color}40`,
              }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>
      <StackedBarChart data={data} metrics={METRICS} />
    </div>
  );
}

// ── Agent Leaderboard ──

function AgentLeaderboard({ entries }: { entries: AgentLeaderboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Agent Leaderboard</h3>
        <p className="mt-4 text-center text-xs text-[var(--theme-text-faint)]">No agent executions yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--theme-text-primary)]">Agent Leaderboard</h3>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--theme-border)]">
            <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Agent</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Spawns</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Avg Duration</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Cost</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Avg Tokens</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Done</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Failed</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={entry.personaId} className="border-b border-[var(--theme-border)] last:border-0">
              <td className="py-2 text-sm text-[var(--theme-text-primary)]">
                <span className="mr-2 text-[var(--theme-text-faint)]">#{i + 1}</span>
                {entry.personaDisplayName}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.spawnCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.avgDurationMs != null ? formatDuration(entry.avgDurationMs) : '—'}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-amber-400">
                {entry.totalCostUsd > 0 ? `$${entry.totalCostUsd.toFixed(2)}` : '—'}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.avgInputTokens != null ? `${Math.round(entry.avgInputTokens / 1000)}k→${Math.round((entry.avgOutputTokens ?? 0) / 1000)}k` : '—'}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-green-400">
                {entry.completedCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-red-400">
                {entry.failedCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Skill Leaderboard ──

function SkillLeaderboard({ entries }: { entries: SkillLeaderboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Skill Leaderboard</h3>
        <p className="mt-4 text-center text-xs text-[var(--theme-text-faint)]">No skill executions yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--theme-text-primary)]">Skill Leaderboard</h3>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--theme-border)]">
            <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Skill</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Executions</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Done</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Failed</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={entry.skillId} className="border-b border-[var(--theme-border)] last:border-0">
              <td className="py-2 text-sm text-[var(--theme-text-primary)]">
                <span className="mr-2 text-[var(--theme-text-faint)]">#{i + 1}</span>
                {entry.skillDisplayName}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.executionCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-green-400">
                {entry.completedCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-red-400">
                {entry.failedCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Panel Leaderboard ──

function PanelLeaderboard({ entries }: { entries: PanelLeaderboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Panel Leaderboard</h3>
        <p className="mt-4 text-center text-xs text-[var(--theme-text-faint)]">No panel executions yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--theme-text-primary)]">Panel Leaderboard</h3>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--theme-border)]">
            <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Panel</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Runs</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Done</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Failed</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Avg Duration</th>
            <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Avg Members</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={entry.panelId} className="border-b border-[var(--theme-border)] last:border-0">
              <td className="py-2 text-sm text-[var(--theme-text-primary)]">
                <span className="mr-2 text-[var(--theme-text-faint)]">#{i + 1}</span>
                {entry.panelDisplayName}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.executionCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-green-400">
                {entry.completedCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-red-400">
                {entry.failedCount}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.avgDurationMs != null ? formatDuration(entry.avgDurationMs) : '—'}
              </td>
              <td className="py-2 text-right tabular-nums text-sm text-[var(--theme-text-secondary)]">
                {entry.avgRespondedMembers != null ? entry.avgRespondedMembers : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem > 0 ? ` ${rem}s` : ''}`;
}

// ── Cost Bar Chart (stacked per agent) ──

const AGENT_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#ef4444', '#06b6d4', '#84cc16'];

function CostBarChart({ data }: { data: StatisticsTimeBucket[] }) {
  if (data.length === 0) return null;

  // Collect all unique agent names across all buckets
  const agentSet = new Set<string>();
  for (const d of data) {
    for (const name of Object.keys(d.costByAgent ?? {})) agentSet.add(name);
  }
  const agents = [...agentSet];
  if (agents.length === 0) return null;

  const height = 220;
  const legendH = 24;
  const chartH = height - 30 - legendH;
  const maxVal = Math.max(...data.map((d) => d.totalCostUsd), 0.01);
  const barWidth = Math.max(4, Math.min(40, (600 - data.length * 2) / data.length));
  const width = data.length * (barWidth + 2) + 40;

  return (
    <div>
      <svg width="100%" height={height - legendH} viewBox={`0 0 ${width} ${height - legendH}`} preserveAspectRatio="xMinYMid meet">
        {data.map((d, i) => {
          const x = 30 + i * (barWidth + 2);
          let offsetY = 0;
          const costs = d.costByAgent ?? {};
          return (
            <g key={i}>
              {agents.map((agent, ai) => {
                const val = costs[agent] ?? 0;
                if (val === 0) return null;
                const segH = (val / maxVal) * chartH;
                const y = height - legendH - 20 - offsetY - segH;
                offsetY += segH;
                return (
                  <rect key={agent} x={x} y={y} width={barWidth} height={segH} fill={AGENT_COLORS[ai % AGENT_COLORS.length]} opacity={0.85}>
                    <title>{`${agent}: $${val.toFixed(4)}`}</title>
                  </rect>
                );
              })}
              {(i === 0 || i === data.length - 1 || i % Math.max(1, Math.floor(data.length / 6)) === 0) && (
                <text x={x + barWidth / 2} y={height - legendH - 4} textAnchor="middle" fontSize="9" fill="var(--theme-text-faint)">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <text x="0" y="12" fontSize="9" fill="var(--theme-text-faint)">${maxVal.toFixed(2)}</text>
        <text x="0" y={height - legendH - 22} fontSize="9" fill="var(--theme-text-faint)">$0</text>
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {agents.map((agent, i) => (
          <div key={agent} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length] }} />
            <span className="text-[10px] text-[var(--theme-text-secondary)]">{agent}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Statistics View ──

export function StatisticsView() {
  const data = useStatisticsStore((s) => s.data);
  const loading = useStatisticsStore((s) => s.loading);
  const preset = useStatisticsStore((s) => s.preset);
  const granularity = useStatisticsStore((s) => s.granularity);
  const fetch = useStatisticsStore((s) => s.fetch);
  const setPreset = useStatisticsStore((s) => s.setPreset);
  const setGranularity = useStatisticsStore((s) => s.setGranularity);

  useEffect(() => {
    fetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      {/* Header with time range */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-6 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Statistics</h2>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">WIP</span>
        </div>
        <TimeRangeSelector
          preset={preset}
          granularity={granularity}
          onPresetChange={setPreset}
          onGranularityChange={setGranularity}
        />
      </div>

      {/* Dashboard content */}
      <div className="flex-1 overflow-auto p-6">
        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-[var(--theme-text-faint)]">
            <span className="text-sm">Loading statistics...</span>
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard
                icon={<WorktreeIcon />}
                value={data.summary.worktreesCreated}
                label="Worktrees"
              />
              <StatCard
                icon={<PRIcon />}
                value={data.summary.prsCreated}
                label="PRs Created"
              />
              <StatCard
                icon={<AgentIcon />}
                value={data.summary.agentsSpawned}
                label="Agents Spawned"
              />
              <StatCard
                icon={<DeliverableIcon />}
                value={data.summary.deliverablesCreated}
                label="Deliverables"
              />
              <StatCard
                icon={<CommentIcon />}
                value={data.summary.commentsCreated}
                label="Comments"
              />
              <StatCard
                icon={<MentionIcon />}
                value={data.summary.mentionsCreated}
                label="Mentions"
              />
              <StatCard
                icon={<TicketIcon />}
                value={data.summary.ticketsCreated}
                label="Tickets Created"
              />
              <StatCard
                icon={<DurationIcon />}
                value={data.summary.avgAgentDurationMs != null ? formatDuration(data.summary.avgAgentDurationMs) : '—'}
                label="Avg Duration"
              />
              <StatCard
                icon={<SkillIcon />}
                value={data.summary.skillsExecuted}
                label="Skills Executed"
              />
              <StatCard
                icon={<CostIcon />}
                value={data.summary.totalCostUsd > 0 ? `$${data.summary.totalCostUsd.toFixed(2)}` : '$0'}
                label="Total Cost"
              />
              <StatCard
                icon={<TokenIcon />}
                value={data.summary.totalInputTokens + data.summary.totalOutputTokens > 0
                  ? `${Math.round((data.summary.totalInputTokens + data.summary.totalOutputTokens) / 1000)}k`
                  : '0'}
                label="Total Tokens"
              />
            </div>

            {/* Time Series */}
            <TimeSeriesChart data={data.timeSeries} />

            {/* Cost Over Time */}
            <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Cost Over Time</h3>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#f59e0b30', color: '#f59e0b', border: '1px solid #f59e0b40' }}>USD</span>
              </div>
              {data.timeSeries.some((b) => b.totalCostUsd > 0)
                ? <CostBarChart data={data.timeSeries} />
                : <p className="py-8 text-center text-xs text-[var(--theme-text-faint)]">No cost data yet — run an agent to start tracking</p>
              }
            </div>

            {/* Agent Leaderboard */}
            <AgentLeaderboard entries={data.agentLeaderboard} />

            {/* Skill Leaderboard */}
            <SkillLeaderboard entries={data.skillLeaderboard} />

            {/* Panel Leaderboard */}
            <PanelLeaderboard entries={data.panelLeaderboard} />
          </div>
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

// ── Small Icons for Stat Cards ──

function WorktreeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" /><circle cx="11" cy="3.5" r="1.5" /><circle cx="8" cy="12.5" r="1.5" />
      <line x1="5" y1="5" x2="5" y2="7" /><line x1="11" y1="5" x2="11" y2="7" />
      <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
    </svg>
  );
}

function PRIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="12" cy="7" r="1.5" />
      <path d="M5 5v6M5 7.5c0-1.5 1-3 4.5-3" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  );
}

function DeliverableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MentionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
    </svg>
  );
}

function DurationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function CostIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
