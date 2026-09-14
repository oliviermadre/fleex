/**
 * The actionable workflow / agent cards for a ticket thread — the inline HITL
 * surface: running / waiting agent banners, the Human Gate approve/reject card,
 * "waiting for your input", ambiguous-route arbitration, failed-step retry and
 * crashed-session relaunch. Self-contained: it fetches its own ticket mentions
 * (+ crash failures) over the `tickets` WS channel and loads/subscribes the
 * ticket's workflow runs, so it works in the Work stream where no TicketDetail
 * parent wires that data. Deliverables are passed in (WorkView owns one live
 * subscription); executions and personas come from their shared stores, kept
 * fresh by the parent pane.
 *
 * The card derivations are the same pure selectors the ticket Comments tab uses
 * (selectGateCards, selectWaitingInputCards, …), so both surfaces stay in sync.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TicketDeliverable,
  TicketMention,
  TicketWsMessage,
  MentionExecutionFailedPayload,
} from '@fleex/shared';
import { appWs } from '../../services/websocket';
import * as api from '../../services/api';
import { tint, tintClasses } from '../../lib/tints';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../../stores/workflowRunStore';
import { useUIStore } from '../../stores/uiStore';
import { useUnreadStore } from '../../stores/unreadStore';
import { useToastStore } from '../../stores/toastStore';
import { Button } from '../ui/Button';
import { DeliverableTypeBadge } from '../ui/DeliverableTypeBadge';
import { HumanGateResolvePanel } from '../workflows/HumanGateResolvePanel';
import { NeedsReviewRespondPanel } from '../workflows/NeedsReviewRespondPanel';
import { AmbiguousRouteResolvePanel } from '../workflows/AmbiguousRouteResolvePanel';
import { FailedStepRetryPanel } from '../workflows/FailedStepRetryPanel';
import { selectGateCards } from '../workflows/gateCards';
import { selectWaitingInputCards } from '../workflows/waitingInputCards';
import { selectAmbiguousRoutingCards } from '../workflows/ambiguousRoutingCards';
import { selectFailedStepCards } from '../workflows/failedStepCards';
import { selectCrashedMentionCards, crashReasonLabel } from './crashedMentionCards';

function isUrl(s: string): boolean {
  const t = s.trim();
  return /^https?:\/\/\S+$/.test(t);
}

function DeliverableChip({ deliverable, onOpen }: {
  deliverable: TicketDeliverable;
  onOpen: (d: TicketDeliverable) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(deliverable); }}
      title={deliverable.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
    >
      <DeliverableTypeBadge type={deliverable.type} />
      <span className="truncate font-medium text-[var(--theme-text-primary)]">{deliverable.title}</span>
    </button>
  );
}

interface Props {
  ticketId: string;
  deliverables: TicketDeliverable[];
  onOpenExecution: (executionId: string, title: string) => void;
  /**
   * The "…is working" running-agent banner. On by default (the Comments tab has
   * no other running signal); the Work stream renders a RunCard per running
   * execution already, so it turns this off to avoid double-reporting the run.
   */
  showRunningBanner?: boolean;
}

