import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentExecutionResult, AgentEventType, AgentStructuredOutput, MentionExecutionMode, EffortLevel, RunSubject, ContextInjectionItem, MemorySnippetRef } from '@fleex/shared';
import { inferModelCapabilities, resolveEffortLevel, parseRepoRef } from '@fleex/shared';
import { AgentPersonaNotFoundError, ExecutionCancelledError } from '../../domain/errors.js';
import type { CancelExecutionPort } from '../ports/cancel-execution.port.js';
import type { ExecutionRegistryPort, ExecutionRegistryEntry } from '../ports/execution-registry.port.js';
import { buildTicketBranchName, buildTicketWorkspaceId } from '../../domain/services/branch-utils.js';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import { parseAgentOutput } from '../utils/parse-agent-output.js';
import { buildSdkOptions, effectiveMaxTurns } from '../utils/build-sdk-options.js';
import { streamSdkQuery, summarizeStderr, type StreamSdkQueryResult } from '../utils/stream-sdk-query.js';
import { buildExecutionStartData } from '../utils/build-execution-start-data.js';
import { PromptComposer, buildExecutionContextData, promptTextLength } from '../utils/prompt-composer.js';
import { classifyCrash, CRASH_MESSAGES } from '../utils/classify-crash.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { ResolveMentionUseCase } from './resolve-mention.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { AutoReviewWorkflowUseCase } from './auto-review-workflow.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { FileMetaStorePort } from '../ports/file-meta-store.port.js';
import type { FileStorePort } from '../ports/file-store.port.js';
import type { EventBus } from '../event-bus.js';
import type { SdkConcurrencyLimiter } from '../services/sdk-concurrency-limiter.js';
import type { BareCloneManager } from '../services/bare-clone-manager.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import { resolveFileReferences, promptHasImageAttachment, type PromptContentBlock } from '../utils/resolve-file-references.js';
import { STANDARD_OUTPUT_SCHEMA as OUTPUT_FORMAT_SCHEMA, buildStandardOutputSchema } from '../utils/merge-output-schemas.js';
import { normalizeDeliverableTypes } from '@fleex/shared';
import type { DeliverableTypeDef } from '@fleex/shared';

/**
 * A composed user prompt together with the manifest of what went into it. The
 * two travel as one value so an emit site cannot report a prompt without also
 * being able to report its provenance.
 */
interface ComposedPrompt {
  blocks: PromptContentBlock[];
  manifest: ContextInjectionItem[];
}

/** Human-readable origin of a retrieved memory snippet, for the Context tab. */
function memorySnippetProvenance(snippet: MemorySnippetRef): string {
  const parts: string[] = [snippet.sourceKind.replace(/_/g, ' ')];
  if (snippet.repo) parts.push(snippet.repo);
  if (snippet.updatedAt) parts.push(snippet.updatedAt.slice(0, 10));
  return parts.join(' — ');
}

/**
 * Map a memory source kind onto the entity the UI can open. Kinds with no
 * openable counterpart (an execution trace, a Q&A pair) return undefined, which
 * renders the card inert rather than as a dead link.
 */
function memorySnippetSourceKind(sourceKind: string): ContextInjectionItem['sourceKind'] {
  switch (sourceKind) {
    case 'ticket':
    case 'ticket_summary':
    case 'comment_thread':
      return 'ticket';
    case 'deliverable':
    case 'cli_session_summary':
      return 'deliverable';
    case 'scratchpad':
      return 'scratchpad';
    case 'persona':
      return 'persona';
    case 'skill':
      return 'skill';
    case 'epic':
      return 'epic';
    default:
      return undefined;
  }
}

interface ActiveExecution {
  mentionId: string;
  executionId: string;
  personaId: string;
  ticketId?: string | null;
  status: 'running' | 'completed' | 'failed';
  abortController: AbortController;
}

interface QueueItem {
  persona: AgentPersonaEntity;
  mention: TicketMentionEntity;
}

/**
 * Build the structured-output instructions, enumerating the workspace's
 * configured (agent-selectable) deliverable types with their descriptions.
 */
function buildStructuredOutputInstructions(types: DeliverableTypeDef[]): string {
  const selectable = types.filter((t) => !t.system);
  const fallback = selectable.some((t) => t.id === 'report') ? 'report' : (selectable[0]?.id ?? 'report');
  const typeLines = selectable
    .map((t) => {
      const htmlNote = t.renderer === 'html' ? ' (rendered as a standalone HTML page)' : '';
      return `  - \`"${t.id}"\` — ${t.description}${htmlNote}`;
    })
    .join('\n');
  const htmlTypeIds = selectable.filter((t) => t.renderer === 'html').map((t) => `\`"${t.id}"\``);
  const htmlRule = htmlTypeIds.length > 0
    ? `\n- **HTML-rendered types** (${htmlTypeIds.join(', ')}): the \`markdown\` field MUST contain a single, complete, self-contained raw HTML document starting with \`<!DOCTYPE html>\`. Do **NOT** wrap it in a markdown code fence (no \`\`\`html … \`\`\`) — the content is embedded directly into an iframe, so any fence markers would render literally.`
    : '';
  return `
# Output Format

Your final response will be structured as JSON with two fields:

- **deliverable**: Use when you have a tangible work product (code, analysis, document, PRD, etc.).
  Provide a short descriptive title, the full content (markdown — or, for HTML-rendered types, a
  raw HTML document), a type, and a status. Set to null if there is nothing to deliver.
- **deliverable.type**: Classify the deliverable. Must be one of:
${typeLines}
  Choose the type that best matches your output. When in doubt, use \`"${fallback}"\`.${htmlRule}
- **deliverable.status**: Set to "draft" if your work has open questions, uncertainties, or
  needs human review before being acted upon. Set to "final" when the work is complete and
  ready for downstream consumption.
- **comment**: Use when you want to communicate in the ticket thread (status updates, questions,
  requesting another agent via \`@agent:name\`). Set to null if you have nothing to say.
- Put \`@agent:name\` mentions **only** in comment, never in deliverable.
- **mentionStatus**: Controls what happens to your mention after you finish.
  - \`"resolved"\` (default): your work is done, the mention is closed.
  - \`"waiting_for_info"\`: you need more information before you can finish. You will be
    automatically resumed when new content (comments, deliverables) is added to the ticket.
    The \`comment\` field is REQUIRED and IS the literal message the human sees — there is
    no separate question channel and no out-of-band tool to ask. Write the actual question(s)
    directly, as if chatting with the human ("Which Supabase project should I use?",
    "Should the bundle target Apple silicon only?"). Do NOT write a status report about
    having asked (e.g. "I posed a question to @nas", "Awaiting reply from X") — the system
    does not post any separate question; only what you write in \`comment\` reaches the reader.
- Both deliverable and comment can be non-null, or both null (silent completion — only valid with "resolved").

## CRITICAL — Handoff Rules (ENFORCED BY THE SYSTEM)

1. **NEVER mention another agent** (\`@agent:...\`) **when your deliverable is "draft"** or when
   you have open questions/uncertainties. The system will automatically strip any \`@agent:\`
   mentions from your comment if the deliverable status is "draft". Instead, mention the human
   operator to get answers first.
2. **Only mention another agent** (\`@agent:...\`) **when your deliverable is "final"** and your
   work is fully complete with no open questions.
3. When you need human input, decisions, or answers: mention the human operator using
   the exact tag provided below (NOT a display name or guess).
`.trim();
}

export class ExecuteAgentUseCase implements CancelExecutionPort, ExecutionRegistryPort {
  private activeExecutions = new Map<string, ActiveExecution>();
  private sessionHistory = new Map<string, string>(); // `${agentName}:${ticketId}` -> sdkSessionId
  private queue: QueueItem[] = [];
  // `${agentName}:${ticketId}` currently dispatched (parked on the limiter OR
  // actively running). Covers the dispatch→acknowledge window where the DB does
  // not yet reflect the running mention. The authoritative serialization gate is
  // `hasActiveThread` (reads the DB), so a `waiting_for_info` mention keeps the
  // lane closed even after this in-memory key is freed at settle.
  private occupiedAgentTickets = new Set<string>();
  // Drain loop re-entrancy guard: `drainQueue` is a sync kick; the actual work
  // runs in `drainLoop`, which coalesces concurrent kicks (the gate is async).
  private draining = false;
  private drainPending = false;
  // Mention ids that have entered the pipeline (queued OR dispatched). Claimed
  // synchronously at enqueue/wake so a racing `execute()`/`wakeUp` cannot enqueue
  // the same mention twice (kills duplicate executions). Released at settle.
  private claimedMentionIds = new Set<string>();
  // Mention ids that are running because they were genuinely woken from
  // `waiting_for_info` (via `wakeUp`). Drives the `isWakeUp` prompt wording:
  // ONLY a real resume gets the "continue your waiting work" prompt. A fresh
  // queued mention (which happens to reuse the same session) must get the
  // "respond to your comment" prompt so its own request is surfaced. Consumed
  // (deleted) at the top of `executeForMention`.
  private wokenMentionIds = new Set<string>();

  /** Set by WS plugin to broadcast agent events in real-time */
  public onEvent: ((event: AgentEventEntity) => void) | null = null;

  /** Set by WS plugin to broadcast execution completion */
  public onExecutionComplete: ((personaId: string, status: 'completed' | 'failed', mentionId: string) => void) | null = null;

  /** Set by container after construction (avoids circular dep) */
  public eventBus: EventBus | null = null;

  /** Set by container — bare-clone infrastructure */
  public bareCloneManager: BareCloneManager | null = null;
  public resolver: RepoPathResolver | null = null;

  /** Set by container — enables resolving file attachments in agent prompts */
  public fileMetaStore: FileMetaStorePort | null = null;
  public fileStore: FileStorePort | null = null;

  constructor(
    private readonly personaStore: PersonaStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly postComment: PostCommentUseCase,
    private readonly resolveMention: ResolveMentionUseCase,
    private readonly submitDeliverable: SubmitDeliverableUseCase,
    private readonly getTicketContext: GetTicketContextUseCase,
    private readonly agentEventStore: AgentEventStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly createWorktree: CreateWorktreeUseCase,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
    private readonly autoReviewWorkflow: AutoReviewWorkflowUseCase,
    private readonly sdkLimiter: SdkConcurrencyLimiter,
    private readonly skillStore?: SkillStorePort,
  ) {}

  /** Workspace-configured deliverable types (normalized; system types included). */
  private deliverableTypeDefs(): DeliverableTypeDef[] {
    return normalizeDeliverableTypes(this.config.get().deliverableTypes);
  }

  /** Type ids agents may select (system types excluded). */
  private agentSelectableTypeIds(): string[] {
    return this.deliverableTypeDefs().filter((t) => !t.system).map((t) => t.id);
  }

  /** Structured-output JSON schema constrained to the configured selectable types. */
  private outputFormatSchema(): typeof OUTPUT_FORMAT_SCHEMA {
    return buildStandardOutputSchema(this.agentSelectableTypeIds());
  }

