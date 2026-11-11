import type { StopAuthor } from '@fleex/shared';
import type { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { ThreadStorePort } from '../ports/thread-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import type { CancelWorkflowRunUseCase } from './cancel-workflow-run.js';

/** Who stops, and why. */
export interface StopRequest {
  by: StopAuthor;
  reason?: string | null;
}

export interface StopOutcome {
  /** False when nothing was running or queued: nothing changed. */
  stopped: boolean;
  /**
   * What was stopped: `execution` = a live run was aborted · `queued` = the turn
   * was waiting for its lane and never started · `workflow_run` = the run was
   * cancelled · `nothing`.
   */
  what: 'execution' | 'queued' | 'workflow_run' | 'nothing';
  executionIds: string[];
  /** When what was stopped had started (ISO), when known. */
  startedAt: string | null;
  /** The thread the run belonged to, already parked. Null outside threads. */
  thread: AgentThreadEntity | null;
  workflowRunId?: string;
  /** Set when this target cannot be stopped from here, with the reason (never a silent no-op). */
  unsupported?: string;
}

const NOTHING: StopOutcome = { stopped: false, what: 'nothing', executionIds: [], startedAt: null, thread: null };

export interface StopRunDeps {
  executeAgent: Pick<ExecuteAgentUseCase, 'cancelExecution' | 'cancelExecutionForMention' | 'runningExecutionIdsForMention' | 'mentionOfRunningExecution'>;
  agentEventStore: Pick<AgentEventStorePort, 'getExecutionsByTicket'>;
  threadStore: ThreadStorePort;
  mentionStore: MentionStorePort;
  workflowRunStore?: WorkflowRunStorePort | null;
  stepRunStore?: StepRunStorePort | null;
  eventBus: EventBus;
  logger: LoggerPort;
}

/**
 * The one path every stop of a run goes through, with its author: the Stop
 * button, `/executions/:id/cancel`, « stop & redo », the human concluding a
 * thread (`user`), and the assistant's `stop_thread` / `interrupt` /
 * `conclude_thread` (`assistant`).
 *
 * The author is written on the execution before it is aborted. When the run
 * drives an assistant thread, the stop is a decision, not a failure: the thread
 * is parked `idle` first (so the events the abort triggers find it parked and
 * wake nobody), its failure counter does not move, and the mention is closed
 * instead of failed. A stop by the human also sets the thread's hold.
 *
 * Outside threads (the switch is off, or a plain mention) the run is stopped
 * the way it always was — mention failed, relaunchable — with the author on record.
 */
export class StopRunUseCase {
  /** Set by the container once the workflow engine exists (null: no workflow support). */
  public cancelWorkflowRun: Pick<CancelWorkflowRunUseCase, 'execute'> | null = null;

  constructor(private readonly deps: StopRunDeps) {}

  /** Stop one execution by its id (Stop button, `/executions/:id/cancel`). */
  async stopExecution(executionId: string, stop: StopRequest): Promise<StopOutcome> {
    const mentionId = this.deps.executeAgent.mentionOfRunningExecution(executionId);
    if (mentionId === undefined) return NOTHING;

    if (stop.by !== 'system') {
      const thread = mentionId
        ? await this.openThreadOfMention(mentionId)
        : await this.workflowThreadOfExecution(executionId);
      // One session of a panel is not the panel: stopping a member drops it
      // from the synthesis and the panel goes on (existing rule), so the thread
      // is not stopped. Only the author is recorded, below.
      if (thread && mentionId && thread.targetType !== 'panel') return this.stopThreadRun(thread, mentionId, stop);
      if (thread && !mentionId) {
        // A step of the thread's workflow: the run goes on or fails on its own,
        // but whatever it does next is the consequence of a wanted stop.
        await this.park(thread, stop);
        const cancelled = await this.deps.executeAgent.cancelExecution(executionId, stop);
        return { stopped: cancelled, what: cancelled ? 'execution' : 'nothing', executionIds: cancelled ? [executionId] : [], startedAt: null, thread };
      }
    }
    const cancelled = await this.deps.executeAgent.cancelExecution(executionId, stop);
    return { stopped: cancelled, what: cancelled ? 'execution' : 'nothing', executionIds: cancelled ? [executionId] : [], startedAt: null, thread: null };
  }

  /** Stop whatever runs for a mention (« stop & redo »). The caller settles a mention outside threads. */
  async stopMention(mentionId: string, stop: StopRequest): Promise<StopOutcome> {
    const thread = stop.by === 'system' ? null : await this.openThreadOfMention(mentionId);
    if (thread) return this.stopThreadRun(thread, mentionId, stop);
    const executionIds = this.deps.executeAgent.runningExecutionIdsForMention(mentionId);
    const cancelled = await this.deps.executeAgent.cancelExecutionForMention(mentionId, stop);
    return { stopped: cancelled, what: cancelled ? 'execution' : 'nothing', executionIds: cancelled ? executionIds : [], startedAt: null, thread: null };
  }

  /** Stop the current run of a thread, whatever its target, leaving the thread open. */
  async stopThread(thread: AgentThreadEntity, stop: StopRequest & { by: 'user' | 'assistant' }): Promise<StopOutcome> {
    if (thread.isTerminal) return { ...NOTHING, thread };
    if (thread.targetType === 'workflow') {
      const run = await this.workflowRunOf(thread);
      if (!run || !run.isActive()) return { ...NOTHING, thread };
      if (!this.cancelWorkflowRun) {
        return { ...NOTHING, thread, unsupported: "le moteur de workflows n'est pas disponible sur ce stockage : le run ne peut pas être annulé d'ici" };
      }
      // Parked first: the `workflow.run_cancelled` event must find the stop recorded.
      await this.park(thread, stop);
      await this.cancelWorkflowRun.execute(run.id, stop);
      return { stopped: true, what: 'workflow_run', executionIds: [], startedAt: run.startedAt.toISOString(), thread, workflowRunId: run.id };
    }
    if (!thread.currentMentionId) return { ...NOTHING, thread };
    return this.stopThreadRun(thread, thread.currentMentionId, stop);
  }

  /** A persona, skill or panel thread: abort every session of the mention, close the mention, park the thread. */
  private async stopThreadRun(thread: AgentThreadEntity, mentionId: string, stop: StopRequest): Promise<StopOutcome> {
    const by = stop.by === 'user' ? 'user' : 'assistant';
    const executionIds = this.deps.executeAgent.runningExecutionIdsForMention(mentionId);
    const mention = await this.deps.mentionStore.getById(mentionId);
    // No live session here, but the turn is still owed a run: it is queued behind
    // its lane (or was running in a process that is gone). Closing it is the stop.
    const queued = executionIds.length === 0 && !!mention && (mention.status === 'pending' || mention.status === 'acknowledged');
    if (executionIds.length === 0 && !queued) return { ...NOTHING, thread };

    const startedAt = executionIds.length > 0 ? await this.startedAt(thread.ticketId, executionIds) : null;

    // 1. The thread, before anything is aborted: every event below finds it parked.
    await this.park(thread, { by, reason: stop.reason });
    // 2. The sessions. `keepMention`: not a failure, the mention is closed just below.
    await this.deps.executeAgent.cancelExecutionForMention(mentionId, { by, reason: stop.reason, keepMention: true });
    // 3. The mention: closed, so it frees its lane and is never picked up again.
    const current = await this.deps.mentionStore.getById(mentionId);
    if (current && current.status !== 'resolved') {
      current.resolve();
      await this.deps.mentionStore.save(current);
      this.deps.eventBus.emit({
        type: 'mention.resolved', mentionId, ticketId: current.ticketId, targetAgent: current.targetAgent,
        resolvedBy: by, occurredAt: new Date(),
      });
    }
    this.deps.logger.info('Thread run stopped', { threadId: thread.id, mentionId, by, executionIds });
    return { stopped: true, what: executionIds.length > 0 ? 'execution' : 'queued', executionIds, startedAt, thread };
  }

  private async park(thread: AgentThreadEntity, stop: StopRequest): Promise<void> {
    if (!thread.recordStop(stop.by === 'user' ? 'user' : 'assistant', stop.reason ?? null)) return;
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
  }

  private async openThreadOfMention(mentionId: string): Promise<AgentThreadEntity | null> {
    const thread = await this.deps.threadStore.getByCurrentMentionId(mentionId);
    return thread && !thread.isTerminal ? thread : null;
  }

  /** The run a workflow thread's current turn started (`triggeredFrom: mention:<id>`). */
  private async workflowRunOf(thread: AgentThreadEntity): Promise<WorkflowRunEntity | null> {
    if (!thread.currentMentionId || !this.deps.workflowRunStore) return null;
    const from = `mention:${thread.currentMentionId}`;
    return (await this.deps.workflowRunStore.getByTicket(thread.ticketId)).find((r) => r.triggeredFrom === from) ?? null;
  }

  /** The open workflow thread one of whose steps runs `executionId`, if any. */
  private async workflowThreadOfExecution(executionId: string): Promise<AgentThreadEntity | null> {
    if (!this.deps.workflowRunStore || !this.deps.stepRunStore) return null;
    for (const thread of await this.deps.threadStore.getOpen()) {
      if (thread.targetType !== 'workflow') continue;
      const run = await this.workflowRunOf(thread);
      if (!run) continue;
      const steps = await this.deps.stepRunStore.getByWorkflowRun(run.id);
      if (steps.some((s) => s.executionId === executionId)) return thread;
    }
    return null;
  }

  private async startedAt(ticketId: string, executionIds: string[]): Promise<string | null> {
    try {
      const ids = new Set(executionIds);
      const starts = (await this.deps.agentEventStore.getExecutionsByTicket(ticketId)).filter((e) => ids.has(e.id)).map((e) => e.startedAt).sort();
      return starts[0] ?? null;
    } catch {
      return null; // The duration is a courtesy of the tool result, never a reason to fail a stop.
    }
  }
}