export function TicketActionCards({ ticketId, deliverables, onOpenExecution, showRunningBanner = true }: Props) {
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  // Live crash reason/message per mention, from the `mention:execution_failed`
  // event. On a cold reload this is empty but the mention is still persisted as
  // `failed`, so the crash card renders with a generic fallback.
  const [failures, setFailures] = useState<Record<string, { reason: string; message: string }>>({});
  const [relaunching, setRelaunching] = useState<Record<string, boolean>>({});

  const executionsByTicket = useAgentEventStore((s) => s.executionsByTicket);
  const personas = useAgentPersonaStore((s) => s.personas);

  // Workflow runs: the Work stream has no TicketDetail parent, so we load and
  // subscribe them here. Subscribe to the RAW per-ticket array (store helpers
  // return fresh arrays and would break Zustand's equality check).
  const workflowRuns = useWorkflowRunStore((s) => s.runsByTicket[ticketId]);
  const workflowDetail = useWorkflowRunStore((s) => s.detail);
  const loadWorkflowDetail = useWorkflowRunStore((s) => s.loadDetail);
  const resolveGate = useWorkflowRunStore((s) => s.resolveGate);
  const retryStep = useWorkflowRunStore((s) => s.retry);
  const resolveRoute = useWorkflowRunStore((s) => s.resolveRoute);

  // Deliverable overlay opening (gate "to review" chips).
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const floatingDeliverableIds = useUIStore((s) => s.floatingDeliverableIds);
  const bringDeliverableToFront = useUIStore((s) => s.bringDeliverableToFront);
  const seenDeliverables = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]);
  const toggleDeliverableSeen = useUnreadStore((s) => s.toggleDeliverableSeen);

  const handleOpenDeliverable = useCallback((d: TicketDeliverable) => {
    if (!seenDeliverables?.has(d.id)) {
      toggleDeliverableSeen(ticketId, d.id, true).catch(() => {});
    }
    if (isUrl(d.content)) {
      window.open(d.content.trim(), '_blank', 'noopener');
    } else if (floatingDeliverableIds.includes(d.id)) {
      bringDeliverableToFront(d.id);
    } else {
      openDeliverableOverlay(d);
    }
  }, [ticketId, seenDeliverables, toggleDeliverableSeen, floatingDeliverableIds, bringDeliverableToFront, openDeliverableOverlay]);

  // Fetch mentions + load workflow runs on mount / ticket change.
  useEffect(() => {
    api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
    void useWorkflowRunStore.getState().loadForTicket(ticketId);
    // A new ticket starts with no crash context; drop the previous one's.
    setFailures({});
  }, [ticketId]);

  // Live updates over the `tickets` channel: mention lifecycle + crash failures,
  // and workflow:* events fanned into the workflow run store (same wiring as
  // TicketDetail), so the cards live-update as steps advance.
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        const msg = raw as TicketWsMessage;
        if (msg.type === 'mention:created') {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          }
        } else if (msg.type === 'mention:deleted') {
          const d = msg.data as { id: string; ticketId: string };
          if (d.ticketId === ticketId) setMentions((prev) => prev.filter((x) => x.id !== d.id));
        } else if (
          msg.type === 'mention:updated' ||
          msg.type === 'mention:acknowledged' ||
          msg.type === 'mention:resolved' ||
          msg.type === 'mention:waiting_for_info'
        ) {
          const m = msg.data as TicketMention;
          if (m.ticketId === ticketId) {
            setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
            // Any change away from `failed` clears the stale crash reason so the
            // card disappears; the update that *carries* `failed` keeps it.
            if (m.status !== 'failed') {
              setFailures((prev) => {
                if (!(m.id in prev)) return prev;
                const { [m.id]: _drop, ...rest } = prev;
                return rest;
              });
            }
            if (msg.type === 'mention:resolved') {
              useAgentEventStore.getState().reconcileOnMentionResolved(m.ticketId, m.id);
            }
          }
        } else if (msg.type === 'mention:execution_failed') {
          const d = msg.data as MentionExecutionFailedPayload;
          if (d.ticketId === ticketId) {
            setFailures((prev) => ({ ...prev, [d.mentionId]: { reason: d.reason, message: d.message } }));
          }
        } else if (raw.type.startsWith('workflow:')) {
          const { ticketId: tid } = raw.data as { ticketId: string };
          if (tid === ticketId) {
            useWorkflowRunStore.getState().applyEvent({
              type: raw.type,
              ticketId: tid,
              payload: raw.data as Record<string, unknown>,
            });
          }
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, [ticketId]);

  // Ensure step-run detail is loaded for every active run (detection reads
  // step-run status, which lives in the detail). A run that just failed drops out
  // of ACTIVE_STATUSES, so also load the latest failed run's detail — otherwise
  // the "step failed" card vanishes on reload while the failure is unresolved.
  useEffect(() => {
    const runs = workflowRuns ?? [];
    for (const r of runs) {
      if (ACTIVE_STATUSES.has(r.status)) void loadWorkflowDetail(r.id);
    }
    const latest = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (latest?.status === 'failed') void loadWorkflowDetail(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowRuns, loadWorkflowDetail]);

  const runningAgents = useMemo(() => {
    const execs = executionsByTicket[ticketId] ?? [];
    return execs
      .filter((e) => e.status === 'running')
      .map((e) => {
        const persona = personas.find((p) => p.id === e.personaId);
        return { name: persona?.displayName || persona?.name || 'Agent', executionId: e.id };
      });
  }, [executionsByTicket, ticketId, personas]);

  const waitingAgents = useMemo(() => {
    return mentions
      .filter((m) => m.status === 'waiting_for_info' && m.targetType === 'agent')
      .map((m) => {
        const persona = personas.find((p) => p.name === m.targetAgent);
        return { name: persona?.displayName || persona?.name || m.targetAgent, mentionId: m.id, mode: m.executionMode };
      });
  }, [mentions, personas]);

  const gateCards = useMemo(
    () => selectGateCards(workflowRuns, workflowDetail, executionsByTicket[ticketId] ?? [], deliverables),
    [workflowRuns, workflowDetail, executionsByTicket, ticketId, deliverables],
  );
  const waitingInputCards = useMemo(
    () => selectWaitingInputCards(workflowRuns, workflowDetail),
    [workflowRuns, workflowDetail],
  );
  const ambiguousRoutingCards = useMemo(
    () => selectAmbiguousRoutingCards(workflowRuns, workflowDetail),
    [workflowRuns, workflowDetail],
  );
  const failedStepCards = useMemo(
    () => selectFailedStepCards(workflowRuns, workflowDetail),
    [workflowRuns, workflowDetail],
  );
  const crashedMentionCards = useMemo(
    () => selectCrashedMentionCards(mentions, failures),
    [mentions, failures],
  );

  const latestExecutionByMention = useMemo(() => {
    const map: Record<string, string> = {};
    const execs = executionsByTicket[ticketId] ?? [];
    for (const e of execs) {
      const prev = map[e.mentionId];
      if (!prev) { map[e.mentionId] = e.id; continue; }
      const prevExec = execs.find((x) => x.id === prev);
      if (prevExec && new Date(e.startedAt).getTime() >= new Date(prevExec.startedAt).getTime()) {
        map[e.mentionId] = e.id;
      }
    }
    return map;
  }, [executionsByTicket, ticketId]);

  const handleRelaunchCrash = useCallback(async (mentionId: string) => {
    setRelaunching((prev) => ({ ...prev, [mentionId]: true }));
    try {
      await api.runMention(mentionId);
    } catch (err) {
      useToastStore.getState().addToast('error', `Échec du relancement : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRelaunching((prev) => {
        const { [mentionId]: _drop, ...rest } = prev;
        return rest;
      });
    }
  }, []);

  const hasAnyCard =
    (showRunningBanner && runningAgents.length > 0) ||
    waitingAgents.length > 0 ||
    gateCards.length > 0 ||
    waitingInputCards.length > 0 ||
    ambiguousRoutingCards.length > 0 ||
    crashedMentionCards.length > 0 ||
    failedStepCards.length > 0;
  if (!hasAnyCard) return null;

  return (
    <div>
      {showRunningBanner && runningAgents.map((agent) => (
        <button
          key={agent.executionId}
          className="flex w-full items-center gap-2 rounded px-1 py-3 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
          onClick={() => onOpenExecution(agent.executionId, `${agent.name} execution`)}
        >
          <span className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${tintClasses('purple').solid}`} />
          </span>
          <span className={`text-xs ${tintClasses('purple').text}`}>{agent.name} is working…</span>
          <svg className="h-3 w-3 text-[var(--theme-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      ))}
      {waitingAgents.map((agent) => (
        <div key={agent.mentionId} className="flex w-full items-center gap-2 px-1 py-3">
          <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${tintClasses('orange').solid}`} />
          <span className={`text-xs ${tintClasses('orange').text}`}>{agent.name} is waiting for your reply…</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tint('orange')}`}>{agent.mode}</span>
        </div>
      ))}
      {/* Inline Human Gate — approve/reject without leaving the stream. */}
      {gateCards.map(({ run, step, stepRun, outcomes, reviewDeliverables }) => (
        <div key={stepRun.id} className="my-3 rounded-lg border border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-base leading-none">🚪</span>
            <div className="text-xs font-semibold text-[var(--theme-text-primary)]">
              Human Gate — {run.templateSnapshot.emoji} {run.templateSnapshot.name}
              <span className="font-normal text-[var(--theme-text-muted)]"> › {step.name}</span>
            </div>
          </div>
          {reviewDeliverables.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">To review</div>
              <div className="flex flex-wrap gap-1.5">
                {reviewDeliverables.map((d) => (
                  <DeliverableChip key={d.id} deliverable={d} onOpen={handleOpenDeliverable} />
                ))}
              </div>
            </div>
          )}
          {outcomes.length > 0 ? (
            <HumanGateResolvePanel
              runId={run.id}
              stepRunId={stepRun.id}
              outcomes={outcomes}
              onResolve={(outcome, notes) => resolveGate(run.id, stepRun.id, outcome, notes)}
            />
          ) : (
            <div className="text-xs text-[var(--theme-text-muted)]">
              No outcomes configured — resolve this gate from the Workflow tab.
            </div>
          )}
        </div>
      ))}
      {/* "Waiting for your input" — reply + retry a paused, non-gate step. */}
      {waitingInputCards.map(({ run, step, stepRun }) => (
        <div key={stepRun.id} className={`my-3 rounded-lg border ${tintClasses('orange').borderColor} ${tintClasses('orange').bg} p-3`}>
          <div className="mb-3 flex items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full animate-pulse ${tintClasses('orange').solid}`} />
            <div className="text-xs font-semibold text-[var(--theme-text-primary)]">
              {run.templateSnapshot.emoji} {run.templateSnapshot.name}
              <span className="font-normal text-[var(--theme-text-muted)]"> › {step.name}</span>
              <span className={`ml-1 font-normal ${tintClasses('orange').text}`}>is waiting for your reply…</span>
            </div>
          </div>
          <NeedsReviewRespondPanel
            runId={run.id}
            stepRunId={stepRun.id}
            question={stepRun.output?.comment}
            onSubmit={async (response) => {
              if (run.ticketId) await api.postTicketComment(run.ticketId, response);
              await retryStep(run.id, stepRun.id, response);
            }}
          />
        </div>
      ))}
      {/* "Which branch?" — arbitrate an ambiguous route. */}
      {ambiguousRoutingCards.map(({ run, step, stepRun, candidates }) => (
        <div key={stepRun.id} className="my-3 rounded-lg border border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-base leading-none">🔀</span>
            <div className="text-xs font-semibold text-[var(--theme-text-primary)]">
              Ambiguous routing — {run.templateSnapshot.emoji} {run.templateSnapshot.name}
              <span className="font-normal text-[var(--theme-text-muted)]"> › {step.name}</span>
            </div>
          </div>
          <AmbiguousRouteResolvePanel
            runId={run.id}
            stepRunId={stepRun.id}
            candidates={candidates}
            steps={run.templateSnapshot.steps}
            onResolve={(edgeId, notes) => resolveRoute(run.id, stepRun.id, edgeId, notes)}
          />
        </div>
      ))}
      {/* "The last session crashed — relaunch?" */}
      {crashedMentionCards.map(({ mention, reason, message }) => {
        const persona = personas.find((p) => p.name === mention.targetAgent);
        const agentName = persona?.displayName || persona?.name || mention.targetAgent;
        const execId = latestExecutionByMention[mention.id];
        const isRelaunching = !!relaunching[mention.id];
        return (
          <div key={mention.id} className={`my-3 rounded-lg border ${tintClasses('red').borderColor} ${tintClasses('red').bg} p-3`}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${tintClasses('red').solid}`} />
              <div className="text-xs font-semibold text-[var(--theme-text-primary)]">
                {agentName}
                <span className={`ml-1 font-normal ${tintClasses('red').text}`}>
                  — la dernière session a crashé ({crashReasonLabel(reason)})
                </span>
              </div>
            </div>
            <p className="mb-3 text-xs leading-snug text-[var(--theme-text-secondary)]">{message}</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={isRelaunching} onClick={() => handleRelaunchCrash(mention.id)}>
                {isRelaunching ? 'Relance…' : 'Relancer'}
              </Button>
              {execId && (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--theme-text-muted)] underline-offset-2 hover:text-[var(--theme-accent)] hover:underline"
                  onClick={() => onOpenExecution(execId, `${agentName} execution`)}
                >
                  Voir les logs
                </button>
              )}
            </div>
          </div>
        );
      })}
      {/* "A workflow step failed — retry?" */}
      {failedStepCards.map(({ run, step, stepRun }) => (
        <div key={stepRun.id} className="my-3">
          <FailedStepRetryPanel
            title={`Step failed · ${run.templateSnapshot.emoji} ${run.templateSnapshot.name} › ${step.name}`}
            attempt={stepRun.attempt}
            error={(stepRun.output?.schemaFields?.error as string | undefined) ?? null}
            onRetry={() => retryStep(run.id, stepRun.id)}
            onViewLogs={
              stepRun.executionId
                ? () => onOpenExecution(stepRun.executionId!, `${step.name} execution`)
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
