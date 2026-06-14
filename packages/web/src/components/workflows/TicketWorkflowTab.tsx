import { useEffect, useMemo, useState } from 'react';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../../stores/workflowRunStore';
import { WorkflowRunView } from './WorkflowRunView';

interface Props {
  ticketId: string;
}

export function TicketWorkflowTab({ ticketId }: Props) {
  const loadForTicket = useWorkflowRunStore((s) => s.loadForTicket);
  const loadDetail = useWorkflowRunStore((s) => s.loadDetail);
  // Subscribe to the raw per-ticket runs array. The store-level helpers
  // (activeByTicket/historyByTicket) call .filter()/.find() and return fresh
  // arrays each time, which breaks Zustand's equality check → infinite loop.
  const runs = useWorkflowRunStore((s) => s.runsByTicket[ticketId]);
  const detail = useWorkflowRunStore((s) => s.detail);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { active, history } = useMemo(() => {
    const list = runs ?? [];
    return {
      active: list.find((r) => ACTIVE_STATUSES.has(r.status)),
      history: list.filter((r) => !ACTIVE_STATUSES.has(r.status)),
    };
  }, [runs]);

  useEffect(() => {
    void loadForTicket(ticketId);
  }, [ticketId, loadForTicket]);

  const currentRunId = active?.id ?? selectedRunId ?? history[0]?.id;

  // Always refetch the run detail when this tab mounts or the selected run
  // changes — never serve a stale cached detail. The tab unmounts on tab switch,
  // so a cached detail can be arbitrarily out of date (e.g. a step was terminated
  // or the run advanced to a human gate while the user was on another tab and no
  // live event refreshed the cache). `detail` is deliberately NOT a dependency:
  // loadDetail writes to it, so including it would re-fire the effect in a loop.
  // The store's seq guard discards stale in-flight responses.
  useEffect(() => {
    if (currentRunId) void loadDetail(currentRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRunId, loadDetail]);

  if (!runs || runs.length === 0) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
        No workflow runs on this ticket yet.
      </div>
    );
  }

  const d = currentRunId ? detail[currentRunId] : undefined;

  return (
    <div className="flex flex-col h-full">
      {!active && history.length > 0 && (
        <div
          className="px-4 py-2 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            Historical run:
          </span>
          <select
            value={currentRunId ?? ''}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="h-8 text-xs rounded px-2 border"
            style={{
              background: 'var(--theme-bg-surface)',
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            {history.map((r) => (
              <option key={r.id} value={r.id}>
                {r.templateSnapshot.emoji} {r.templateSnapshot.name} —{' '}
                {new Date(r.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </div>
      )}
      {d ? (
        <WorkflowRunView run={d.run} stepRuns={d.stepRuns} />
      ) : (
        <div className="p-6 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          Loading…
        </div>
      )}
    </div>
  );
}
