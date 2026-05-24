import { useEffect, useState } from 'react';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { WorkflowRunView } from './WorkflowRunView';

interface Props {
  ticketId: string;
}

export function TicketWorkflowTab({ ticketId }: Props) {
  const loadForTicket = useWorkflowRunStore((s) => s.loadForTicket);
  const loadDetail = useWorkflowRunStore((s) => s.loadDetail);
  const runsByTicket = useWorkflowRunStore((s) => s.runsByTicket);
  const detail = useWorkflowRunStore((s) => s.detail);
  const active = useWorkflowRunStore((s) => s.activeByTicket(ticketId));
  const history = useWorkflowRunStore((s) => s.historyByTicket(ticketId));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    void loadForTicket(ticketId);
  }, [ticketId, loadForTicket]);

  const currentRunId = active?.id ?? selectedRunId ?? history[0]?.id;

  useEffect(() => {
    if (currentRunId && !detail[currentRunId]) void loadDetail(currentRunId);
  }, [currentRunId, detail, loadDetail]);

  if ((runsByTicket[ticketId]?.length ?? 0) === 0) {
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
