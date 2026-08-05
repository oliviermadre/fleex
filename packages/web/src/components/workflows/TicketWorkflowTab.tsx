import { useEffect, useMemo, useState } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@fleex/shared';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../../stores/workflowRunStore';
import { fetchTicketDeliverables } from '../../services/api';
import { appWs } from '../../services/websocket';
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
  // The ticket's deliverables, so the DAG can mark the step that produced each
  // one — the same treatment a routine run gets, where they ship inline with
  // the run. On a ticket they live on the ticket, hence the separate fetch.
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    fetchTicketDeliverables(ticketId)
      .then((list) => {
        if (!cancelled) setDeliverables(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  // Live-follow the ticket's deliverables: a step that produces one while the
  // tab is open must light its node up without a manual refresh.
  useEffect(() => {
    return appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'deliverable:created' || msg.type === 'deliverable:updated') {
        const d = msg.data as TicketDeliverable;
        if (d.ticketId !== ticketId) return;
        setDeliverables((prev) =>
          prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? d : x)) : [...prev, d],
        );
      } else if (msg.type === 'deliverable:deleted') {
        const { deliverableId, ticketId: tid } = msg.data as { deliverableId: string; ticketId: string };
        if (tid === ticketId) setDeliverables((prev) => prev.filter((x) => x.id !== deliverableId));
      }
    });
  }, [ticketId]);

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

  const d = currentRunId ? detail[currentRunId] : undefined;

  // A ticket accumulates deliverables from every run (and from plain agent
  // work), so the list has to be narrowed to the run on screen before
  // WorkflowRunView can place them on its nodes.
  //
  // `stepRunId` names the attempt and settles it outright. Rows written before
  // that anchor existed only carry the `workflow:{name} → {step}` author
  // string, which two runs of the same template share — so they are also
  // bounded by the run's own time window. Nothing outside [startedAt,
  // completedAt] can belong to it.
  const runDeliverables = useMemo(() => {
    if (!d) return [];
    const stepRunIds = new Set(d.stepRuns.map((sr) => sr.id));
    const authorPrefix = `workflow:${d.run.templateSnapshot.name} → `;
    const from = new Date(d.run.startedAt).getTime();
    const until = d.run.completedAt ? new Date(d.run.completedAt).getTime() : Infinity;
    return deliverables.filter((x) => {
      if (x.stepRunId) return stepRunIds.has(x.stepRunId);
      if (!x.agentName.startsWith(authorPrefix)) return false;
      const at = new Date(x.createdAt).getTime();
      return at >= from && at <= until;
    });
  }, [deliverables, d]);

  if (!runs || runs.length === 0) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
        No workflow runs on this ticket yet.
      </div>
    );
  }

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
        <WorkflowRunView run={d.run} stepRuns={d.stepRuns} deliverables={runDeliverables} />
      ) : (
        <div className="p-6 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          Loading…
        </div>
      )}
    </div>
  );
}