  /**
   * Startup recovery: mark orphaned executions as interrupted,
   * reset their mentions to pending, and reload SDK session history.
   */
  async init(): Promise<void> {
    // 1. Mark all 'running' executions as 'interrupted' (orphaned from previous process)
    const interruptedMentionIds = await this.agentEventStore.markInterruptedExecutions();
    if (interruptedMentionIds.length > 0) {
      this.logger.info(`Marked ${interruptedMentionIds.length} interrupted executions`, {
        mentionIds: interruptedMentionIds,
      });

      // 2. Reset acknowledged mentions back to pending so they can be re-executed
      for (const mentionId of interruptedMentionIds) {
        try {
          const mention = await this.mentionStore.getById(mentionId);
          if (mention) {
            mention.resetToPending();
            await this.mentionStore.save(mention);
            this.logger.info('Reset mention to pending after interrupted execution', {
              mentionId,
              ticketId: mention.ticketId,
            });
          }
        } catch (err) {
          this.logger.warn('Failed to reset mention after interrupted execution', {
            mentionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 3. Reload SDK session history from DB
    const history = await this.agentEventStore.getSessionHistory();
    for (const [key, { sdkSessionId, personaId, ticketId }] of history) {
      // Key is "personaId:ticketId" — we need to convert to "personaName:ticketId"
      const persona = await this.personaStore.getById(personaId);
      if (persona) {
        const sessionKey = `${persona.name}:${ticketId}`;
        this.sessionHistory.set(sessionKey, sdkSessionId);
      }
    }

    this.logger.info('Agent execution startup recovery complete', {
      interruptedExecutions: interruptedMentionIds.length,
      restoredSessions: this.sessionHistory.size,
    });
  }

  async execute(personaId: string): Promise<AgentExecutionResult> {
    const persona = await this.personaStore.getById(personaId);
    if (!persona) {
      throw new AgentPersonaNotFoundError(personaId);
    }

    // Get pending mentions for this agent
    const pendingMentions = await this.mentionStore.getPendingForAgent(persona.name);

    // Filter out mentions already being executed or already in the pipeline.
    // `claimedMentionIds` covers BOTH queued and dispatched-but-not-yet-acked
    // mentions, closing the TOCTOU window after `getPendingForAgent` resolves
    // where a concurrent `execute()` would otherwise re-enqueue the same mention.
    const workableMentions = pendingMentions.filter(
      (m) => !this.activeExecutions.has(m.id) && !this.claimedMentionIds.has(m.id),
    );

    if (workableMentions.length === 0) {
      return { status: 'no_work', mentionIds: [] };
    }

    // Enqueue all workable mentions. Claim each id SYNCHRONOUSLY (no await
    // between the filter above and these adds) so the dedup is race-free.
    const mentionIds: string[] = [];
    for (const mention of workableMentions) {
      this.claimedMentionIds.add(mention.id);
      this.queue.push({ persona, mention });
      mentionIds.push(mention.id);
    }

    // Drain queue up to maxConcurrency
    this.drainQueue();

    return { status: 'started', mentionIds };
  }

  /**
   * Run a single mention by the per-mention ▶ button. Unlike `execute()`
   * (persona-scoped, pending-only) this is mention-scoped and also resumes a
   * mention parked in `waiting_for_info` — matching the user's expectation
   * that clicking ▶ on a waiting mention wakes it, exactly like posting a
   * follow-up comment does.
   */
  async runMention(mention: TicketMentionEntity): Promise<AgentExecutionResult> {
    // waiting_for_info → wake it up (transitions to pending and enqueues)
    if (mention.status === 'waiting_for_info') {
      await this.wakeUp(mention);
      return { status: 'started', mentionIds: [mention.id] };
    }

    // acknowledged → an execution is already in flight
    if (mention.status === 'acknowledged') {
      return { status: 'already_running', mentionIds: [] };
    }

    // resolved → nothing to run
    if (mention.status === 'resolved') {
      return { status: 'no_work', mentionIds: [] };
    }

    // failed → the user hit "Relancer" on the crash card. Reset to pending and
    // enqueue; the preserved session history lets the SDK resume where it
    // crashed. Clear the stale `failed` activeExecutions entry left by the crash
    // so the enqueue guard below doesn't reject the relaunch as already-running.
    if (mention.status === 'failed') {
      if (this.activeExecutions.has(mention.id)) this.activeExecutions.delete(mention.id);
      mention.resetToPending();
      await this.mentionStore.save(mention);
    }

    // pending → enqueue this specific mention (skip if already active/queued)
    const persona = await this.personaStore.getByName(mention.targetAgent);
    if (!persona) {
      throw new AgentPersonaNotFoundError(mention.targetAgent);
    }
    if (this.activeExecutions.has(mention.id) || this.claimedMentionIds.has(mention.id)) {
      return { status: 'already_running', mentionIds: [] };
    }
    this.claimedMentionIds.add(mention.id);
    this.queue.push({ persona, mention });
    this.drainQueue();
    return { status: 'started', mentionIds: [mention.id] };
  }

  /**
   * Wake up a mention that was in waiting_for_info state.
   * Transitions it to pending and enqueues for execution.
   */
  async wakeUp(mention: TicketMentionEntity): Promise<void> {
    // Skip only if the mention is currently running; clean up stale completed/failed entries
    const existing = this.activeExecutions.get(mention.id);
    if (existing && existing.status === 'running') return;
    if (existing) this.activeExecutions.delete(mention.id);

    // Dedup: a concurrent wake (e.g. several sibling comments posted back-to-back,
    // each firing wake-waiting-agents) already pulled this mention in. Without
    // this, the same mention would be enqueued and re-run multiple times.
    if (this.claimedMentionIds.has(mention.id)) return;
    if (this.queue.some((q) => q.mention.id === mention.id)) return;

    const persona = await this.personaStore.getByName(mention.targetAgent);
    if (!persona) {
      this.logger.warn('Cannot wake mention: persona not found', {
        mentionId: mention.id, targetAgent: mention.targetAgent,
      });
      return;
    }

    // Decide & claim SYNCHRONOUSLY (no await between the check and the claim).
    // If the lane is free, this resume owns it and dispatches directly — it must
    // bypass the queue gate, since while the woken mention is still `pending`
    // (not yet re-acknowledged) the DB gate would not block siblings, and
    // routing it through `drainOnce` would see its own just-claimed key as
    // "occupied" and never dispatch it. If a sibling already holds the lane, we
    // queue normally and the sibling's settle re-drain picks this up.
    const key = `${persona.name}:${mention.ticketId}`;
    const laneFree = !this.occupiedAgentTickets.has(key);
    this.claimedMentionIds.add(mention.id);
    // Mark this as a GENUINE resume so executeForMention uses the wake-up prompt
    // ("continue your waiting work") rather than the fresh-mention prompt.
    this.wokenMentionIds.add(mention.id);
    if (laneFree) this.occupiedAgentTickets.add(key);

    mention.wakeUp();
    await this.mentionStore.save(mention);

    this.eventBus?.emit({
      type: 'mention.woken_up',
      mentionId: mention.id,
      ticketId: mention.ticketId,
      targetAgent: mention.targetAgent,
      occurredAt: new Date(),
    });

    this.logger.info('Waking up waiting agent', {
      mentionId: mention.id, targetAgent: mention.targetAgent, ticketId: mention.ticketId,
    });

    if (laneFree) {
      this.dispatch({ persona, mention }, key);
    } else {
      this.queue.push({ persona, mention });
      this.drainQueue();
    }
  }

  getStatus(personaId: string): { running: boolean; activeMentionIds: string[] } {
    const activeMentions = Array.from(this.activeExecutions.entries())
      .filter(([, exec]) => exec.status === 'running' && exec.personaId === personaId)
      .map(([mentionId]) => mentionId);

    return {
      running: activeMentions.length > 0,
      activeMentionIds: activeMentions,
    };
  }

  /**
   * Cancel a running execution by executionId.
   * Immediately marks execution as interrupted in DB and notifies frontend,
   * then aborts the SDK query loop (which may be hung).
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    let found: { mentionId: string; exec: ActiveExecution } | null = null;
    for (const [mentionId, exec] of this.activeExecutions) {
      if (exec.executionId === executionId && exec.status === 'running') {
        found = { mentionId, exec };
        break;
      }
    }
    if (!found) return false;

    const { mentionId, exec } = found;

    // 1. Mark completed in DB immediately (don't wait for the loop to notice)
    try {
      const cancelEvent = AgentEventEntity.create({
        executionId,
        eventType: 'execution_end',
        data: { status: 'interrupted', reason: 'cancelled', ticketId: found.exec.ticketId },
        sequence: 999998,
      });
      await this.agentEventStore.appendEvent(cancelEvent);
      this.onEvent?.(cancelEvent);
      await this.agentEventStore.completeExecution(executionId, 'interrupted');
    } catch {
      // Best-effort — don't let store errors block cancel
    }

    // 2. Update in-memory state
    exec.status = 'failed';
    this.onExecutionComplete?.(exec.personaId, 'failed', mentionId);

    // 3. Reset mention to pending
    try {
      const mention = await this.mentionStore.getById(mentionId);
      if (mention) {
        mention.resetToPending();
        await this.mentionStore.save(mention);
      }
    } catch {
      // Best-effort
    }

    // 4. Abort the SDK loop (may be hung — this is best-effort to free the async generator)
    exec.abortController.abort(new Error('cancelled'));

    // 5. Audit the user-initiated cancellation (Terminate button / supersede).
    this.eventBus?.emit({
      type: 'execution.cancelled',
      executionId,
      mentionId,
      personaId: exec.personaId,
      ...(exec.ticketId ? { ticketId: exec.ticketId } : {}),
      occurredAt: new Date(),
    });

    this.logger.info('Agent execution cancelled', { executionId, mentionId });
    return true;
  }

  /**
   * Cancel whatever execution is currently running for a given mention, looked
   * up by mentionId rather than executionId. Used by the "stop & redo"
   * (supersede) flow when a user re-mentions an agent that is mid-execution.
   * Returns false (no-op) if no running execution is tracked for the mention.
   */
  async cancelExecutionForMention(mentionId: string): Promise<boolean> {
    const exec = this.activeExecutions.get(mentionId);
    if (!exec || exec.status !== 'running') return false;
    return this.cancelExecution(exec.executionId);
  }

  /**
   * ExecutionRegistryPort — register an externally-spawned execution (e.g. a
   * panel member or orchestrator) so it becomes abortable through
   * `cancelExecution`. Keyed by executionId (a UUID, so no collision with the
   * mention/skill/workflow keys). Must be called before the SDK loop starts.
   */
  registerExecution(entry: ExecutionRegistryEntry): void {
    this.activeExecutions.set(entry.executionId, {
      mentionId: entry.executionId,
      executionId: entry.executionId,
      personaId: entry.personaId,
      ...(entry.ticketId ? { ticketId: entry.ticketId } : {}),
      status: 'running',
      abortController: entry.abortController,
    });
  }

  /**
   * ExecutionRegistryPort — settle a registered execution and schedule its
   * eviction (30s grace preserves the Terminate lookup window, mirroring the
   * skill path). Idempotent: leaves an already-cancelled ('failed') entry as-is
   * so a late finalize can't resurrect it to 'running'.
   */
  finalizeExecution(executionId: string): void {
    const exec = this.activeExecutions.get(executionId);
    if (!exec) return;
    if (exec.status === 'running') exec.status = 'completed';
    setTimeout(() => {
      const e = this.activeExecutions.get(executionId);
      if (e && e.status !== 'running') this.activeExecutions.delete(executionId);
    }, 30000);
  }

  /**
   * Subscribe to lane-freeing events so a queued sibling can start once the
   * thread holding its (agent, ticket) lane closes. Crucial for EXTERNAL
   * resolves the scheduler can't observe via an execution settling: a manual UI
   * resolve of a `waiting_for_info` mention, or a mention deletion. The drain is
   * idempotent — re-evaluating the DB gate is the source of truth. The
   * scheduler also emits `mention.resolved` itself; that self-emit is a harmless
   * no-op here because the in-memory lane key is still held until `dispatch`'s
   * finally runs (so the gate keeps the sibling queued until then).
   */
  subscribeToBus(bus: EventBus): void {
    const reDrain = (): void => this.drainQueue();
    bus.on('mention.resolved', reDrain);
    bus.on('mention.deleted', reDrain);
  }

  /** Resolve human mention name: persona override → global config */
  private resolveHumanMentionName(persona: AgentPersonaEntity): string | null {
    if (persona.humanMentionName) return persona.humanMentionName;
    return this.config.get().humanMentionName ?? null;
  }

  /**
   * Serialize per (agent, ticket): at most ONE live thread for a given agent on
   * a given ticket. "Live" means an execution is running (`acknowledged`) OR a
   * mention is parked in `waiting_for_info` — a queued sibling must wait until
   * that thread reaches `resolved`. This prevents two SDK runs racing on the
   * shared worktree / forking the resume session, AND stops a sibling from
   * starting while the agent is still waiting on the human. Different tickets
   * (different worktrees) still run in parallel, throttled only by the global
   * SDK limiter.
   *
   * Public entry point: a synchronous "kick". The real work runs in `drainLoop`
   * because the dispatch gate (`hasActiveThread`) reads the DB and is async.
   */
  private drainQueue(): void {
    void this.drainLoop();
  }

  /** Coalesces concurrent kicks: at most one loop runs; a kick that arrives
   *  mid-pass schedules exactly one more pass afterwards. */
  private async drainLoop(): Promise<void> {
    if (this.draining) { this.drainPending = true; return; }
    this.draining = true;
    try {
      do {
        this.drainPending = false;
        await this.drainOnce();
      } while (this.drainPending);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    // Take a snapshot and clear the queue so items pushed during the awaits
    // below are not dropped by the reassignment at the end.
    const snapshot = this.queue;
    this.queue = [];
    const remaining: QueueItem[] = [];
    for (const item of snapshot) {
      const key = `${item.persona.name}:${item.mention.ticketId}`;
      // Gate: skip (keep queued) if the lane is occupied in-memory (covers the
      // dispatch→acknowledge window) OR the DB shows a live/parked thread for
      // this (agent, ticket). The DB read is what makes `waiting_for_info` hold
      // the lane until it resolves — no fragile "keep the key" bookkeeping.
      if (this.occupiedAgentTickets.has(key) ||
          await this.hasActiveThread(item.persona.name, item.mention.ticketId)) {
        remaining.push(item);
        continue;
      }
      this.occupiedAgentTickets.add(key); // win the lane BEFORE any further await
      this.dispatch(item, key);
    }
    // Re-prepend the still-blocked items ahead of anything enqueued mid-pass.
    this.queue = [...remaining, ...this.queue];
  }

  /**
   * True if the DB shows a live or parked thread for this (agent, ticket): a
   * mention that is `acknowledged` (running / mid-dispatch) or
   * `waiting_for_info` (parked, awaiting the human). Reading the DB makes this
   * authoritative and self-healing across restarts and manual edits.
   */
  private async hasActiveThread(agentName: string, ticketId: string): Promise<boolean> {
    const mentions = await this.mentionStore.getByTicket(ticketId);
    return mentions.some(
      (m) => m.targetAgent === agentName &&
        (m.status === 'acknowledged' || m.status === 'waiting_for_info'),
    );
  }

  /**
   * Run one mention through the SDK limiter. On settle (success, failure,
   * cancel, or superseded early-return) it frees the lane key + the claimed id
   * and re-drains so the next queued sibling can start. Shared by `drainOnce`
   * and `wakeUp` (which claims the lane itself and dispatches directly).
   */
  private dispatch(item: QueueItem, key: string): void {
    void this.sdkLimiter
      .run(() => this.executeForMention(item.persona, item.mention))
      .catch((err) => {
        // Last-resort safety net — executeForMention's own finally already
        // schedules activeExecutions cleanup. We still log so an unexpected
        // throw never disappears silently.
        this.logger.error('Agent execution failed', {
          persona: item.persona.name,
          mentionId: item.mention.id,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.occupiedAgentTickets.delete(key);
        this.claimedMentionIds.delete(item.mention.id);
        this.drainQueue();
      });
  }

  /**
   * Resolve the conversation-scoped execution config for a mention about to run.
   *
   * - mode  = min(persona ceiling, ticket.conversationMode). A `message` persona
   *   is capped at `talk`; a `claude_code` persona inherits the ticket's mode.
   * - model = ticket.modelOverride ?? persona.model.
   * - effort = ticket.effortOverride, resolved against the model: dropped if the
   *   model has no effort parameter, clamped down if it sits above the model's
   *   ceiling (e.g. `xhigh` on Sonnet 4.6 → `high`). Sending an unsupported
   *   level is a hard 400, so this gate is the only path to the SDK.
   * - fast  = ticket.fastMode, applied only if the resolved model supports it.
   *
   * The ticket may be null (deleted mid-flight) — we fall back to persona defaults
   * and `plan` mode so execution still proceeds safely.
   */
  private resolveExecutionConfig(
    persona: AgentPersonaEntity,
    ticket: TicketEntity | null,
  ): { mode: MentionExecutionMode; model: string; effort?: EffortLevel; fast: boolean } {
    const conversationMode: MentionExecutionMode = ticket?.conversationMode ?? 'plan';
    const mode: MentionExecutionMode = persona.executionMode === 'message'
      ? 'talk'
      : conversationMode;

    const model = ticket?.modelOverride ?? persona.model;
    const caps = inferModelCapabilities(model);

    const requestedEffort = ticket?.effortOverride ?? null;
    const effort = resolveEffortLevel(model, requestedEffort);
    if (requestedEffort && effort !== requestedEffort) {
      this.logger.warn('Effort override not supported by model — adjusted', {
        model,
        requested: requestedEffort,
        applied: effort ?? 'none',
        supported: caps.effortLevels,
      });
    }
    const fast = caps.supportsFastMode && (ticket?.fastMode ?? false);

    return { mode, model, effort, fast };
  }

  private async executeForMention(
    persona: AgentPersonaEntity,
    mention: TicketMentionEntity,
  ): Promise<void> {
    // Consume the "genuine wake" flag once, up front (so it never leaks, even on
    // the early-return guard below). A fresh queued mention is NOT a wake-up even
    // though it reuses the session — it must get the "respond to your comment"
    // prompt so its own request is surfaced.
    const isWakeUp = this.wokenMentionIds.delete(mention.id);

    // Guard: the queued copy may have been resolved/superseded while it waited
    // (e.g. the user posted a follow-up and chose "stop & redo", which resolves
    // the prior mention). Re-read the live status and skip stale work so we
    // never run a superseded mention or touch the worktree for nothing.
    const fresh = await this.mentionStore.getById(mention.id);
    if (!fresh || fresh.status === 'resolved') {
      this.logger.info('Skipping superseded/resolved mention', {
        mentionId: mention.id,
        targetAgent: mention.targetAgent,
      });
      return;
    }

    const executionId = randomUUID();
    const abortController = new AbortController();
    this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'running', abortController });

    const humanName = this.resolveHumanMentionName(persona);
    // Tracks whether `mention.acknowledge()` succeeded. Drives the catch
    // branch below: pre-ack failures emit a dedicated `mention.execution_failed`
    // event so the UI never silently hangs in Pending.
    let acknowledged = false;

    try {
      // 0. Resolve the conversation-scoped execution config at acknowledge time.
      // Mode is min(persona ceiling, ticket.conversationMode); model/effort/fast
      // come from the ticket overrides (capability-gated). The mention's own mode
      // is irrelevant — it is overwritten here so the UI badge reflects what ran.
      const ticket = await this.ticketStore.getTicketById(mention.ticketId);
      const resolved = this.resolveExecutionConfig(persona, ticket);
      const effectiveMode = resolved.mode;
      mention.executionMode = effectiveMode;

      // 1. Ensure workspace exists BEFORE acknowledging (skip for talk mode).
      // The workspace is created for every ticket; git worktrees are added
      // inside it only when the ticket links a repository. Edit mode runs
      // either way — tickets without a repo get an empty workspace and the
      // agent uses MCP / web / file tools.
      let worktreePath: string | null = null;
      if (effectiveMode !== 'talk') {
        worktreePath = await this.ensureWorkspace(mention.ticketId);
        if (!worktreePath) {
          // The ticket exists but workspace creation failed (FS error,
          // missing ticket, etc.). Throwing here triggers the pre-ack
          // catch below which emits `mention.execution_failed` so the UI
          // surfaces the error instead of staying Pending silently.
          throw new Error('Could not create workspace directory for ticket');
        }
      }

      // 2. Acknowledge mention
      mention.acknowledge();
      await this.mentionStore.save(mention);
      acknowledged = true;
      this.eventBus?.emit({
        type: 'mention.acknowledged',
        mentionId: mention.id,
        ticketId: mention.ticketId,
        targetAgent: mention.targetAgent,
        occurredAt: new Date(),
      });

      // 2b. Claim ticket for agent
      if (ticket && ticket.assignee !== persona.name) {
        ticket.claim(persona.name);
        await this.ticketStore.saveTicket(ticket);
        this.eventBus?.emit({
          type: 'ticket.updated',
          ticketId: ticket.id,
          changes: {},
          occurredAt: new Date(),
        });
      }

      // 3. Start execution tracking
      await this.agentEventStore.startExecution({
        executionId,
        personaId: persona.id,
        ticketId: mention.ticketId,
        mentionId: mention.id,
        model: resolved.model,
        effort: resolved.effort,
        fast: resolved.fast,
      });

      // 4. Compose system prompt from persona files
      const repoCount = ticket ? ticket.links.filter((l) => l.type === 'repository').length : 0;
      const systemPrompt = this.composeSystemPrompt(persona, humanName, worktreePath, repoCount);

      // 5. Load ticket context
      const context = await this.getTicketContext.execute({
        ticketId: mention.ticketId,
        agentName: persona.name,
      });

      // 6. Build user prompt with ticket context (content blocks for multimodal support)
      const sessionKey = `${persona.name}:${mention.ticketId}`;
      // `isWakeUp` is decided up front from `wokenMentionIds` (a genuine resume
      // from waiting_for_info), NOT from "a session exists" — a fresh queued
      // mention reuses the session but is not a wake-up.
      const { blocks: userPromptBlocks, manifest: userPromptManifest } = await this.composeUserPrompt(context, mention, isWakeUp);
      const userPromptTextLength = promptTextLength(userPromptBlocks);

      this.logger.info('Agent execution started', {
        executionId,
        persona: persona.name,
        model: resolved.model,
        effort: resolved.effort ?? null,
        fast: resolved.fast,
        ticketId: mention.ticketId,
        mentionId: mention.id,
        worktreePath,
      });

      // 7. Emit execution_start event
      let sequence = 0;
      const emitEvent = async (eventType: AgentEventType, data: unknown) => {
        const event = AgentEventEntity.create({
          executionId,
          eventType,
          data,
          sequence: sequence++,
        });
        await this.agentEventStore.appendEvent(event);
        this.onEvent?.(event);
      };

      // 8. Check for previous SDK session (resume)
      const previousSessionId = this.sessionHistory.get(sessionKey);

      // Build context window summary for observability
      const contextSections: string[] = [];
      if (persona.soulMd) contextSections.push('SOUL.md');
      if (persona.identityMd) contextSections.push('IDENTITY.md');
      if (persona.memoryMd) contextSections.push('MEMORY.md');
      contextSections.push('Structured output instructions');
      if (humanName) contextSections.push(`Human operator (@${humanName})`);
      if (worktreePath) contextSections.push(`Working directory (${worktreePath})`);

      // The turn budget this run will actually get, reported up front so the
      // Execution Log states the cap instead of leaving it to be guessed.
      const runMaxTurns = effectiveMaxTurns(effectiveMode, this.config.get().agentMaxTurns);

      await emitEvent('execution_start', buildExecutionStartData({
        executionId,
        personaId: persona.id,
        personaName: persona.name,
        ticketId: mention.ticketId,
        mentionId: mention.id,
        model: resolved.model,
        effectiveMode,
        worktreePath,
        resumeSessionId: previousSessionId ?? null,
        kind: 'persona',
        maxTurns: runMaxTurns,
        systemPromptSections: contextSections,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPromptTextLength,
        ticketTitle: context.ticket.title,
        ticketStatus: context.ticket.status,
        commentsCount: context.comments.length,
        deliverablesCount: context.deliverables.length,
      }));

      await emitEvent('execution_context', buildExecutionContextData({
        executionId,
        systemPrompt,
        promptBlocks: userPromptBlocks,
        manifest: userPromptManifest,
        model: resolved.model,
        effectiveMode,
        maxTurns: runMaxTurns,
        memoryEngine: context.memoryEngine,
      }));

      // 9. Setup execution timeout
      const timeoutMs = this.config.get().agentExecutionTimeout ?? 30 * 60 * 1000;
      const timeoutHandle = setTimeout(() => {
        this.logger.warn('Agent execution timed out', { executionId, persona: persona.name, timeoutMs });
        abortController.abort(new Error('timeout'));
      }, timeoutMs);

      // 10. Call Claude Agent SDK
      let sdkSessionId: string | undefined;
      let resultText = '';
      let structuredOutput: AgentStructuredOutput | null = null;
      let sdkDurationMs: number | undefined;
      let sdkCostUsd: number | undefined;
      let sdkInputTokens: number | undefined;
      let sdkOutputTokens: number | undefined;
      let sdkCacheReadTokens: number | undefined;
      let sdkCacheCreationTokens: number | undefined;
      let sdkNumTurns: number | undefined;
      let cliStderr = '';
      let resultSubtype: string | undefined;

      {
        const queryOptions = buildSdkOptions(effectiveMode, {
          model: resolved.model,
          systemPrompt,
          cwd: worktreePath,
          outputFormat: this.outputFormatSchema(),
          resume: previousSessionId ?? undefined,
          effort: resolved.effort,
          fast: resolved.fast,
          maxTurns: this.config.get().agentMaxTurns,
          talkCanReadImages: effectiveMode === 'talk' && promptHasImageAttachment(userPromptBlocks),
        });

        // Build the prompt: use content blocks if there are images, plain string otherwise
        const hasImages = userPromptBlocks.some((b) => b.type === 'image');
        const userPrompt = hasImages
          ? userPromptBlocks  // Will be wrapped into SDKUserMessage below
          : userPromptBlocks.map((b) => (b as { text: string }).text).join('');

        // Persist the session as soon as it exists (not only on success). If
        // this run is later aborted/superseded, the next mention on the same
        // agent+ticket can still resume from here — so "stop & redo" keeps the
        // agent's memory of what it was doing plus the correction.
        const onSessionId = (sid: string) => { this.sessionHistory.set(sessionKey, sid); };

        const runStream = (fallbackSession: string) => streamSdkQuery({
          prompt: userPrompt,
          queryOptions: queryOptions as Record<string, unknown>,
          emitEvent,
          abortSignal: abortController.signal,
          fallbackSessionId: fallbackSession,
          onSessionId,
        });

        let streamResult: StreamSdkQueryResult;
        try {
          streamResult = await runStream(previousSessionId ?? '');
        } catch (queryErr) {
          if (abortController.signal.aborted) {
            // Abort was triggered — handled below.
            streamResult = { resultText: '', structuredOutput: null, metrics: {}, messageCount: 0, stderr: '' };
          } else if (previousSessionId) {
            // Stale resume — clear session and retry fresh
            this.logger.warn('SDK query failed with resume, retrying without resume', {
              executionId,
              persona: persona.name,
              staleSessionId: previousSessionId,
              error: queryErr instanceof Error ? queryErr.message : String(queryErr),
            });
            this.sessionHistory.delete(sessionKey);
            delete queryOptions['resume'];
            await emitEvent('execution_retry', { reason: 'stale_resume_session', staleSessionId: previousSessionId });
            streamResult = await runStream(''); // If this also fails, propagates to outer catch
          } else {
            throw queryErr;
          }
        }

        sdkSessionId = streamResult.sessionId;
        resultText = streamResult.resultText;
        structuredOutput = streamResult.structuredOutput as AgentStructuredOutput | null;
        sdkDurationMs = streamResult.metrics.durationMs;
        sdkCostUsd = streamResult.metrics.costUsd;
        sdkInputTokens = streamResult.metrics.inputTokens;
        sdkOutputTokens = streamResult.metrics.outputTokens;
        sdkCacheReadTokens = streamResult.metrics.cacheReadTokens;
        sdkCacheCreationTokens = streamResult.metrics.cacheCreationTokens;
        sdkNumTurns = streamResult.metrics.numTurns;
        cliStderr = streamResult.stderr ?? '';
        resultSubtype = streamResult.resultSubtype;

        // The SDK stops with this subtype when the turn budget runs out. Say so
        // explicitly: an agent that ran out of turns produces a truncated answer
        // that otherwise looks like a normal (if unfinished) completion.
        if (streamResult.resultSubtype === 'error_max_turns') {
          this.logger.warn('SDK query hit the configured turn budget', {
            executionId,
            persona: persona.name,
            numTurns: sdkNumTurns,
            maxTurns: runMaxTurns,
          });
          await emitEvent('max_turns_reached', {
            numTurns: sdkNumTurns,
            maxTurns: runMaxTurns,
            ticketId: mention.ticketId,
          });
        }

        if (streamResult.resultSubtype === 'error_max_structured_output_retries') {
          this.logger.warn('SDK structured output retries exhausted, falling back to parser', {
            executionId,
            persona: persona.name,
          });
        }
      }

      clearTimeout(timeoutHandle);

      // Handle abort (cancel or timeout)
      if (abortController.signal.aborted) {
        // Check if cancelExecution() already did the cleanup
        const currentExec = this.activeExecutions.get(mention.id);
        if (currentExec && currentExec.status !== 'running') {
          // Already cleaned up by cancelExecution()
          return;
        }
        // Timeout path — cancelExecution didn't run, we need to do cleanup
        const reason = abortController.signal.reason instanceof Error && abortController.signal.reason.message === 'timeout'
          ? 'timeout' : 'cancelled';
        await emitEvent('execution_end', { status: 'interrupted', reason, ticketId: mention.ticketId, model: resolved.model, effectiveMode });
        await this.agentEventStore.completeExecution(executionId, 'interrupted', { model: resolved.model, effectiveMode, effort: resolved.effort, fast: resolved.fast });
        this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'failed', abortController });
        mention.resetToPending();
        await this.mentionStore.save(mention);
        this.onExecutionComplete?.(persona.id, 'failed', mention.id);
        this.logger.info(`Agent execution ${reason}`, { executionId, persona: persona.name });
        return;
      }

      // 11a. Detect SDK subprocess crash: zero messages yielded
      if (!sdkSessionId && resultText === '' && !structuredOutput) {
        const stderrSummary = summarizeStderr(cliStderr);
        this.logger.error('SDK query loop yielded no messages — subprocess likely crashed', {
          executionId,
          persona: persona.name,
          model: resolved.model,
          worktreePath,
          cliStderr: stderrSummary || '(empty — CLI wrote nothing to stderr)',
        });
        const errorText = stderrSummary
          ? `Agent SDK produced no output (subprocess crashed at startup).\n\n[Claude CLI stderr]\n${stderrSummary}`
          : 'Agent SDK produced no output (subprocess likely crashed at startup). Check ~/.fleex/.logs/<instance>/server.log for EPIPE / spawn errors.';
        await emitEvent('error', { error: errorText, ticketId: mention.ticketId });
        // Emit execution_end so every log view flips out of "running" and shows
        // the failed state (the store keys failure off execution_end).
        await emitEvent('execution_end', { status: 'failed', reason: 'subprocess_crash', ticketId: mention.ticketId, model: resolved.model, effectiveMode });
        await this.agentEventStore.completeExecution(executionId, 'failed', { model: resolved.model, effectiveMode, effort: resolved.effort, fast: resolved.fast });
        this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'failed', abortController });
        // markFailed (not resetToPending): a silent subprocess crash sent back to
        // `pending` is exactly the "invisible crash" bug this ticket fixes. Mark it
        // `failed` so the crash card surfaces it and offers a one-click relaunch.
        mention.markFailed();
        await this.mentionStore.save(mention);
        // Emit AFTER completeExecution + save so the cockpit reconcile sees the
        // failed execution (→ idle) and the crash card renders with the reason.
        this.eventBus?.emit({
          type: 'mention.execution_failed',
          mentionId: mention.id,
          ticketId: mention.ticketId,
          targetAgent: mention.targetAgent,
          reason: 'subprocess',
          message: CRASH_MESSAGES.subprocess!,
          occurredAt: new Date(),
        });
        this.onExecutionComplete?.(persona.id, 'failed', mention.id);
        return;
      }

      // 11a-bis. Detect the SDK "max turns" limit (150). The query loop returns
      // normally with `error_max_turns` rather than throwing, so we must treat it
      // as a crash here — otherwise the run would be recorded as `completed` and
      // the mention would stay stuck in `acknowledged`. The crash card offers a
      // one-click relaunch, which resumes the session to continue where it stopped.
      if (resultSubtype === 'error_max_turns') {
        const { reason, message } = classifyCrash('error_max_turns', { acknowledged: true });
        this.logger.warn('SDK reached max turns — recording as a recoverable crash', {
          executionId,
          persona: persona.name,
          mentionId: mention.id,
        });
        await emitEvent('error', { error: message, ticketId: mention.ticketId });
        await emitEvent('execution_end', { status: 'failed', reason, ticketId: mention.ticketId, model: resolved.model, effectiveMode });
        await this.agentEventStore.completeExecution(executionId, 'failed', { model: resolved.model, effectiveMode, effort: resolved.effort, fast: resolved.fast });
        // Persist the session so the relaunch can resume from where it stopped.
        if (sdkSessionId) {
          this.sessionHistory.set(sessionKey, sdkSessionId);
          await this.agentEventStore.updateSessionId(executionId, sdkSessionId);
        }
        this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'failed', abortController });
        mention.markFailed();
        await this.mentionStore.save(mention);
        // Emit AFTER completeExecution so the cockpit reconcile computes `idle`.
        this.eventBus?.emit({
          type: 'mention.execution_failed',
          mentionId: mention.id,
          ticketId: mention.ticketId,
          targetAgent: mention.targetAgent,
          reason,
          message,
          occurredAt: new Date(),
        });
        this.onExecutionComplete?.(persona.id, 'failed', mention.id);
        return;
      }

      // 11b. Parse structured output — prefer SDK-validated output, fall back to text parser
      const structured = structuredOutput ?? parseAgentOutput(resultText, { validTypes: this.agentSelectableTypeIds() });

      await emitEvent('execution_end', {
        status: 'completed',
        ticketId: mention.ticketId,
        model: resolved.model,
        effectiveMode,
        resultLength: resultText.length,
        structuredOutputParsed: structured !== null,
        durationMs: sdkDurationMs,
        costUsd: sdkCostUsd,
        inputTokens: sdkInputTokens,
        outputTokens: sdkOutputTokens,
        cacheReadTokens: sdkCacheReadTokens,
        cacheCreationTokens: sdkCacheCreationTokens,
        // Turns consumed vs the budget that was in force, so the log answers
        // "did this run hit the cap?" directly instead of by tool-call guesswork.
        numTurns: sdkNumTurns,
        maxTurns: runMaxTurns,
      });

      // 10. Store session ID for future resume (in-memory + DB)
      if (sdkSessionId) {
        this.sessionHistory.set(sessionKey, sdkSessionId);
        await this.agentEventStore.updateSessionId(executionId, sdkSessionId);
      }

      // 11. Post result as comment + create deliverable
      let resultCommentId: string | undefined;
      let resultDeliverableId: string | undefined;

      const emitDomainEvents = (commentMentions: { id: string; targetAgent: string; targetType: string; sourceAgent: string }[], commentId: string, ticketId: string) => {
        if (!this.eventBus) return;
        const now = new Date();
        // Emit comment.posted — triggers broadcast, auto-review, wake
        this.eventBus.emit({
          type: 'comment.posted',
          commentId,
          ticketId,
          authorType: 'agent',
          authorName: persona.displayName || persona.name,
          createdMentions: commentMentions.map((m) => ({
            mentionId: m.id,
            targetAgent: m.targetAgent,
            targetType: m.targetType as 'agent' | 'human',
          })),
          occurredAt: now,
        });
        // Emit mention.created for each mention — triggers auto-trigger agent
        for (const m of commentMentions) {
          this.eventBus.emit({
            type: 'mention.created',
            mentionId: m.id,
            ticketId,
            targetAgent: m.targetAgent,
            targetType: m.targetType as 'agent' | 'human',
            sourceAgent: m.sourceAgent,
            occurredAt: now,
          });
        }
      };

      if (structured) {
        // Structured path: create comment and deliverable independently based on parsed output
        if (structured.comment) {
          let commentBody = structured.comment;

          // Server-side handoff enforcement: strip @agent: mentions when deliverable is draft
          const isDraft = structured.deliverable?.status === 'draft';
          if (isDraft) {
            const agentMentionRe = /@agent:[a-zA-Z0-9_-]+/g;
            const stripped = commentBody.replace(agentMentionRe, (match) => {
              this.logger.info('Stripped agent mention from draft comment', {
                executionId,
                persona: persona.name,
                strippedMention: match,
              });
              return `~~${match}~~`;
            });
            if (stripped !== commentBody) {
              commentBody = stripped;
            }
          }

          const { comment, createdMentions: commentMentions } = await this.postComment.execute({
            ticketId: mention.ticketId,
            body: commentBody,
            authorName: persona.displayName || persona.name,
            authorType: 'agent',
            parentId: mention.commentId,
            humanMentionNames: humanName ? [humanName] : [],
          });
          resultCommentId = comment.id;

          // Auto-assign ticket to human when mentioned by agent
          for (const m of commentMentions) {
            if (m.targetType === 'human' && ticket) {
              ticket.assign(m.targetAgent);
              await this.ticketStore.saveTicket(ticket);
              this.eventBus?.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: {}, occurredAt: new Date() });
            }
          }

          // Domain events handle auto-trigger, auto-review, wake
          emitDomainEvents(commentMentions, comment.id, mention.ticketId);
        }

        if (structured.deliverable) {
          try {
            const deliverable = await this.submitDeliverable.execute({
              ticketId: mention.ticketId,
              agentName: persona.name,
              type: structured.deliverable.type ?? 'report',
              title: structured.deliverable.title,
              content: structured.deliverable.markdown,
              status: structured.deliverable.status,
              mentionId: mention.id,
            });
            resultDeliverableId = deliverable.id;

            // Domain event handles broadcast + auto-review workflow
            this.eventBus?.emit({
              type: 'deliverable.created',
              deliverableId: deliverable.id,
              ticketId: mention.ticketId,
              agentName: persona.name,
              status: structured.deliverable!.status as 'draft' | 'final',
              title: deliverable.title,
              occurredAt: new Date(),
            });
          } catch (delivErr) {
            this.logger.warn('Failed to create deliverable', {
              executionId,
              error: delivErr instanceof Error ? delivErr.message : String(delivErr),
            });
          }
        }
      } else if (resultText.length > 0) {
        // Fallback path: agent didn't produce valid JSON — post raw text as comment only
        this.logger.warn('Agent output was not valid structured JSON, falling back to raw comment', {
          executionId,
          persona: persona.name,
          resultLength: resultText.length,
        });

        const { comment, createdMentions: fallbackMentions } = await this.postComment.execute({
          ticketId: mention.ticketId,
          body: resultText,
          authorName: persona.displayName || persona.name,
          authorType: 'agent',
          parentId: mention.commentId,
          humanMentionNames: humanName ? [humanName] : [],
        });
        resultCommentId = comment.id;

        // Auto-assign ticket to human when mentioned by agent
        for (const m of fallbackMentions) {
          if (m.targetType === 'human' && ticket) {
            ticket.assign(m.targetAgent);
            await this.ticketStore.saveTicket(ticket);
            this.eventBus?.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: {}, occurredAt: new Date() });
          }
        }

        // Domain events handle auto-trigger, auto-review, wake
        emitDomainEvents(fallbackMentions, comment.id, mention.ticketId);
      }

      // 12. Resolve or park mention based on mentionStatus
      const now = new Date();
      if (structured?.mentionStatus === 'waiting_for_info') {
        // Server-side enforcement: waiting_for_info requires at least a comment or deliverable
        if (!structured.comment && !structured.deliverable) {
          this.logger.warn('Agent set waiting_for_info but produced no output, forcing resolved', {
            executionId, persona: persona.name,
          });
          mention.resolve({ commentId: resultCommentId, deliverableId: resultDeliverableId });
          await this.mentionStore.save(mention);
          this.eventBus?.emit({
            type: 'mention.resolved',
            mentionId: mention.id,
            ticketId: mention.ticketId,
            targetAgent: mention.targetAgent,
            resolvedBy: persona.name,
            occurredAt: now,
          });
        } else {
          mention.waitForInfo();
          await this.mentionStore.save(mention);
          // Auto-block ticket when agent waits for info
          if (ticket) {
            ticket.update({ blocked: true });
            await this.ticketStore.saveTicket(ticket);
            this.eventBus?.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: {}, occurredAt: new Date() });
          }
          this.eventBus?.emit({
            type: 'mention.waiting_for_info',
            mentionId: mention.id,
            ticketId: mention.ticketId,
            targetAgent: mention.targetAgent,
            occurredAt: now,
          });
        }
      } else {
        mention.resolve({ commentId: resultCommentId, deliverableId: resultDeliverableId });
        await this.mentionStore.save(mention);
        this.eventBus?.emit({
          type: 'mention.resolved',
          mentionId: mention.id,
          ticketId: mention.ticketId,
          targetAgent: mention.targetAgent,
          resolvedBy: persona.name,
          occurredAt: now,
        });
      }

      // 13. Complete execution tracking (with instrumentation).
      // Persist the *resolved* model (conversation override or persona default)
      // that actually ran — not persona.model — so cost tracking and the audit
      // trail reflect which model executed on this run.
      await this.agentEventStore.completeExecution(executionId, 'completed', {
        model: resolved.model,
        effectiveMode,
        effort: resolved.effort,
        fast: resolved.fast,
        durationMs: sdkDurationMs,
        costUsd: sdkCostUsd,
        inputTokens: sdkInputTokens,
        outputTokens: sdkOutputTokens,
        cacheReadTokens: sdkCacheReadTokens,
        cacheCreationTokens: sdkCacheCreationTokens,
        commentId: resultCommentId,
        deliverableId: resultDeliverableId,
      });
      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'completed', abortController });
      this.onExecutionComplete?.(persona.id, 'completed', mention.id);

      this.logger.info('Agent execution completed', {
        executionId,
        persona: persona.name,
        mentionId: mention.id,
        resultLength: resultText.length,
        structuredOutputParsed: structured !== null,
      });
    } catch (err) {
      // A thrown error means the SDK session died — at startup (pre-acknowledge:
      // workspace error, usage limit, not logged in) or mid-run (post-acknowledge:
      // usage limit, subprocess crash). Either way the mention would otherwise stay
      // stuck (`pending`/`acknowledged`) with the UI spinning forever. Classify the
      // crash into a stable reason + remediation, mark the mention `failed`, and
      // surface it so the crash card can offer a one-click relaunch.
      const rawError = err instanceof Error ? err.message : String(err);
      const { reason, message } = classifyCrash(rawError, { acknowledged });

      // Emit error event (err.message already carries the CLI stderr, appended
      // by streamSdkQuery) followed by execution_end so every log view flips out
      // of "running" and renders the failed state.
      try {
        const errorEvent = AgentEventEntity.create({
          executionId,
          eventType: 'error',
          data: { error: rawError, ticketId: mention.ticketId },
          sequence: 999998,
        });
        await this.agentEventStore.appendEvent(errorEvent);
        this.onEvent?.(errorEvent);
        const endEvent = AgentEventEntity.create({
          executionId,
          eventType: 'execution_end',
          data: { status: 'failed', reason, ticketId: mention.ticketId },
          sequence: 999999,
        });
        await this.agentEventStore.appendEvent(endEvent);
        this.onEvent?.(endEvent);
        await this.agentEventStore.completeExecution(executionId, 'failed');
      } catch {
        // Don't let event store errors mask the original error
      }

      // Persist the `failed` status so the crash card survives a reload. A
      // `resolved`/`waiting_for_info` mention is never failed retroactively
      // (markFailed only acts on `pending`/`acknowledged`).
      try {
        mention.markFailed();
        await this.mentionStore.save(mention);
      } catch (saveErr) {
        this.logger.error('Failed to persist crashed mention status', {
          executionId,
          mentionId: mention.id,
          error: saveErr instanceof Error ? saveErr.message : String(saveErr),
        });
      }

      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'failed', abortController });

      // Emit AFTER completeExecution + save so the cockpit reconcile sees the
      // execution as `failed` (→ idle) and the client can flip the mention to
      // `failed` and render the crash card with the live reason/message.
      this.eventBus?.emit({
        type: 'mention.execution_failed',
        mentionId: mention.id,
        ticketId: mention.ticketId,
        targetAgent: mention.targetAgent,
        reason,
        message,
        occurredAt: new Date(),
      });

      this.onExecutionComplete?.(persona.id, 'failed', mention.id);
      this.logger.error('Agent execution failed', {
        executionId,
        persona: persona.name,
        mentionId: mention.id,
        acknowledged,
        reason,
        error: rawError,
      });
      throw err;
    } finally {
      // The global SDK slot is released by the sdkLimiter.run() wrapper in
      // drainQueue once this method settles. Clean up completed/failed
      // executions after a delay.
      setTimeout(() => {
        const exec = this.activeExecutions.get(mention.id);
        if (exec && exec.status !== 'running') {
          this.activeExecutions.delete(mention.id);
        }
      }, 30000);
    }
  }

  /**
   * Execute a skill against a ticket.
   * This bypasses the mention lifecycle and runs the agent with the skill's markdown as instructions.
   */
  async executeForSkill(skillId: string, ticketId: string, opts?: {
    commentBody?: string;
    mentionId?: string;
    outputFormatOverride?: typeof OUTPUT_FORMAT_SCHEMA;
    workflowContextPrompt?: string;
    returnStructured?: boolean;
    // When set, the "Running skill: X" announce comment is authored with a
    // workflow-aware label (e.g. "workflow:Smoke Test → PR FAQ") so readers
    // of the ticket comments tab can tell at a glance which workflow run
    // produced each comment instead of seeing just the bare persona name.
    // `runId`/`stepRunId` additionally tag the execution with the workflow node
    // it belongs to, so the Execution Log header names the step being debugged.
    workflowContext?: { workflowName: string; stepName: string; runId?: string | null; stepRunId?: string | null };
  }): Promise<{ structuredOutput: Record<string, unknown> | null; rawText: string; executionId: string } | void> {
    if (!this.skillStore) {
      throw new Error('SkillStore not available');
    }

    const { SkillNotFoundError } = await import('../../domain/errors.js');
    const skill = await this.skillStore.getById(skillId);
    if (!skill) throw new SkillNotFoundError(skillId);

    const persona = await this.personaStore.getById(skill.personaId);
    if (!persona) throw new AgentPersonaNotFoundError(skill.personaId);

    const humanName = this.resolveHumanMentionName(persona);
    const executionId = randomUUID();
    const abortController = new AbortController();
    const skillMentionKey = `skill:${skillId}`;

    this.activeExecutions.set(skillMentionKey, {
      mentionId: skillMentionKey,
      executionId,
      personaId: persona.id,
      ticketId,
      status: 'running',
      abortController,
    });

    // 1. Post a comment announcing the skill execution
    const announceBody = opts?.commentBody
      ? `Running skill: **${skill.displayName}** _(via comment)_`
      : `Running skill: **${skill.displayName}**`;
    const announceAuthor = opts?.workflowContext
      ? `workflow:${opts.workflowContext.workflowName} → ${opts.workflowContext.stepName}`
      : (persona.displayName || persona.name);
    const { comment: announceComment } = await this.postComment.execute({
      ticketId,
      body: announceBody,
      authorName: announceAuthor,
      authorType: 'agent',
      humanMentionNames: [],
    });

    if (this.eventBus) {
      this.eventBus.emit({
        type: 'comment.posted',
        commentId: announceComment.id,
        ticketId,
        authorType: 'agent',
        authorName: announceAuthor,
        createdMentions: [],
        occurredAt: new Date(),
      });
    }

    // 2. Try to resolve workspace (optional for skills — many don't need file access)
    const worktreePath = await this.ensureWorkspace(ticketId);
    if (!worktreePath) {
      this.logger.info('Skill execution proceeding without workspace', { executionId, ticketId, skillId });
    }

    // 3. Start execution tracking
    // Tag workflow-driven skill runs with a `workflow:` mentionId so the
    // Execution Log can filter them out of the standalone SKILL listing
    // (they're already represented by the parent workflow row). Non-workflow
    // skill runs keep the `skill:` prefix used for internal lookups.
    const startMentionId = opts?.workflowContext
      ? `workflow:${executionId}`
      : `skill:${skillId}`;
    await this.agentEventStore.startExecution({
      executionId,
      personaId: persona.id,
      ticketId,
      mentionId: startMentionId,
      model: persona.model,
    });

    // 4. Compose prompts
    const systemPrompt = this.composeSystemPrompt(persona, humanName, worktreePath);

    const context = await this.getTicketContext.execute({
      ticketId,
      agentName: persona.name,
    });

    const { blocks: skillPromptBlocks, manifest: skillPromptManifest } =
      await this.composeSkillUserPrompt(context, skill.displayName, skill.markdownContent, opts?.commentBody);

    if (opts?.workflowContextPrompt) {
      const workflowStepText = `\n---\n\n${opts.workflowContextPrompt}`;
      skillPromptBlocks.push({ type: 'text', text: workflowStepText });
      skillPromptManifest.push({
        kind: 'workflow_instructions',
        section: 'Workflow step',
        label: 'Step instructions',
        ticketId,
        charCount: workflowStepText.length,
      });
    }

    this.logger.info('Skill execution started', {
      executionId,
      skillId,
      skillName: skill.commandName,
      persona: persona.name,
      ticketId,
      worktreePath,
    });

    // 5. Emit execution_start event
    let sequence = 0;
    const emitEvent = async (eventType: AgentEventType, data: unknown) => {
      const event = AgentEventEntity.create({
        executionId,
        eventType,
        data,
        sequence: sequence++,
      });
      await this.agentEventStore.appendEvent(event);
      this.onEvent?.(event);
    };

    // Build context window summary for observability (parity with persona).
    const skillContextSections: string[] = [];
    if (persona.soulMd) skillContextSections.push('SOUL.md');
    if (persona.identityMd) skillContextSections.push('IDENTITY.md');
    if (persona.memoryMd) skillContextSections.push('MEMORY.md');
    skillContextSections.push('Structured output instructions');
    if (humanName) skillContextSections.push(`Human operator (@${humanName})`);
    if (worktreePath) skillContextSections.push(`Working directory (${worktreePath})`);
    skillContextSections.push(`Skill: ${skill.displayName}`);
    const skillUserPromptLength = promptTextLength(skillPromptBlocks);

    const skillMaxTurns = effectiveMaxTurns('edit', this.config.get().agentMaxTurns);

    await emitEvent('execution_start', buildExecutionStartData({
      executionId,
      personaId: persona.id,
      personaName: persona.name,
      ticketId,
      mentionId: startMentionId,
      model: persona.model,
      // Skills always run with full edit rights.
      effectiveMode: 'edit',
      worktreePath,
      kind: 'skill',
      maxTurns: skillMaxTurns,
      workflowRunId: opts?.workflowContext?.runId,
      stepRunId: opts?.workflowContext?.stepRunId,
      label: skill.displayName,
      skillId,
      skillName: skill.commandName,
      systemPromptSections: skillContextSections,
      systemPromptLength: systemPrompt.length,
      userPromptLength: skillUserPromptLength,
      ticketTitle: context.ticket.title,
      ticketStatus: context.ticket.status,
      commentsCount: context.comments.length,
      deliverablesCount: context.deliverables.length,
    }));

    await emitEvent('execution_context', buildExecutionContextData({
      executionId,
      systemPrompt,
      promptBlocks: skillPromptBlocks,
      manifest: skillPromptManifest,
      model: persona.model,
      effectiveMode: 'edit',
      maxTurns: skillMaxTurns,
    }));

    // 6. Acquire a global SDK slot before arming the timeout, so time spent
    // waiting behind other executions never counts toward the execution timeout.
    const releaseSdkSlot = await this.sdkLimiter.acquire();

    // 7. Setup timeout + abort
    const timeoutMs = this.config.get().agentExecutionTimeout ?? 30 * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      this.logger.warn('Skill execution timed out', { executionId, persona: persona.name, timeoutMs });
      abortController.abort(new Error('timeout'));
    }, timeoutMs);

    try {
      // 8. Call Claude Agent SDK
      const effectiveMode = 'edit' as const;

      const sessionKey = `skill:${skill.commandName}:${ticketId}`;
      const previousSessionId = this.sessionHistory.get(sessionKey);

      const queryOptions = buildSdkOptions('edit', {
        model: persona.model,
        systemPrompt,
        cwd: worktreePath,
        outputFormat: opts?.outputFormatOverride ?? this.outputFormatSchema(),
        resume: previousSessionId ?? undefined,
        maxTurns: this.config.get().agentMaxTurns,
      });

      // Build prompt: content blocks if images, string otherwise
      const skillHasImages = skillPromptBlocks.some((b) => b.type === 'image');
      const skillPrompt = skillHasImages
        ? skillPromptBlocks
        : skillPromptBlocks.map((b) => (b as { text: string }).text).join('');

      const streamResult = await streamSdkQuery({
        prompt: skillPrompt,
        queryOptions: queryOptions as Record<string, unknown>,
        emitEvent,
        abortSignal: abortController.signal,
        fallbackSessionId: previousSessionId ?? '',
      });

      const sdkSessionId = streamResult.sessionId;
      const resultText = streamResult.resultText;
      const structuredOutput = streamResult.structuredOutput as AgentStructuredOutput | null;
      const sdkDurationMs = streamResult.metrics.durationMs;
      const sdkCostUsd = streamResult.metrics.costUsd;
      const sdkInputTokens = streamResult.metrics.inputTokens;
      const sdkOutputTokens = streamResult.metrics.outputTokens;
      const sdkCacheReadTokens = streamResult.metrics.cacheReadTokens;
      const sdkCacheCreationTokens = streamResult.metrics.cacheCreationTokens;
      const sdkNumTurns = streamResult.metrics.numTurns;

      if (streamResult.resultSubtype === 'error_max_turns') {
        this.logger.warn('Skill query hit the configured turn budget', {
          executionId, skill: skill.commandName, numTurns: sdkNumTurns, maxTurns: skillMaxTurns,
        });
        await emitEvent('max_turns_reached', { numTurns: sdkNumTurns, maxTurns: skillMaxTurns, ticketId });
      }

      clearTimeout(timeoutHandle);

      if (abortController.signal.aborted) {
        await emitEvent('execution_end', { status: 'interrupted', reason: 'timeout', ticketId, model: persona.model, effectiveMode });
        await this.agentEventStore.completeExecution(executionId, 'interrupted', { model: persona.model, effectiveMode });
        return;
      }

      // 8. Store session for potential resume
      if (sdkSessionId) {
        this.sessionHistory.set(sessionKey, sdkSessionId);
        await this.agentEventStore.updateSessionId(executionId, sdkSessionId);
      }

      // 9. Process results — same as executeForMention
      const structured = structuredOutput ?? parseAgentOutput(resultText, { validTypes: this.agentSelectableTypeIds() });
      const ticket = await this.ticketStore.getTicketById(ticketId);

      await emitEvent('execution_end', {
        status: 'completed',
        ticketId,
        model: persona.model,
        effectiveMode,
        resultLength: resultText.length,
        structuredOutputParsed: structured !== null,
        durationMs: sdkDurationMs,
        costUsd: sdkCostUsd,
        inputTokens: sdkInputTokens,
        outputTokens: sdkOutputTokens,
        cacheReadTokens: sdkCacheReadTokens,
        cacheCreationTokens: sdkCacheCreationTokens,
        numTurns: sdkNumTurns,
        maxTurns: skillMaxTurns,
      });

      // Short-circuit: workflow orchestrator handles persistence via step_runs
      if (opts?.returnStructured) {
        await this.agentEventStore.completeExecution(executionId, 'completed', {
          model: persona.model,
          effectiveMode,
          durationMs: sdkDurationMs,
          costUsd: sdkCostUsd,
          inputTokens: sdkInputTokens,
          outputTokens: sdkOutputTokens,
          cacheReadTokens: sdkCacheReadTokens,
          cacheCreationTokens: sdkCacheCreationTokens,
        });
        this.activeExecutions.set(skillMentionKey, { mentionId: skillMentionKey, executionId, personaId: persona.id, ticketId, status: 'completed', abortController });
        this.onExecutionComplete?.(persona.id, 'completed', skillMentionKey);
        return { structuredOutput: structured as Record<string, unknown> | null, rawText: resultText, executionId };
      }

      // Track the artifacts this skill run produced so the execution row can link
      // to them (parity with the persona path) — no `agentName` pattern-matching.
      let resultCommentId: string | undefined;
      let resultDeliverableId: string | undefined;

      if (structured) {
        if (structured.comment) {
          const { comment, createdMentions } = await this.postComment.execute({
            ticketId,
            body: structured.comment,
            authorName: persona.displayName || persona.name,
            authorType: 'agent',
            parentId: announceComment.id,
            humanMentionNames: humanName ? [humanName] : [],
          });
          resultCommentId = comment.id;

          if (this.eventBus) {
            this.eventBus.emit({
              type: 'comment.posted',
              commentId: comment.id,
              ticketId,
              authorType: 'agent',
              authorName: persona.displayName || persona.name,
              createdMentions: createdMentions.map((m) => ({
                mentionId: m.id,
                targetAgent: m.targetAgent,
                targetType: m.targetType as 'agent' | 'human',
              })),
              occurredAt: new Date(),
            });
            for (const m of createdMentions) {
              this.eventBus.emit({
                type: 'mention.created',
                mentionId: m.id,
                ticketId,
                targetAgent: m.targetAgent,
                targetType: m.targetType as 'agent' | 'human',
                sourceAgent: m.sourceAgent,
                occurredAt: new Date(),
              });
            }
          }

          for (const m of createdMentions) {
            if (m.targetType === 'human' && ticket) {
              ticket.assign(m.targetAgent);
              await this.ticketStore.saveTicket(ticket);
              this.eventBus?.emit({ type: 'ticket.updated', ticketId: ticket.id, changes: {}, occurredAt: new Date() });
            }
          }
        }

        if (structured.deliverable) {
          try {
            const deliverable = await this.submitDeliverable.execute({
              ticketId,
              agentName: persona.name,
              type: structured.deliverable.type ?? 'report',
              title: structured.deliverable.title,
              content: structured.deliverable.markdown,
              status: structured.deliverable.status,
            });
            resultDeliverableId = deliverable.id;

            this.eventBus?.emit({
              type: 'deliverable.created',
              deliverableId: deliverable.id,
              ticketId,
              agentName: persona.name,
              status: structured.deliverable.status as 'draft' | 'final',
              title: deliverable.title,
              occurredAt: new Date(),
            });
          } catch (delivErr) {
            this.logger.warn('Failed to create deliverable from skill', {
              executionId,
              error: delivErr instanceof Error ? delivErr.message : String(delivErr),
            });
          }
        }
      } else if (resultText.length > 0) {
        const { comment } = await this.postComment.execute({
          ticketId,
          body: resultText,
          authorName: persona.displayName || persona.name,
          authorType: 'agent',
          parentId: announceComment.id,
          humanMentionNames: humanName ? [humanName] : [],
        });
        resultCommentId = comment.id;

        if (this.eventBus) {
          this.eventBus.emit({
            type: 'comment.posted',
            commentId: comment.id,
            ticketId,
            authorType: 'agent',
            authorName: persona.displayName || persona.name,
            createdMentions: [],
            occurredAt: new Date(),
          });
        }
      }

      await this.agentEventStore.completeExecution(executionId, 'completed', {
        model: persona.model,
        effectiveMode,
        durationMs: sdkDurationMs,
        costUsd: sdkCostUsd,
        inputTokens: sdkInputTokens,
        outputTokens: sdkOutputTokens,
        cacheReadTokens: sdkCacheReadTokens,
        cacheCreationTokens: sdkCacheCreationTokens,
        commentId: resultCommentId,
        deliverableId: resultDeliverableId,
      });
      this.activeExecutions.set(skillMentionKey, { mentionId: skillMentionKey, executionId, personaId: persona.id, ticketId, status: 'completed', abortController });
      this.onExecutionComplete?.(persona.id, 'completed', skillMentionKey);

      // Resolve the mention if this was triggered from a comment
      if (opts?.mentionId) {
        try {
          const mention = await this.mentionStore.getById(opts.mentionId);
          if (mention && mention.status !== 'resolved') {
            mention.resolve();
            await this.mentionStore.save(mention);
            this.eventBus?.emit({
              type: 'mention.resolved',
              mentionId: mention.id,
              ticketId: mention.ticketId,
              targetAgent: mention.targetAgent,
              resolvedBy: persona.name,
              occurredAt: new Date(),
            });
          }
        } catch (resolveErr) {
          this.logger.warn('Failed to resolve skill mention', {
            mentionId: opts.mentionId,
            error: resolveErr instanceof Error ? resolveErr.message : String(resolveErr),
          });
        }
      }

      this.logger.info('Skill execution completed', {
        executionId,
        skillId,
        persona: persona.name,
        ticketId,
        resultLength: resultText.length,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      try {
        const errorEvent = AgentEventEntity.create({
          executionId,
          eventType: 'error',
          data: { error: err instanceof Error ? err.message : String(err) },
          sequence: 999999,
        });
        await this.agentEventStore.appendEvent(errorEvent);
        this.onEvent?.(errorEvent);
        await this.agentEventStore.completeExecution(executionId, 'failed', { model: persona.model });
      } catch {
        // Don't mask original error
      }

      this.activeExecutions.set(skillMentionKey, { mentionId: skillMentionKey, executionId, personaId: persona.id, ticketId, status: 'failed', abortController });
      this.onExecutionComplete?.(persona.id, 'failed', skillMentionKey);

      // Resolve the mention even on failure so it doesn't stay pending
      if (opts?.mentionId) {
        try {
          const mention = await this.mentionStore.getById(opts.mentionId);
          if (mention && mention.status !== 'resolved') {
            mention.resolve();
            await this.mentionStore.save(mention);
            this.eventBus?.emit({
              type: 'mention.resolved',
              mentionId: mention.id,
              ticketId: mention.ticketId,
              targetAgent: mention.targetAgent,
              resolvedBy: persona.name,
              occurredAt: new Date(),
            });
          }
        } catch {
          // Don't mask original error
        }
      }

      this.logger.error('Skill execution failed', {
        executionId,
        skillId,
        persona: persona.name,
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      releaseSdkSlot();
      // Clean up completed/failed executions after a delay
      setTimeout(() => {
        const exec = this.activeExecutions.get(skillMentionKey);
        if (exec && exec.status !== 'running') {
          this.activeExecutions.delete(skillMentionKey);
        }
      }, 30000);
    }
  }

  /**
   * Execute an agent as part of a workflow step.
   * Unlike `execute()` this does not consume a pending mention — the workflow
   * orchestrator drives execution and persists output to step_runs.
   *
   * Returns the parsed structured output (with custom schema fields merged at
   * top-level) and the executionId for audit linking.
   */
  async executeForWorkflowStep(params: {
    personaName: string;
    /** Null when the run is anchored to a routine — `routineId` + `subject` replace it. */
    ticketId: string | null;
    routineId?: string | null;
    /** Frozen routine subject (repos / brief / documents). Drives workspace + prompt. */
    subject?: RunSubject | null;
    workflowRunId?: string | null;
    /** The attempt this execution *is*. Emitted in the header for debugging. */
    stepRunId?: string | null;
    outputFormat: typeof OUTPUT_FORMAT_SCHEMA;
    workflowContextPrompt: string;
    mode: MentionExecutionMode;
    /**
     * Called as soon as the execution is registered and its `executionId` is
     * known (before the SDK query runs), so the orchestrator can persist
     * `step_run.executionId` live and make the in-flight step cancellable.
     */
    onExecutionStarted?: (executionId: string) => void | Promise<void>;
  }): Promise<{
    structuredOutput: Record<string, unknown> | null;
    rawText: string;
    executionId: string;
  }> {
    const persona = await this.personaStore.getByName(params.personaName);
    if (!persona) throw new AgentPersonaNotFoundError(params.personaName);

    // Hold a global SDK slot for the whole step (worktree setup + query), so
    // concurrent workflow runs are throttled by the one global limit rather than
    // a serial queue. The release fn is idempotent and runs in finally.
    const releaseSdkSlot = await this.sdkLimiter.acquire();
    const executionId = randomUUID();
    // Register the execution so the Terminate button / cancel run / force
    // restart can find and abort it, exactly like mention & skill executions.
    // Keyed by `workflow:${executionId}` (no backing mention to key on).
    const workflowExecKey = `workflow:${executionId}`;
    const abortController = new AbortController();
    this.activeExecutions.set(workflowExecKey, {
      mentionId: workflowExecKey, executionId, personaId: persona.id,
      ticketId: params.ticketId, status: 'running', abortController,
    });
    let finalStatus: 'completed' | 'failed' = 'completed';
    try {
      const humanName = this.resolveHumanMentionName(persona);

      // Effective mode: respect persona ceiling
      const effectiveMode: MentionExecutionMode = persona.executionMode === 'message' ? 'talk' : params.mode;

      // Workspace if needed (same as executeForMention)
      let worktreePath: string | null = null;
      if (effectiveMode !== 'talk') {
        worktreePath = params.ticketId
          ? await this.ensureWorkspace(params.ticketId)
          : await this.ensureRoutineWorkspace({
            routineId: params.routineId ?? null,
            workflowRunId: params.workflowRunId ?? executionId,
            subject: params.subject ?? null,
          });
      }

      // Start tracking
      await this.agentEventStore.startExecution({
        executionId, personaId: persona.id, ticketId: params.ticketId, mentionId: workflowExecKey,
        model: persona.model,
      });

      // Surface the live executionId to the orchestrator so it can persist
      // `step_run.executionId` while the step is still running — the handle the
      // cancel/terminate/force-restart paths need to abort this execution.
      await params.onExecutionStarted?.(executionId);

      // Compose prompts
      // A routine run has no ticket to read context from: the frozen subject
      // (brief + repos) is the whole "what am I working on".
      const context = params.ticketId
        ? await this.getTicketContext.execute({ ticketId: params.ticketId, agentName: persona.name })
        : null;
      // Known repo count so an empty workspace is stated rather than left for
      // the agent to discover: a routine with no repo gets a workspace holding
      // only `.fleex.json`, and without this note the agent explores it, finds
      // nothing, and stalls instead of working from its brief.
      const repoCount = context
        ? context.ticket.links.filter((l) => l.type === 'repository').length
        : (params.subject?.repos?.length ?? 0);
      const systemPrompt = this.composeSystemPrompt(persona, humanName, worktreePath, repoCount);
      const { blocks: userPromptBlocks, manifest: userPromptManifest } = context
        ? await this.composeWorkflowUserPrompt(context, params.workflowContextPrompt)
        : await this.composeRoutineUserPrompt(params.subject ?? null, params.workflowContextPrompt);
      const userPromptText = userPromptBlocks.map((b) => b.type === 'text' ? b.text : '').join('');

      let sequence = 0;
      const emitEvent = async (eventType: AgentEventType, data: unknown) => {
        const event = AgentEventEntity.create({ executionId, eventType, data, sequence: sequence++ });
        await this.agentEventStore.appendEvent(event);
        this.onEvent?.(event);
      };

      // Build context window summary for observability (parity with persona).
      const wfContextSections: string[] = [];
      if (persona.soulMd) wfContextSections.push('SOUL.md');
      if (persona.identityMd) wfContextSections.push('IDENTITY.md');
      if (persona.memoryMd) wfContextSections.push('MEMORY.md');
      wfContextSections.push('Structured output instructions');
      if (humanName) wfContextSections.push(`Human operator (@${humanName})`);
      if (worktreePath) wfContextSections.push(`Working directory (${worktreePath})`);
      wfContextSections.push('Workflow step');

      const wfMaxTurns = effectiveMaxTurns(effectiveMode, this.config.get().agentMaxTurns);

      await emitEvent('execution_start', buildExecutionStartData({
        executionId,
        personaId: persona.id,
        personaName: persona.name,
        ticketId: params.ticketId,
        mentionId: `workflow:${executionId}`,
        model: persona.model,
        effectiveMode,
        worktreePath,
        kind: 'workflow_step',
        label: 'workflow step',
        maxTurns: wfMaxTurns,
        workflowRunId: params.workflowRunId,
        stepRunId: params.stepRunId,
        systemPromptSections: wfContextSections,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPromptText.length,
        ticketTitle: context?.ticket.title,
        ticketStatus: context?.ticket.status,
        commentsCount: context?.comments.length ?? 0,
        deliverablesCount: context?.deliverables.length ?? 0,
      }));

      await emitEvent('execution_context', buildExecutionContextData({
        executionId,
        systemPrompt,
        promptBlocks: userPromptBlocks,
        manifest: userPromptManifest,
        model: persona.model,
        effectiveMode,
        maxTurns: wfMaxTurns,
      }));

      // SDK query
      const queryOptions = buildSdkOptions(effectiveMode, {
        model: persona.model, systemPrompt, cwd: worktreePath,
        outputFormat: params.outputFormat,
        maxTurns: this.config.get().agentMaxTurns,
        talkCanReadImages: effectiveMode === 'talk' && promptHasImageAttachment(userPromptBlocks),
      });

      const hasImages = userPromptBlocks.some((b) => b.type === 'image');
      let structuredOutput: Record<string, unknown> | null = null;
      let resultText = '';
      // SDK instrumentation — must be threaded into completeExecution below so
      // workflow-step cost/tokens land in the stats (parity with persona/skill
      // paths). Previously dropped, which made every workflow run cost $0.
      let sdkSessionId: string | undefined;
      let sdkDurationMs: number | undefined;
      let sdkCostUsd: number | undefined;
      let sdkInputTokens: number | undefined;
      let sdkOutputTokens: number | undefined;
      let sdkCacheReadTokens: number | undefined;
      let sdkCacheCreationTokens: number | undefined;
      let sdkNumTurns: number | undefined;
      try {
        const streamResult = await streamSdkQuery({
          prompt: hasImages ? userPromptBlocks : userPromptText,
          queryOptions: queryOptions as Record<string, unknown>,
          emitEvent,
          abortSignal: abortController.signal,
        });
        structuredOutput = streamResult.structuredOutput;
        resultText = streamResult.resultText;
        sdkSessionId = streamResult.sessionId;
        sdkDurationMs = streamResult.metrics.durationMs;
        sdkCostUsd = streamResult.metrics.costUsd;
        sdkInputTokens = streamResult.metrics.inputTokens;
        sdkOutputTokens = streamResult.metrics.outputTokens;
        sdkCacheReadTokens = streamResult.metrics.cacheReadTokens;
        sdkCacheCreationTokens = streamResult.metrics.cacheCreationTokens;
        sdkNumTurns = streamResult.metrics.numTurns;

        if (streamResult.resultSubtype === 'error_max_turns') {
          this.logger.warn('Workflow step hit the configured turn budget', {
            executionId, numTurns: sdkNumTurns, maxTurns: wfMaxTurns,
          });
          await emitEvent('max_turns_reached', {
            numTurns: sdkNumTurns, maxTurns: wfMaxTurns, ticketId: params.ticketId,
          });
        }
      } catch (err) {
        // Cancelled (Terminate / cancel run / force restart): cancelExecution()
        // already emitted `execution_end` (interrupted) and completed the
        // execution in the store. Don't double-emit; signal the orchestrator to
        // mark the step cancelled rather than failed.
        if (abortController.signal.aborted) {
          finalStatus = 'failed';
          throw new ExecutionCancelledError(executionId);
        }
        await emitEvent('error', { error: err instanceof Error ? err.message : String(err) });
        await this.agentEventStore.completeExecution(executionId, 'failed', { model: persona.model });
        finalStatus = 'failed';
        throw err;
      }

      // The SDK can also resolve normally on abort (yields empty result).
      if (abortController.signal.aborted) {
        finalStatus = 'failed';
        throw new ExecutionCancelledError(executionId);
      }

      // Persist the SDK session id so this workflow step is linked to its
      // transcript (parity with persona/skill paths — enables resume and the
      // cost backfill to match this execution by session id).
      if (sdkSessionId) {
        await this.agentEventStore.updateSessionId(executionId, sdkSessionId);
      }

      await emitEvent('execution_end', {
        status: 'completed', ticketId: params.ticketId, model: persona.model, effectiveMode,
        resultLength: resultText.length,
        durationMs: sdkDurationMs,
        costUsd: sdkCostUsd,
        inputTokens: sdkInputTokens,
        outputTokens: sdkOutputTokens,
        cacheReadTokens: sdkCacheReadTokens,
        cacheCreationTokens: sdkCacheCreationTokens,
        numTurns: sdkNumTurns,
        maxTurns: wfMaxTurns,
      });
      await this.agentEventStore.completeExecution(executionId, 'completed', {
        model: persona.model,
        effectiveMode,
        durationMs: sdkDurationMs,
        costUsd: sdkCostUsd,
        inputTokens: sdkInputTokens,
        outputTokens: sdkOutputTokens,
        cacheReadTokens: sdkCacheReadTokens,
        cacheCreationTokens: sdkCacheCreationTokens,
      });

      return { structuredOutput, rawText: resultText, executionId };
    } catch (err) {
      if (!(err instanceof ExecutionCancelledError)) finalStatus = 'failed';
      throw err;
    } finally {
      // Parity with mention/skill paths: leave a terminal in-memory marker so
      // getStatus()/cancelExecution() never treat a finished step as running.
      const exec = this.activeExecutions.get(workflowExecKey);
      if (exec) exec.status = finalStatus;
      releaseSdkSlot();
    }
  }

  private async composeWorkflowUserPrompt(
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    workflowContextPrompt: string,
  ): Promise<ComposedPrompt> {
    const composer = new PromptComposer((text) => this.resolveText(text));

    composer.track(
      { kind: 'ticket_header', section: 'Ticket', label: context.ticket.title, sourceKind: 'ticket', sourceId: context.ticket.id, ticketId: context.ticket.id },
      `# Ticket: ${context.ticket.title}\nStatus: ${context.ticket.status} | Priority: ${context.ticket.priority}`,
    );
    if (context.ticket.description) {
      await composer.trackResolved(
        { kind: 'description', section: 'Description', label: 'Ticket description', sourceKind: 'ticket', sourceId: context.ticket.id, ticketId: context.ticket.id },
        `\n## Description\n\n${context.ticket.description}`,
      );
    }
    if (context.comments.length > 0) {
      composer.scaffold('\n## Comments\n');
      for (const c of context.comments) {
        await composer.trackResolved(
          { kind: 'comment', section: 'Comments', label: `${c.authorName} (${c.authorType})`, sourceKind: 'comment', sourceId: c.id, ticketId: context.ticket.id },
          `**${c.authorName}** (${c.authorType}):\n${c.body}\n`,
        );
      }
    }
    if (context.deliverables.length > 0) {
      composer.scaffold('\n## Deliverables\n');
      for (const d of context.deliverables) {
        composer.track(
          { kind: 'deliverable', section: 'Deliverables', label: d.title, provenance: `${d.type} — ${d.status}`, sourceKind: 'deliverable', sourceId: d.id, ticketId: context.ticket.id },
          `### [${d.status}] ${d.title} (${d.type})\n${d.content ?? ''}\n`,
        );
      }
    }
    composer.track(
      { kind: 'workflow_instructions', section: 'Workflow step', label: 'Step instructions', ticketId: context.ticket.id },
      '\n---\n\n' + workflowContextPrompt,
    );
    return { blocks: composer.getBlocks(), manifest: composer.getManifest() };
  }

  /**
   * Workflow-step prompt for a routine run. There is no ticket, so the frozen
   * subject stands in for it: the brief is the objective, the repos tell the
   * agent what is checked out in its workspace.
   */
  private async composeRoutineUserPrompt(
    subject: RunSubject | null,
    workflowContextPrompt: string,
  ): Promise<ComposedPrompt> {
    const composer = new PromptComposer((text) => this.resolveText(text));

    composer.scaffold('# Routine run\n\nThis run is not attached to a ticket. Your objective is the brief below.');
    if (subject?.brief) {
      await composer.trackResolved(
        { kind: 'routine_brief', section: 'Brief', label: 'Routine brief' },
        `\n## Brief\n\n${subject.brief}`,
      );
    }
    if (subject?.repos?.length) {
      composer.track(
        { kind: 'routine_repositories', section: 'Repositories', label: subject.repos.join(', ') },
        `\n## Repositories\n\n${subject.repos.map((r) => `- ${r}`).join('\n')}\n`,
      );
    }
    composer.track(
      { kind: 'workflow_instructions', section: 'Workflow step', label: 'Step instructions' },
      '\n---\n\n' + workflowContextPrompt,
    );
    return { blocks: composer.getBlocks(), manifest: composer.getManifest() };
  }

  private async composeSkillUserPrompt(
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    skillDisplayName: string,
    skillMarkdown: string,
    commentBody?: string,
  ): Promise<ComposedPrompt> {
    const composer = new PromptComposer((text) => this.resolveText(text));

    await this.composeTicketBackground(composer, context);

    if (commentBody) {
      composer.track(
        { kind: 'skill_arguments', section: 'Skill Arguments', label: 'Arguments from comment', ticketId: context.ticket.id },
        `\n## Skill Arguments (from comment)\n${commentBody}`,
      );
    }

    composer.track(
      { kind: 'skill_instructions', section: 'Skill Instructions', label: skillDisplayName, sourceKind: 'skill' },
      `\n---\n\n# Skill Instructions: ${skillDisplayName}\n\n${skillMarkdown}`,
    );

    return { blocks: composer.getBlocks(), manifest: composer.getManifest() };
  }

  /**
   * The ticket background every non-mention run shares: header, description,
   * comments, deliverables. Factored out so skill and workflow-step prompts
   * cannot drift apart from each other in either the text they send or the
   * manifest they declare.
   */
  private async composeTicketBackground(
    composer: PromptComposer,
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    includeTicketType = true,
  ): Promise<void> {
    composer.track(
      { kind: 'ticket_header', section: 'Ticket', label: context.ticket.title, sourceKind: 'ticket', sourceId: context.ticket.id, ticketId: context.ticket.id },
      `# Ticket: ${context.ticket.title}\nStatus: ${context.ticket.status} | Priority: ${context.ticket.priority}`
      + (includeTicketType && context.ticket.type ? ` | Type: ${context.ticket.type}` : ''),
    );

    if (context.ticket.description) {
      await composer.trackResolved(
        { kind: 'description', section: 'Description', label: 'Ticket description', sourceKind: 'ticket', sourceId: context.ticket.id, ticketId: context.ticket.id },
        `\n## Description\n\n${context.ticket.description}`,
      );
    }

    if (context.comments.length > 0) {
      composer.scaffold('\n## Comments\n');
      for (const comment of context.comments) {
        await composer.trackResolved(
          { kind: 'comment', section: 'Comments', label: `${comment.authorName} (${comment.authorType})`, sourceKind: 'comment', sourceId: comment.id, ticketId: context.ticket.id },
          `**${comment.authorName}** (${comment.authorType}):\n${comment.body}\n`,
        );
      }
    }

    if (context.deliverables.length > 0) {
      composer.scaffold('\n## Deliverables\n');
      for (const d of context.deliverables) {
        composer.track(
          { kind: 'deliverable', section: 'Deliverables', label: d.title, provenance: `${d.type} by ${d.agentName} — ${d.status}`, sourceKind: 'deliverable', sourceId: d.id, ticketId: context.ticket.id },
          `### [${d.status}] ${d.title} (${d.type}) by ${d.agentName}\n${d.content ?? ''}`,
        );
      }
    }
  }

  /**
   * Ensure a workspace directory exists for agent work on the given ticket,
   * and create a git worktree for each linked repository when present.
   *
   * Returns the workspace path. Edit mode runs against this path as `cwd`
   * whether or not any repo is attached — tickets without a linked
   * repository get an empty workspace so the agent can still use MCP,
   * web, and file tools.
   *
   * Returns null only on a genuine error (ticket not found, FS creation
   * failure). Individual repo / worktree failures are logged and skipped;
   * the workspace path is still returned.
   */
  private async ensureWorkspace(ticketId: string): Promise<string | null> {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) return null;

    // Create workspace + manifest first — independent of repos.
    let workspaceRoot: string;
    try {
      const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
      workspaceRoot = this.resolver!.workspacePath(workspaceId);
      mkdirSync(workspaceRoot, { recursive: true });
      const manifestPath = join(workspaceRoot, '.fleex.json');
      if (!existsSync(manifestPath)) {
        writeFileSync(manifestPath, JSON.stringify({ ticketId: ticket.id }, null, 2));
      }
    } catch (err) {
      this.logger.error('Failed to create workspace for ticket', {
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    // Collect all repos from ticket links
    const repoLinks = ticket.links.filter((l) => l.type === 'repository');
    const repos: { org: string; name: string }[] = [];
    for (const link of repoLinks) {
      const slashIdx = link.ref.indexOf('/');
      if (slashIdx > 0) {
        repos.push({ org: link.ref.substring(0, slashIdx), name: link.ref.substring(slashIdx + 1) });
      }
    }
    if (repos.length === 0) {
      this.logger.info('Workspace ready with no linked repository', { ticketId, workspaceRoot });
      return workspaceRoot;
    }

    // Determine branch: use existing worktree link's branch, or generate a new one
    const existingWorktreeLink = ticket.links.find((l) => l.type === 'worktree');
    const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
    let branchName: string;
    let createNewBranch: boolean;
    if (existingWorktreeLink) {
      const colonIdx = existingWorktreeLink.ref.indexOf(':');
      branchName = colonIdx > 0 ? existingWorktreeLink.ref.substring(colonIdx + 1) : (existingWorktreeLink.label || existingWorktreeLink.ref);
      createNewBranch = false;
    } else {
      const slug = ticket.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      branchName = `agent/${ticket.displayId}-${slug}`;
      createNewBranch = true;
    }

    // Ensure worktree for each repo
    let needsSave = false;
    for (const repo of repos) {
      const wtPath = this.resolver!.workspaceRepoPath(workspaceId, repo.name);
      if (existsSync(wtPath)) continue; // already exists

      // Ensure bare clone
      const barePath = this.resolver!.barePath(repo.org, repo.name);
      if (!existsSync(barePath)) {
        try {
          const remote = `git@github.com:${repo.org}/${repo.name}.git`;
          await this.bareCloneManager!.ensureBareClone(repo.org, repo.name, remote);
        } catch (err) {
          this.logger.warn('Failed to clone repository for agent', {
            ticketId, repo: `${repo.org}/${repo.name}`,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }

      try {
        let usedBranch = branchName;
        try {
          await this.createWorktree.execute(repo.org, repo.name, wtPath, { branch: branchName, createNewBranch });
        } catch {
          // Branch may not exist on this repo (e.g. PR branch from another repo) — create a new one
          if (!createNewBranch) {
            usedBranch = buildTicketBranchName(ticket.title, ticket.id);
            await this.createWorktree.execute(repo.org, repo.name, wtPath, { branch: usedBranch, createNewBranch: true });
          } else {
            throw new Error(`Failed to create branch ${branchName}`);
          }
        }
        if (!ticket.links.some((l) => l.type === 'worktree' && l.ref.startsWith(`${repo.org}/${repo.name}:`))) {
          ticket.addLink('worktree', wtPath, usedBranch, null, randomUUID());
          needsSave = true;
        }
        this.logger.info('Agent worktree ready', { ticketId, repo: `${repo.org}/${repo.name}`, wtPath, branch: usedBranch });
      } catch (err) {
        this.logger.warn('Failed to create agent worktree', {
          ticketId, repo: `${repo.org}/${repo.name}`, wtPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (needsSave) {
      await this.ticketStore.saveTicket(ticket);
      this.eventBus?.emit({ type: 'ticket.updated', ticketId, changes: {}, occurredAt: new Date() });
    }

    return workspaceRoot;
  }

  /**
   * Workspace for a routine run. Mirrors `ensureWorkspace` but sources repos
   * from the run's frozen subject instead of ticket links, and keys the
   * workspace on the run rather than the routine: a recurring routine must not
   * inherit the leftover state of its previous execution.
   *
   * Deviation from the PRD, which named the workspace `routine-{slug}-{run8}`:
   * the slug would require a routine-store lookup here, so the routine id is
   * used instead. Both directions stay traceable.
   */
  private async ensureRoutineWorkspace(params: {
    routineId: string | null;
    workflowRunId: string;
    subject: RunSubject | null;
  }): Promise<string | null> {
    const runShort = params.workflowRunId.slice(0, 8);
    const routineShort = (params.routineId ?? 'adhoc').slice(0, 8);
    const workspaceId = `routine-${routineShort}-${runShort}`;
    const branchName = `agent/${workspaceId}`;

    let workspaceRoot: string;
    try {
      workspaceRoot = this.resolver!.workspacePath(workspaceId);
      mkdirSync(workspaceRoot, { recursive: true });
      const manifestPath = join(workspaceRoot, '.fleex.json');
      if (!existsSync(manifestPath)) {
        writeFileSync(manifestPath, JSON.stringify({
          routineId: params.routineId, workflowRunId: params.workflowRunId,
        }, null, 2));
      }
    } catch (err) {
      this.logger.error('Failed to create workspace for routine run', {
        routineId: params.routineId, workflowRunId: params.workflowRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const repos = (params.subject?.repos ?? [])
      .map((ref) => parseRepoRef(ref))
      .filter((r): r is { org: string; name: string } => r !== null);
    if (repos.length === 0) {
      this.logger.info('Routine workspace ready with no repository', { workspaceId, workspaceRoot });
      return workspaceRoot;
    }

    for (const repo of repos) {
      const wtPath = this.resolver!.workspaceRepoPath(workspaceId, repo.name);
      if (existsSync(wtPath)) continue;

      const barePath = this.resolver!.barePath(repo.org, repo.name);
      if (!existsSync(barePath)) {
        try {
          await this.bareCloneManager!.ensureBareClone(
            repo.org, repo.name, `git@github.com:${repo.org}/${repo.name}.git`,
          );
        } catch (err) {
          this.logger.warn('Failed to clone repository for routine run', {
            workspaceId, repo: `${repo.org}/${repo.name}`,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }

      try {
        await this.createWorktree.execute(repo.org, repo.name, wtPath, {
          branch: branchName, createNewBranch: true,
        });
        this.logger.info('Routine worktree ready', { workspaceId, repo: `${repo.org}/${repo.name}`, wtPath, branch: branchName });
      } catch (err) {
        this.logger.warn('Failed to create routine worktree', {
          workspaceId, repo: `${repo.org}/${repo.name}`, wtPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return workspaceRoot;
  }

  private composeSystemPrompt(persona: AgentPersonaEntity, humanName: string | null, worktreePath: string | null = null, repoCount?: number): string {
    const parts: string[] = [];

    if (persona.soulMd) {
      parts.push(
        'If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.\n\n'
        + `---\n## ${persona.name} - SOUL.md\n\n${persona.soulMd}\n---`,
      );
    }

    if (persona.identityMd) {
      parts.push(`---\n## ${persona.name} - IDENTITY.md\n\n${persona.identityMd}\n---`);
    }

    if (persona.memoryMd) {
      parts.push(`---\n## ${persona.name} - MEMORY.md\n\n${persona.memoryMd}\n---`);
    }

    parts.push(buildStructuredOutputInstructions(this.deliverableTypeDefs()));

    if (humanName) {
      parts.push(
        `## Human Operator\n\n`
        + `To mention the human, you **MUST** use exactly \`@${humanName}\` — this is the only tag the system tracks. `
        + `Do NOT use any other form (no display name, no email, no variation). `
        + `Use \`@${humanName}\` whenever you need human input, decisions, or answers to open questions.`,
      );
    }

    if (worktreePath) {
      const workdirNote = repoCount === 0
        ? `\n\nNote: there is **no repository attached**. The workspace is empty — there is no codebase to read, edit, or run git against. Do not go looking for one: rely on MCP tools, web search, and file operations within this workspace as appropriate.`
        : `\n\nEach attached repository is checked out as a **subdirectory** of that working directory, on a dedicated branch.`;
      parts.push(
        `## Working Directory\n\n`
        + `Your working directory is:\n\`${worktreePath}\`\n\n`
        + `Always use relative paths (e.g. \`packages/server/src/...\`) or this exact path for absolute references. `
        + `Do NOT guess or infer the project root from other context — use this path.`
        + workdirNote,
      );
    }

    return parts.join('\n\n');
  }

  private async composeUserPrompt(
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    mention: TicketMentionEntity,
    isWakeUp = false,
  ): Promise<ComposedPrompt> {
    const composer = new PromptComposer((text) => this.resolveText(text));

    await this.composeTicketBackground(composer, context);

    if (context.epics && context.epics.length > 0) {
      composer.scaffold('\n## Epics\n');
      for (const epic of context.epics) {
        await composer.trackResolved(
          { kind: 'epic', section: 'Epics', label: epic.name, provenance: `${epic.timeframe}, ${epic.groupStatus}` },
          `### ${epic.emoji} ${epic.name} (${epic.timeframe}, ${epic.groupStatus})\n${epic.description ? epic.description + '\n' : ''}`,
        );
      }
    }

    if (context.relevantSummaries && context.relevantSummaries.length > 0) {
      composer.scaffold('\n## Related Ticket Summaries\n');
      composer.scaffold('Context from previously completed tickets — use to avoid reinventing solutions.\n');
      for (const s of context.relevantSummaries) {
        composer.track(
          {
            kind: 'ticket_summary',
            section: 'Related Ticket Summaries',
            label: s.ticketTitle,
            provenance: `Ticket ${s.ticketStatus} — updated ${s.updatedAt.slice(0, 10)}`,
            sourceKind: 'ticket',
            sourceId: s.ticketId,
            ticketId: s.ticketId,
          },
          `---\n${s.content}\n`,
        );
      }
    }

    // Retrieved memory beyond summaries. Only the semantic engine produces this,
    // so the section is absent by default and appears the moment it is opted into.
    if (context.memorySnippets && context.memorySnippets.length > 0) {
      composer.scaffold('\n## Relevant Memory\n');
      composer.scaffold('Retrieved from past work across this instance. Each item states its source.\n');
      for (const snippet of context.memorySnippets) {
        composer.track(
          {
            kind: 'memory_snippet',
            section: 'Relevant Memory',
            label: snippet.title,
            provenance: memorySnippetProvenance(snippet),
            sourceKind: memorySnippetSourceKind(snippet.sourceKind),
            sourceId: snippet.sourceId,
            ticketId: snippet.ticketId ?? null,
            score: snippet.score,
          },
          `---\n### ${snippet.title}\n${snippet.content}\n`,
        );
      }
    }

    // Anchor the agent to its OWN task (the comment that created this mention).
    // Everything above is background context — including other comments that
    // @mention this agent, which are SEPARATE tasks handled one at a time. This
    // keeps later clarifications visible without letting one mention swallow the
    // others' requests into a single batched output.
    const ownComment = context.comments.find((c) => c.id === mention.commentId)?.body;
    const taskDescriptor = {
      kind: 'task_instruction' as const,
      section: 'Your task',
      label: isWakeUp ? 'Resuming after waiting for input' : `Request from ${mention.sourceAgent}`,
      sourceKind: 'comment' as const,
      sourceId: mention.commentId,
      ticketId: context.ticket.id,
    };
    if (isWakeUp) {
      composer.track(
        taskDescriptor,
        `\n---\n\n**Resuming your task.** You paused waiting for input. Review the latest activity on the ticket: `
        + `if it answers what you were waiting for, finish your task and resolve; if it redirects you, follow the new direction. `
        + `Stay focused on YOUR task${ownComment ? ' (your original request below)' : ''} — other comments that @mention you with different requests are separate queued tasks, not for now. `
        + `You MUST produce at least a comment or a deliverable — ask someone, escalate to a human, or move forward on your own.`
        + (ownComment ? `\n\n**Your original request** (from ${mention.sourceAgent}):\n> ${ownComment.replace(/\n/g, '\n> ')}` : ''),
      );
    } else {
      composer.track(
        taskDescriptor,
        `\n---\n\n**Your task** — respond to this request from ${mention.sourceAgent}:\n`
        + (ownComment ? `> ${ownComment.replace(/\n/g, '\n> ')}\n\n` : `(comment ${mention.commentId})\n\n`)
        + `Everything above is context. Other comments that @mention you with different requests are separate tasks, already queued and handled one at a time — do NOT answer them here. Focus only on the request above.`,
      );
    }

    return { blocks: composer.getBlocks(), manifest: composer.getManifest() };
  }

  /**
   * Resolve file references in text, returning content blocks with images as native ImageBlockParam.
   * Falls back to plain text block if file stores are not available.
   */
  private async resolveText(text: string): Promise<PromptContentBlock[]> {
    if (this.fileMetaStore && this.fileStore && text.includes('/api/files/')) {
      try {
        return await resolveFileReferences(text, this.fileMetaStore, this.fileStore);
      } catch {
        // Fallback to plain text
      }
    }
    return [{ type: 'text', text }];
  }
}
