import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentExecutionResult, AgentEventType, AgentStructuredOutput, MentionExecutionMode } from '@fleex/shared';
import { AgentPersonaNotFoundError } from '../../domain/errors.js';
import { buildTicketBranchName, buildTicketWorkspaceId, buildWorktreeDirName } from '../../domain/services/branch-utils.js';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import { parseAgentOutput } from '../utils/parse-agent-output.js';
import { buildSdkOptions } from '../utils/build-sdk-options.js';
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
import type { BareCloneManager } from '../services/bare-clone-manager.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import { resolveFileReferences, type PromptContentBlock } from '../utils/resolve-file-references.js';

interface ActiveExecution {
  mentionId: string;
  executionId: string;
  personaId: string;
  ticketId?: string;
  status: 'running' | 'completed' | 'failed';
  abortController: AbortController;
}

interface QueueItem {
  persona: AgentPersonaEntity;
  mention: TicketMentionEntity;
}

const STRUCTURED_OUTPUT_INSTRUCTIONS = `
# Output Format

Your final response will be structured as JSON with two fields:

- **deliverable**: Use when you have a tangible work product (code, analysis, document, PRD, etc.).
  Provide a short descriptive title, the full content as markdown, a type, and a status.
  Set to null if there is nothing to deliver.
- **deliverable.type**: Classify the deliverable. Must be one of:
  - \`"prd"\` — Product Requirements Document
  - \`"spec"\` — Technical specification or design document
  - \`"plan"\` — Implementation plan, roadmap, or action items
  - \`"code"\` — Code snippet, patch, or implementation
  - \`"report"\` — Analysis, audit, review, or research findings
  - \`"url"\` — External link (content should be the URL)
  - \`"ticket-summary"\` — Auto-generated ticket summary (system use only)
  Choose the type that best matches your output. When in doubt, use \`"report"\`.
- **deliverable.status**: Set to "draft" if your work has open questions, uncertainties, or
  needs human review before being acted upon. Set to "final" when the work is complete and
  ready for downstream consumption.
- **comment**: Use when you want to communicate in the ticket thread (status updates, questions,
  requesting another agent via \`@agent:name\`). Set to null if you have nothing to say.
- Put \`@agent:name\` mentions **only** in comment, never in deliverable.
- **mentionStatus**: Controls what happens to your mention after you finish.
  - \`"resolved"\` (default): your work is done, the mention is closed.
  - \`"waiting_for_info"\`: you need more information before you can finish. You will be automatically
    resumed when new content (comments, deliverables) is added to the ticket. You MUST produce at
    least a comment or a deliverable when using this status — explain what you need and from whom.
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

export class ExecuteAgentUseCase {
  private activeExecutions = new Map<string, ActiveExecution>();
  private sessionHistory = new Map<string, string>(); // `${agentName}:${ticketId}` -> sdkSessionId
  private runningCount = 0;
  private queue: QueueItem[] = [];

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
    private readonly skillStore?: SkillStorePort,
  ) {}

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

  get maxConcurrency(): number {
    return this.config.get().agentMaxConcurrency ?? 1;
  }

  async execute(personaId: string): Promise<AgentExecutionResult> {
    const persona = await this.personaStore.getById(personaId);
    if (!persona) {
      throw new AgentPersonaNotFoundError(personaId);
    }

    // Get pending mentions for this agent
    const pendingMentions = await this.mentionStore.getPendingForAgent(persona.name);

    // Filter out mentions already being executed or already queued
    const queuedMentionIds = new Set(this.queue.map((q) => q.mention.id));
    const workableMentions = pendingMentions.filter(
      (m) => !this.activeExecutions.has(m.id) && !queuedMentionIds.has(m.id),
    );

    if (workableMentions.length === 0) {
      return { status: 'no_work', mentionIds: [] };
    }

    // Enqueue all workable mentions
    const mentionIds: string[] = [];
    for (const mention of workableMentions) {
      this.queue.push({ persona, mention });
      mentionIds.push(mention.id);
    }

    // Drain queue up to maxConcurrency
    this.drainQueue();

    return { status: 'started', mentionIds };
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

    const persona = await this.personaStore.getByName(mention.targetAgent);
    if (!persona) {
      this.logger.warn('Cannot wake mention: persona not found', {
        mentionId: mention.id, targetAgent: mention.targetAgent,
      });
      return;
    }

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

    this.queue.push({ persona, mention });
    this.drainQueue();
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

    this.logger.info('Agent execution cancelled', { executionId, mentionId });
    return true;
  }

  /** Resolve human mention name: persona override → global config */
  private resolveHumanMentionName(persona: AgentPersonaEntity): string | null {
    if (persona.humanMentionName) return persona.humanMentionName;
    return this.config.get().humanMentionName ?? null;
  }

  private drainQueue(): void {
    while (this.runningCount < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.runningCount++;
      this.executeForMention(item.persona, item.mention).catch((err) => {
        this.logger.error('Agent execution failed', {
          persona: item.persona.name,
          mentionId: item.mention.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  private async executeForMention(
    persona: AgentPersonaEntity,
    mention: TicketMentionEntity,
  ): Promise<void> {
    const executionId = randomUUID();
    const abortController = new AbortController();
    this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'running', abortController });

    const humanName = this.resolveHumanMentionName(persona);

    try {
      // 0. Compute effective execution mode: min(mention grant, persona ceiling)
      const effectiveMode: MentionExecutionMode = persona.executionMode === 'message'
        ? 'talk'
        : mention.executionMode;

      // 1. Ensure worktree exists BEFORE acknowledging (skip for talk mode)
      let worktreePath: string | null = null;
      if (effectiveMode !== 'talk') {
        worktreePath = await this.ensureWorktree(mention.ticketId);
        if (!worktreePath && effectiveMode === 'edit') {
          // Edit mode requires a worktree — fail with feedback
          this.logger.error('Cannot start agent: no worktree could be resolved', {
            executionId, persona: persona.name, ticketId: mention.ticketId, mentionId: mention.id,
          });
          await this.agentEventStore.startExecution({
            executionId,
            personaId: persona.id,
            ticketId: mention.ticketId,
            mentionId: mention.id,
          });
          const errorEvent = AgentEventEntity.create({
            executionId,
            eventType: 'error',
            data: { error: 'No repository configured — cannot create worktree for edit mode' },
            sequence: 0,
          });
          await this.agentEventStore.appendEvent(errorEvent);
          this.onEvent?.(errorEvent);
          await this.agentEventStore.completeExecution(executionId, 'failed');
          this.activeExecutions.delete(mention.id);
          return;
        }
        if (!worktreePath) {
          this.logger.info('No worktree available, running agent without code access', {
            executionId, persona: persona.name, ticketId: mention.ticketId, mentionId: mention.id,
          });
        }
      }

      // 2. Acknowledge mention
      mention.acknowledge();
      await this.mentionStore.save(mention);
      this.eventBus?.emit({
        type: 'mention.acknowledged',
        mentionId: mention.id,
        ticketId: mention.ticketId,
        targetAgent: mention.targetAgent,
        occurredAt: new Date(),
      });

      // 2b. Claim ticket for agent
      const ticket = await this.ticketStore.getTicketById(mention.ticketId);
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
      });

      // 4. Compose system prompt from persona files
      const systemPrompt = this.composeSystemPrompt(persona, humanName, worktreePath);

      // 5. Load ticket context
      const context = await this.getTicketContext.execute({
        ticketId: mention.ticketId,
        agentName: persona.name,
      });

      // 6. Build user prompt with ticket context (content blocks for multimodal support)
      const sessionKey = `${persona.name}:${mention.ticketId}`;
      const isWakeUp = mention.status === 'pending' && this.sessionHistory.has(sessionKey);
      const userPromptBlocks = await this.composeUserPrompt(context, mention, isWakeUp);
      const userPromptTextLength = userPromptBlocks.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0);

      this.logger.info('Agent execution started', {
        executionId,
        persona: persona.name,
        model: persona.model,
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

      await emitEvent('execution_start', {
        executionId,
        personaId: persona.id,
        personaName: persona.name,
        ticketId: mention.ticketId,
        mentionId: mention.id,
        model: persona.model,
        effectiveMode,
        worktreePath,
        resumeSessionId: previousSessionId ?? null,
        context: {
          systemPromptSections: contextSections,
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPromptTextLength,
          ticketTitle: context.ticket.title,
          ticketStatus: context.ticket.status,
          commentsCount: context.comments.length,
          deliverablesCount: context.deliverables.length,
        },
      });

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

      const outputFormatSchema = {
        type: 'json_schema' as const,
        schema: {
          type: 'object',
          properties: {
            deliverable: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    markdown: { type: 'string' },
                    type: { type: 'string', enum: ['prd', 'spec', 'plan', 'code', 'report', 'url', 'ticket-summary'] },
                    status: { type: 'string', enum: ['draft', 'final'] },
                  },
                  required: ['title', 'markdown', 'type', 'status'],
                },
                { type: 'null' },
              ],
            },
            comment: {
              oneOf: [{ type: 'string' }, { type: 'null' }],
            },
            mentionStatus: {
              type: 'string',
              enum: ['resolved', 'waiting_for_info'],
              default: 'resolved',
            },
          },
          required: ['deliverable', 'comment'],
        },
      };

      {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const queryOptions = buildSdkOptions(effectiveMode, {
          model: persona.model,
          systemPrompt,
          cwd: worktreePath,
          outputFormat: outputFormatSchema,
          resume: previousSessionId ?? undefined,
        });

        // Build the prompt: use content blocks if there are images, plain string otherwise
        const hasImages = userPromptBlocks.some((b) => b.type === 'image');
        const userPrompt = hasImages
          ? userPromptBlocks  // Will be wrapped into SDKUserMessage below
          : userPromptBlocks.map((b) => (b as { text: string }).text).join('');

        const runQueryLoop = async () => {
          // If we have images, wrap blocks in an SDKUserMessage AsyncIterable
          const promptArg = Array.isArray(userPrompt)
            ? (async function* () {
                yield {
                  type: 'user' as const,
                  message: { role: 'user' as const, content: userPrompt },
                  parent_tool_use_id: null,
                  session_id: previousSessionId ?? '',
                };
              })()
            : userPrompt;

          for await (const message of query({
            prompt: promptArg,
            options: queryOptions as Parameters<typeof query>[0]['options'],
          })) {
            // Check abort signal between events
            if (abortController.signal.aborted) {
              break;
            }

            // Capture session ID from init message
            const msg = message as Record<string, unknown>;
            if (msg['type'] === 'system' && msg['subtype'] === 'init' && msg['session_id']) {
              sdkSessionId = msg['session_id'] as string;
              await emitEvent('turn_start', { sessionId: sdkSessionId });
            }

            // Capture final result + instrumentation
            if ('result' in message) {
              resultText = (message as { result: string }).result;

              // Use SDK's validated structured output if available
              if (msg['structured_output']) {
                structuredOutput = msg['structured_output'] as AgentStructuredOutput;
              }

              // Capture SDK instrumentation data from result message
              if (typeof msg['duration_ms'] === 'number') sdkDurationMs = msg['duration_ms'] as number;
              if (typeof msg['total_cost_usd'] === 'number') sdkCostUsd = msg['total_cost_usd'] as number;
              // Use modelUsage for token breakdown (cumulative per-model totals)
              const modelUsage = msg['modelUsage'] as Record<string, Record<string, number>> | undefined;
              if (modelUsage) {
                let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheCreation = 0;
                for (const mu of Object.values(modelUsage)) {
                  totalIn += mu['inputTokens'] ?? 0;
                  totalOut += mu['outputTokens'] ?? 0;
                  totalCacheRead += mu['cacheReadInputTokens'] ?? 0;
                  totalCacheCreation += mu['cacheCreationInputTokens'] ?? 0;
                }
                sdkInputTokens = totalIn;
                sdkOutputTokens = totalOut;
                sdkCacheReadTokens = totalCacheRead;
                sdkCacheCreationTokens = totalCacheCreation;
              }

              if (msg['subtype'] === 'error_max_structured_output_retries') {
                this.logger.warn('SDK structured output retries exhausted, falling back to parser', {
                  executionId,
                  persona: persona.name,
                });
              }

              await emitEvent('message_stop', {
                result: resultText,
                subtype: msg['subtype'] as string | undefined,
              });
            } else {
              // Store all other SDK messages as events
              await emitEvent('content_block_delta', msg);
            }
          }
        };

        try {
          await runQueryLoop();
        } catch (queryErr) {
          if (abortController.signal.aborted) {
            // Abort was triggered — handle below
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
            sdkSessionId = undefined;
            resultText = '';
            structuredOutput = null;
            await emitEvent('execution_retry', { reason: 'stale_resume_session', staleSessionId: previousSessionId });
            await runQueryLoop(); // If this also fails, propagates to outer catch
          } else {
            throw queryErr;
          }
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
        await emitEvent('execution_end', { status: 'interrupted', reason, ticketId: mention.ticketId });
        await this.agentEventStore.completeExecution(executionId, 'interrupted');
        this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'failed', abortController });
        mention.resetToPending();
        await this.mentionStore.save(mention);
        this.onExecutionComplete?.(persona.id, 'failed', mention.id);
        this.logger.info(`Agent execution ${reason}`, { executionId, persona: persona.name });
        return;
      }

      // 11. Parse structured output — prefer SDK-validated output, fall back to text parser
      const structured = structuredOutput ?? parseAgentOutput(resultText);

      await emitEvent('execution_end', {
        status: 'completed',
        ticketId: mention.ticketId,
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

      // 13. Complete execution tracking (with instrumentation)
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
      // Emit error event
      try {
        const errorEvent = AgentEventEntity.create({
          executionId,
          eventType: 'error',
          data: { error: err instanceof Error ? err.message : String(err) },
          sequence: 999999,
        });
        await this.agentEventStore.appendEvent(errorEvent);
        this.onEvent?.(errorEvent);
        await this.agentEventStore.completeExecution(executionId, 'failed');
      } catch {
        // Don't let event store errors mask the original error
      }

      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, ticketId: mention.ticketId, status: 'failed', abortController });
      this.onExecutionComplete?.(persona.id, 'failed', mention.id);
      this.logger.error('Agent execution failed', {
        executionId,
        persona: persona.name,
        mentionId: mention.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.runningCount--;
      // Clean up completed/failed executions after a delay
      setTimeout(() => {
        const exec = this.activeExecutions.get(mention.id);
        if (exec && exec.status !== 'running') {
          this.activeExecutions.delete(mention.id);
        }
      }, 30000);
      // Drain queue for next item
      this.drainQueue();
    }
  }

  /**
   * Execute a skill against a ticket.
   * This bypasses the mention lifecycle and runs the agent with the skill's markdown as instructions.
   */
  async executeForSkill(skillId: string, ticketId: string, opts?: {
    commentBody?: string;
    mentionId?: string;
  }): Promise<void> {
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
    const { comment: announceComment } = await this.postComment.execute({
      ticketId,
      body: announceBody,
      authorName: persona.displayName || persona.name,
      authorType: 'agent',
      humanMentionNames: [],
    });

    if (this.eventBus) {
      this.eventBus.emit({
        type: 'comment.posted',
        commentId: announceComment.id,
        ticketId,
        authorType: 'agent',
        authorName: persona.displayName || persona.name,
        createdMentions: [],
        occurredAt: new Date(),
      });
    }

    // 2. Try to resolve worktree (optional for skills — many don't need file access)
    const worktreePath = await this.ensureWorktree(ticketId);
    if (!worktreePath) {
      this.logger.info('Skill execution proceeding without worktree', { executionId, ticketId, skillId });
    }

    // 3. Start execution tracking
    await this.agentEventStore.startExecution({
      executionId,
      personaId: persona.id,
      ticketId,
      mentionId: `skill:${skillId}`,
    });

    // 4. Compose prompts
    const systemPrompt = this.composeSystemPrompt(persona, humanName, worktreePath);

    const context = await this.getTicketContext.execute({
      ticketId,
      agentName: persona.name,
    });

    const skillPromptBlocks = await this.composeSkillUserPrompt(context, skill.displayName, skill.markdownContent, opts?.commentBody);

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

    await emitEvent('execution_start', {
      executionId,
      personaId: persona.id,
      personaName: persona.name,
      ticketId,
      skillId,
      skillName: skill.commandName,
      model: persona.model,
      worktreePath,
    });

    // 6. Setup timeout + abort
    const timeoutMs = this.config.get().agentExecutionTimeout ?? 30 * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      this.logger.warn('Skill execution timed out', { executionId, persona: persona.name, timeoutMs });
      abortController.abort(new Error('timeout'));
    }, timeoutMs);

    try {
      // 7. Call Claude Agent SDK
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      let sdkSessionId: string | undefined;
      let resultText = '';
      let structuredOutput: AgentStructuredOutput | null = null;
      let sdkDurationMs: number | undefined;
      let sdkCostUsd: number | undefined;
      let sdkInputTokens: number | undefined;
      let sdkOutputTokens: number | undefined;
      let sdkCacheReadTokens: number | undefined;
      let sdkCacheCreationTokens: number | undefined;
      const effectiveMode = 'edit' as const;

      const sessionKey = `skill:${skill.commandName}:${ticketId}`;

      const queryOptions: Record<string, unknown> = {
        model: persona.model,
        systemPrompt,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        maxTurns: 150,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              deliverable: {
                oneOf: [
                  {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      markdown: { type: 'string' },
                      type: { type: 'string', enum: ['prd', 'spec', 'plan', 'code', 'report', 'url', 'ticket-summary'] },
                      status: { type: 'string', enum: ['draft', 'final'] },
                    },
                    required: ['title', 'markdown', 'type', 'status'],
                  },
                  { type: 'null' },
                ],
              },
              comment: {
                oneOf: [{ type: 'string' }, { type: 'null' }],
              },
              mentionStatus: {
                type: 'string',
                enum: ['resolved', 'waiting_for_info'],
                default: 'resolved',
              },
            },
            required: ['deliverable', 'comment'],
          },
        },
      };

      if (worktreePath) {
        queryOptions['cwd'] = worktreePath;
      }

      const previousSessionId = this.sessionHistory.get(sessionKey);
      if (previousSessionId) {
        queryOptions['resume'] = previousSessionId;
      }

      // Build prompt: content blocks if images, string otherwise
      const skillHasImages = skillPromptBlocks.some((b) => b.type === 'image');
      const skillPromptArg = skillHasImages
        ? (async function* () {
            yield {
              type: 'user' as const,
              message: { role: 'user' as const, content: skillPromptBlocks },
              parent_tool_use_id: null,
              session_id: previousSessionId ?? '',
            };
          })()
        : skillPromptBlocks.map((b) => (b as { text: string }).text).join('');

      for await (const message of query({
        prompt: skillPromptArg,
        options: queryOptions as Parameters<typeof query>[0]['options'],
      })) {
        if (abortController.signal.aborted) break;

        const msg = message as Record<string, unknown>;
        if (msg['type'] === 'system' && msg['subtype'] === 'init' && msg['session_id']) {
          sdkSessionId = msg['session_id'] as string;
          await emitEvent('turn_start', { sessionId: sdkSessionId });
        }

        if ('result' in message) {
          resultText = (message as { result: string }).result;
          if (msg['structured_output']) {
            structuredOutput = msg['structured_output'] as AgentStructuredOutput;
          }

          // Capture SDK instrumentation data from result message
          if (typeof msg['duration_ms'] === 'number') sdkDurationMs = msg['duration_ms'] as number;
          if (typeof msg['total_cost_usd'] === 'number') sdkCostUsd = msg['total_cost_usd'] as number;
          const modelUsage = msg['modelUsage'] as Record<string, Record<string, number>> | undefined;
          if (modelUsage) {
            let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheCreation = 0;
            for (const mu of Object.values(modelUsage)) {
              totalIn += mu['inputTokens'] ?? 0;
              totalOut += mu['outputTokens'] ?? 0;
              totalCacheRead += mu['cacheReadInputTokens'] ?? 0;
              totalCacheCreation += mu['cacheCreationInputTokens'] ?? 0;
            }
            sdkInputTokens = totalIn;
            sdkOutputTokens = totalOut;
            sdkCacheReadTokens = totalCacheRead;
            sdkCacheCreationTokens = totalCacheCreation;
          }

          await emitEvent('message_stop', { result: resultText, subtype: msg['subtype'] as string | undefined });
        } else {
          await emitEvent('content_block_delta', msg);
        }
      }

      clearTimeout(timeoutHandle);

      if (abortController.signal.aborted) {
        await emitEvent('execution_end', { status: 'interrupted', reason: 'timeout', ticketId });
        await this.agentEventStore.completeExecution(executionId, 'interrupted');
        return;
      }

      // 8. Store session for potential resume
      if (sdkSessionId) {
        this.sessionHistory.set(sessionKey, sdkSessionId);
        await this.agentEventStore.updateSessionId(executionId, sdkSessionId);
      }

      // 9. Process results — same as executeForMention
      const structured = structuredOutput ?? parseAgentOutput(resultText);
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
      });

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

            this.eventBus?.emit({
              type: 'deliverable.created',
              deliverableId: deliverable.id,
              ticketId,
              agentName: persona.name,
              status: structured.deliverable.status as 'draft' | 'final',
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

      await this.agentEventStore.completeExecution(executionId, 'completed');
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
        await this.agentEventStore.completeExecution(executionId, 'failed');
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
      // Clean up completed/failed executions after a delay
      setTimeout(() => {
        const exec = this.activeExecutions.get(skillMentionKey);
        if (exec && exec.status !== 'running') {
          this.activeExecutions.delete(skillMentionKey);
        }
      }, 30000);
    }
  }

  private async composeSkillUserPrompt(
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    skillDisplayName: string,
    skillMarkdown: string,
    commentBody?: string,
  ): Promise<PromptContentBlock[]> {
    const blocks: PromptContentBlock[] = [];
    const pushText = (text: string) => blocks.push({ type: 'text', text });

    pushText(`# Ticket: ${context.ticket.title}\nStatus: ${context.ticket.status} | Priority: ${context.ticket.priority}${context.ticket.type ? ` | Type: ${context.ticket.type}` : ''}`);

    if (context.ticket.description) {
      blocks.push(...await this.resolveText(`\n## Description\n\n${context.ticket.description}`));
    }

    if (context.comments.length > 0) {
      pushText('\n## Comments\n');
      for (const comment of context.comments) {
        blocks.push(...await this.resolveText(`**${comment.authorName}** (${comment.authorType}):\n${comment.body}\n`));
      }
    }

    if (context.deliverables.length > 0) {
      pushText('\n## Deliverables\n');
      for (const d of context.deliverables) {
        pushText(`### [${d.status}] ${d.title} (${d.type}) by ${d.agentName}\n`);
        if (d.content) {
          pushText(d.content);
        }
      }
    }

    if (commentBody) {
      pushText(`\n## Skill Arguments (from comment)\n${commentBody}`);
    }

    pushText(`\n---\n\n# Skill Instructions: ${skillDisplayName}\n\n${skillMarkdown}`);

    return blocks;
  }

  /**
   * Ensure a git worktree exists for agent work on the given ticket.
   * Returns the filesystem path to the worktree, or null if no repo/worktree could be resolved.
   *
   * Priority for resolving org/repo/branch:
   * 1. Ticket worktree link (source of truth) — if ref = "org/repo:branch", extract all three
   * 2. No repo resolved → return null (agent cannot start)
   */
  private async ensureWorktree(ticketId: string): Promise<string | null> {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) return null;

    // Collect all repos from ticket links
    const repoLinks = ticket.links.filter((l) => l.type === 'repository');
    const repos: { org: string; name: string }[] = [];
    for (const link of repoLinks) {
      const slashIdx = link.ref.indexOf('/');
      if (slashIdx > 0) {
        repos.push({ org: link.ref.substring(0, slashIdx), name: link.ref.substring(slashIdx + 1) });
      }
    }
    if (repos.length === 0) return null;

    // Determine branch: use existing worktree link's branch, or generate a new one
    const existingWorktreeLink = ticket.links.find((l) => l.type === 'worktree');
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

    // Create workspace + manifest
    const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
    const workspaceRoot = this.resolver!.workspacePath(workspaceId);
    mkdirSync(workspaceRoot, { recursive: true });
    const manifestPath = join(workspaceRoot, '.fleex.json');
    if (!existsSync(manifestPath)) {
      writeFileSync(manifestPath, JSON.stringify({ ticketId: ticket.id }, null, 2));
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

  private composeSystemPrompt(persona: AgentPersonaEntity, humanName: string | null, worktreePath: string | null = null): string {
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

    parts.push(STRUCTURED_OUTPUT_INSTRUCTIONS);

    if (humanName) {
      parts.push(
        `## Human Operator\n\n`
        + `To mention the human, you **MUST** use exactly \`@${humanName}\` — this is the only tag the system tracks. `
        + `Do NOT use any other form (no display name, no email, no variation). `
        + `Use \`@${humanName}\` whenever you need human input, decisions, or answers to open questions.`,
      );
    }

    if (worktreePath) {
      parts.push(
        `## Working Directory\n\n`
        + `Your working directory is:\n\`${worktreePath}\`\n\n`
        + `Always use relative paths (e.g. \`packages/server/src/...\`) or this exact path for absolute references. `
        + `Do NOT guess or infer the project root from other context — use this path.`,
      );
    }

    return parts.join('\n\n');
  }

  private async composeUserPrompt(
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    mention: TicketMentionEntity,
    isWakeUp = false,
  ): Promise<PromptContentBlock[]> {
    const blocks: PromptContentBlock[] = [];

    const pushText = (text: string) => blocks.push({ type: 'text', text });

    pushText(`# Ticket: ${context.ticket.title}\nStatus: ${context.ticket.status} | Priority: ${context.ticket.priority}${context.ticket.type ? ` | Type: ${context.ticket.type}` : ''}`);

    if (context.ticket.description) {
      const descBlocks = await this.resolveText(`\n## Description\n\n${context.ticket.description}`);
      blocks.push(...descBlocks);
    }

    if (context.comments.length > 0) {
      pushText('\n## Comments\n');
      for (const comment of context.comments) {
        const commentBlocks = await this.resolveText(`**${comment.authorName}** (${comment.authorType}):\n${comment.body}\n`);
        blocks.push(...commentBlocks);
      }
    }

    if (context.deliverables.length > 0) {
      pushText('\n## Deliverables\n');
      for (const d of context.deliverables) {
        pushText(`### [${d.status}] ${d.title} (${d.type}) by ${d.agentName}\n`);
        if (d.content) {
          pushText(d.content);
        }
      }
    }

    if (context.epics && context.epics.length > 0) {
      pushText('\n## Epics\n');
      for (const epic of context.epics) {
        pushText(`### ${epic.emoji} ${epic.name} (${epic.timeframe}, ${epic.groupStatus})\n`);
        if (epic.description) {
          blocks.push(...await this.resolveText(epic.description + '\n'));
        }
      }
    }

    if (context.relevantSummaries && context.relevantSummaries.length > 0) {
      pushText('\n## Related Ticket Summaries\n');
      pushText('Context from previously completed tickets — use to avoid reinventing solutions.\n');
      for (const s of context.relevantSummaries) {
        pushText(`---\n${s.content}\n`);
      }
    }

    if (isWakeUp) {
      pushText(`\n---\n\n**WAKE-UP: You previously indicated you were waiting for more information.** New content has been added to this ticket since then. Review the updated context above and continue your work. You MUST produce at least a comment or a deliverable — decide whether to ask someone else, escalate to a human, or move forward on your own.`);
    } else {
      pushText(`\n---\n\nYou were mentioned in comment ${mention.commentId} by ${mention.sourceAgent}. Please review the ticket context above and respond appropriately.`);
    }

    return blocks;
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
