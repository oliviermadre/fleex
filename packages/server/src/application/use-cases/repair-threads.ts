import { DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES, MS_IN_MINUTE, type AgentExecution } from '@fleex/shared';
import type { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { ThreadStorePort } from '../ports/thread-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import type { RunAssistantTurnUseCase } from './run-assistant-turn.js';
import type { StopRunUseCase } from './stop-run.js';

/** How often the surveillance looks at the threads with a run in flight. */
export const THREAD_REPAIR_INTERVAL_MS = 60_000;

/**
 * Silence tolerated on top of the execution timeout before a run is called
 * stalled. A live run is aborted by its own timer at the timeout and fails
 * through the normal path: the margin lets that path finish first, so the same
 * end of run is never reported twice.
 */
export const STALL_GRACE_MS = 2 * MS_IN_MINUTE;

export interface RepairThreadsDeps {
  threadStore: Pick<ThreadStorePort, 'getById' | 'getOpen' | 'save'>;
  mentionStore: Pick<MentionStorePort, 'getById' | 'getByTicket' | 'save'>;
  commentStore: Pick<CommentStorePort, 'getById'>;
  ticketStore: Pick<TicketStorePort, 'getTicketById' | 'saveTicket'>;
  agentEventStore: Pick<AgentEventStorePort, 'getExecutionsByTicket'>;
  executeAgent: Pick<ExecuteAgentUseCase, 'execute' | 'isMentionQueued'>;
  runAssistantTurn: Pick<RunAssistantTurnUseCase, 'execute' | 'workflowRunOf'>;
  stopRun: Pick<StopRunUseCase, 'stopStalled'>;
  /** Null: no workflow support on this storage. */
  stepRunStore?: Pick<StepRunStorePort, 'getByWorkflowRun'> | null;
  config: ConfigPort;
  eventBus: EventBus;
  logger: LoggerPort;
  /** Injected clock (tests). */
  now?: () => Date;
}

/**
 * Puts a thread left `running` back in step with what actually runs. One
 * implementation, two callers: `GET /tickets/:id/threads` (the panel opening)
 * and the periodic surveillance (`ThreadRepairScheduler`), which makes the
 * repair independent of any interface being open.
 *
 * Two kinds of stuck thread:
 *  - its mention or workflow run already settled and the event was missed:
 *    the thread takes the state it should have, and the wake-up is replayed;
 *  - nothing settled, but the run gave no sign of life beyond the execution
 *    timeout: the run is ended as a failure with its cause (`stopStalled`),
 *    which fails the thread and wakes the assistant — once, since the thread
 *    is no longer `running` afterwards.
 *
 * It never relaunches a target and never touches a thread under the human's
 * hold. A wake-up it replays is a wake-up like any other: `RunAssistantTurn`
 * applies the same rules to it (no hold lifted, only concluding on a closed ticket).
 */
export class RepairThreadsUseCase {
  constructor(private readonly deps: RepairThreadsDeps) {}

  /** The periodic pass: every thread with a run in flight, across tickets. Returns how many were looked at. */
  async repairOpen(): Promise<number> {
    const running = (await this.deps.threadStore.getOpen()).filter((t) => t.status === 'running');
    await this.repair(running);
    return running.length;
  }

  /** Repairs the given threads in place and returns them. One thread failing never stops the others. */
  async repair(threads: AgentThreadEntity[]): Promise<AgentThreadEntity[]> {
    for (const t of threads) {
      try {
        await this.repairOne(t);
      } catch (err) {
        this.deps.logger.error('Thread repair failed', { threadId: t.id, ticketId: t.ticketId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return threads;
  }

  private async repairOne(t: AgentThreadEntity): Promise<void> {
    if (t.status !== 'running' || !t.currentMentionId) return;
    // The human stopped this thread: whatever its run looks like, it is theirs
    // to put back to work. Nothing is moved, nobody is woken.
    if (t.userHoldAt) return;

    if (t.targetType === 'workflow') {
      // Its mention settles at run start: the run says where the thread is.
      const run = await this.deps.runAssistantTurn.workflowRunOf(t);
      if (run && !run.isActive()) {
        if (!(await this.stillStuck(t))) return;
        // Cancelled by the human or the assistant while the event was missed:
        // a wanted stop, parked like any other. Not a failure, nobody woken.
        if (run.status === 'cancelled' && (run.cancelledBy === 'user' || run.cancelledBy === 'assistant')) {
          t.recordStop(run.cancelledBy, null);
          await this.saved(t);
          return;
        }
        const done = run.status === 'completed';
        if (done) t.markIdle(); else t.fail();
        await this.saved(t);
        void this.deps.runAssistantTurn.execute({
          ticketId: t.ticketId,
          trigger: { kind: 'thread_reply', threadId: t.id, mentionStatus: done ? 'resolved' : 'failed', workflowRun: { id: run.id, status: run.status } },
        });
        return;
      }
      if (run) return this.endIfWorkflowStalled(t, run);
    }

    const m = await this.deps.mentionStore.getById(t.currentMentionId);
    if (!m) return;
    if (m.status === 'pending' || m.status === 'acknowledged') {
      // The stale-lane problem is the agent queue's.
      if (m.status === 'pending' && t.targetType === 'agent' && (await this.freeStaleLane(t, m))) return;
      return this.endIfMentionStalled(t, m);
    }
    if (t.targetType === 'workflow' && m.status !== 'failed') return;
    let wake: 'resolved' | 'failed' | null = null;
    if (m.status !== 'resolved' && m.status !== 'failed' && m.status !== 'waiting_for_info') return;
    if (!(await this.stillStuck(t))) return;
    if (m.status === 'resolved') { t.markIdle(); wake = 'resolved'; }
    else if (m.status === 'failed') { t.fail(); wake = 'failed'; }
    else t.markWaiting();
    await this.saved(t);
    // The event that should have woken the assistant was missed: replay it.
    if (wake) void this.deps.runAssistantTurn.execute({ ticketId: t.ticketId, trigger: { kind: 'thread_reply', threadId: t.id, mentionStatus: wake } });
  }

  /**
   * A new turn queued behind an older turn of the same thread still parked in
   * waiting_for_info (data from before the busy-agent guard): the older one
   * holds the (agent, ticket) lane forever. Close it so the new turn — already
   * owed its run — starts. True when a lane was freed.
   */
  private async freeStaleLane(t: AgentThreadEntity, m: TicketMentionEntity): Promise<boolean> {
    const stale = (await this.deps.mentionStore.getByTicket(t.ticketId)).filter((x) =>
      x.id !== m.id && x.targetAgent === t.personaName && x.status === 'waiting_for_info');
    let freed = false;
    for (const s of stale) {
      if ((await this.deps.commentStore.getById(s.commentId))?.threadId !== t.id) continue;
      s.resolve();
      await this.deps.mentionStore.save(s);
      this.deps.eventBus.emit({ type: 'mention.resolved', mentionId: s.id, ticketId: t.ticketId, targetAgent: s.targetAgent, resolvedBy: 'system', occurredAt: new Date() });
      freed = true;
    }
    if (!freed) return false;
    // The stale turn had blocked the ticket (waiting_for_info); nothing waits any more.
    const ticket = await this.deps.ticketStore.getTicketById(t.ticketId);
    if (ticket?.blocked) {
      ticket.update({ blocked: false });
      await this.deps.ticketStore.saveTicket(ticket);
      this.deps.eventBus.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: { blocked: { from: true, to: false } }, occurredAt: new Date() });
    }
    this.deps.executeAgent.execute(t.personaId).catch(() => {});
    return true;
  }

  /**
   * Agent, skill, panel: the execution(s) of the thread's current mention. The
   * last sign of life is the latest event of any of them — or, when none ever
   * started, the moment the thread was put to work.
   */
  private async endIfMentionStalled(t: AgentThreadEntity, m: TicketMentionEntity): Promise<void> {
    if (!this.surveillanceEnabled) return;
    const executions = (await this.deps.agentEventStore.getExecutionsByTicket(t.ticketId)).filter((e) => e.mentionId === m.id);
    // Owed a run by this process and still waiting for its lane or an SDK slot:
    // queued, not stalled, however long the queue is.
    if (!executions.some((e) => e.status === 'running') && this.deps.executeAgent.isMentionQueued(m.id)) return;
    const silentMs = this.silence([t.updatedAt, m.createdAt], executions);
    if (silentMs === null) return;
    if (!(await this.stillStuck(t))) return;
    await this.deps.stopRun.stopStalled(t, stallMessage(silentMs, this.timeoutMs, executions.length > 0
      ? "le run ne répondait plus, le serveur l'a clos"
      : "le tour n'a jamais démarré, le serveur l'a clos"));
  }

  /**
   * Workflow: the run and its steps. A run parked on a human decision is not
   * stalled, however long the human takes — only a run that claims to be
   * executing is watched, through its own moves and its steps' executions.
   */
  private async endIfWorkflowStalled(t: AgentThreadEntity, run: WorkflowRunEntity): Promise<void> {
    if (!this.surveillanceEnabled || run.status !== 'running') return;
    const steps = (await this.deps.stepRunStore?.getByWorkflowRun(run.id)) ?? [];
    if (steps.some((s) => s.status === 'needs_review' || s.status === 'awaiting_routing')) return;
    const executionIds = new Set(steps.map((s) => s.executionId).filter((id): id is string => !!id));
    const executions = executionIds.size > 0
      ? (await this.deps.agentEventStore.getExecutionsByTicket(t.ticketId)).filter((e) => executionIds.has(e.id))
      : [];
    const silentMs = this.silence([t.updatedAt, run.startedAt, run.updatedAt, ...steps.flatMap((s) => [s.startedAt, s.completedAt])], executions);
    if (silentMs === null) return;
    if (!(await this.stillStuck(t))) return;
    await this.deps.stopRun.stopStalled(t, stallMessage(silentMs, this.timeoutMs, "le run du workflow ne progressait plus, le serveur l'a annulé"));
  }

  /** How long nothing happened, when that is beyond the timeout and its margin; null otherwise. */
  private silence(moments: Array<Date | null | undefined>, executions: AgentExecution[]): number | null {
    const stamps = [
      ...moments.map((d) => d?.getTime() ?? 0),
      ...executions.flatMap((e) => [e.startedAt, e.lastEventAt, e.completedAt]).map((iso) => (iso ? new Date(iso).getTime() : 0)),
    ].filter((n) => Number.isFinite(n));
    const silentMs = (this.deps.now?.() ?? new Date()).getTime() - Math.max(0, ...stamps);
    return silentMs > this.timeoutMs + STALL_GRACE_MS ? silentMs : null;
  }

  /** Same setting, same default, as the timer that aborts a live execution. */
  private get timeoutMs(): number {
    return this.deps.config.get().agentExecutionTimeout ?? DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES * MS_IN_MINUTE;
  }

  /**
   * Ending a silent run is new behaviour: behind the `workThreadsEnabled`
   * switch, read on every call. Off, the route keeps the read-repair it had.
   */
  private get surveillanceEnabled(): boolean {
    return this.deps.config.get().workThreadsEnabled === true;
  }

  /**
   * Read again just before acting: the event this repair makes up for may have
   * been handled by the listener since the thread was loaded (or the human may
   * have stopped the run), and acting twice would wake the assistant twice.
   */
  private async stillStuck(t: AgentThreadEntity): Promise<boolean> {
    const fresh = await this.deps.threadStore.getById(t.id);
    return !!fresh && fresh.status === 'running' && fresh.currentMentionId === t.currentMentionId && !fresh.userHoldAt;
  }

  private async saved(t: AgentThreadEntity): Promise<void> {
    await this.deps.threadStore.save(t);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: t.id, ticketId: t.ticketId, occurredAt: new Date() });
  }
}

/** The cause the assistant (and the failed run's card) reads. */
function stallMessage(silentMs: number, timeoutMs: number, what: string): string {
  return `Aucun événement d'exécution depuis ${Math.round(silentMs / MS_IN_MINUTE)} min (délai d'exécution configuré : ${Math.round(timeoutMs / MS_IN_MINUTE)} min) : ${what}.`;
}
