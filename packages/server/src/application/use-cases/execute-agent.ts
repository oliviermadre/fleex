import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentExecutionResult, AgentEventType, AgentStructuredOutput } from '@fleex/shared';
import { AgentPersonaNotFoundError } from '../../domain/errors.js';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import { parseAgentOutput } from '../utils/parse-agent-output.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { ResolveMentionUseCase } from './resolve-mention.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

interface ActiveExecution {
  mentionId: string;
  executionId: string;
  personaId: string;
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

  /** Set by WS plugin to broadcast ticket updates */
  public onTicketUpdate: ((type: string, data: unknown) => void) | null = null;

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
    // Skip if already active
    if (this.activeExecutions.has(mention.id)) return;

    const persona = await this.personaStore.getByName(mention.targetAgent);
    if (!persona) {
      this.logger.warn('Cannot wake mention: persona not found', {
        mentionId: mention.id, targetAgent: mention.targetAgent,
      });
      return;
    }

    mention.wakeUp();
    await this.mentionStore.save(mention);

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
        data: { status: 'interrupted', reason: 'cancelled' },
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
    this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'running', abortController });

    const humanName = this.resolveHumanMentionName(persona);

    try {
      // 1. Ensure worktree exists BEFORE acknowledging (fail fast if no worktree)
      const worktreePath = await this.ensureWorktree(mention.ticketId);
      if (!worktreePath) {
        this.logger.error('Cannot start agent: no worktree could be resolved', {
          executionId, persona: persona.name, ticketId: mention.ticketId, mentionId: mention.id,
        });
        this.activeExecutions.delete(mention.id);
        return;
      }

      // 2. Acknowledge mention
      mention.acknowledge();
      await this.mentionStore.save(mention);
      this.onTicketUpdate?.('mention:acknowledged', mention.toDTO());

      // 2b. Claim ticket for agent
      const ticket = await this.ticketStore.getTicketById(mention.ticketId);
      if (ticket && ticket.assignee !== persona.name) {
        ticket.claim(persona.name);
        await this.ticketStore.saveTicket(ticket);
        this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
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

      // 6. Build user prompt with ticket context
      const sessionKey = `${persona.name}:${mention.ticketId}`;
      const isWakeUp = mention.status === 'pending' && this.sessionHistory.has(sessionKey);
      const userPrompt = this.composeUserPrompt(context, mention, isWakeUp);

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
        worktreePath,
        resumeSessionId: previousSessionId ?? null,
        context: {
          systemPromptSections: contextSections,
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPrompt.length,
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
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      let sdkSessionId: string | undefined;
      let resultText = '';
      let structuredOutput: AgentStructuredOutput | null = null;

      const queryOptions: Record<string, unknown> = {
        model: persona.model,
        systemPrompt,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        maxTurns: 50,
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
                      type: { type: 'string', enum: ['prd', 'spec', 'plan', 'code', 'report', 'url'] },
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

      if (previousSessionId) {
        queryOptions['resume'] = previousSessionId;
      }

      const runQueryLoop = async () => {
        for await (const message of query({
          prompt: userPrompt,
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

          // Capture final result
          if ('result' in message) {
            resultText = (message as { result: string }).result;

            // Use SDK's validated structured output if available
            if (msg['structured_output']) {
              structuredOutput = msg['structured_output'] as AgentStructuredOutput;
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
      } finally {
        clearTimeout(timeoutHandle);
      }

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
        await emitEvent('execution_end', { status: 'interrupted', reason });
        await this.agentEventStore.completeExecution(executionId, 'interrupted');
        this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'failed', abortController });
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
        resultLength: resultText.length,
        structuredOutputParsed: structured !== null,
      });

      // 10. Store session ID for future resume (in-memory + DB)
      if (sdkSessionId) {
        this.sessionHistory.set(sessionKey, sdkSessionId);
        await this.agentEventStore.updateSessionId(executionId, sdkSessionId);
      }

      // 11. Post result as comment + create deliverable
      let resultCommentId: string | undefined;
      let resultDeliverableId: string | undefined;

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

          // Auto-trigger mentioned agents
          for (const m of commentMentions) {
            if (m.targetType === 'agent') {
              const targetPersona = await this.personaStore.getByName(m.targetAgent);
              if (targetPersona) this.execute(targetPersona.id).catch(() => {});
            }
          }

          // Auto-assign ticket to human when mentioned by agent
          for (const m of commentMentions) {
            if (m.targetType === 'human' && ticket) {
              ticket.assign(m.targetAgent);
              await this.ticketStore.saveTicket(ticket);
              this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
            }
          }
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
            this.onTicketUpdate?.('deliverable:created', deliverable.toDTO());
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

        // Auto-trigger mentioned agents
        for (const m of fallbackMentions) {
          if (m.targetType === 'agent') {
            const targetPersona = await this.personaStore.getByName(m.targetAgent);
            if (targetPersona) this.execute(targetPersona.id).catch(() => {});
          }
        }

        // Auto-assign ticket to human when mentioned by agent
        for (const m of fallbackMentions) {
          if (m.targetType === 'human' && ticket) {
            ticket.assign(m.targetAgent);
            await this.ticketStore.saveTicket(ticket);
            this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
          }
        }
      }

      // 12. Resolve or park mention based on mentionStatus
      if (structured?.mentionStatus === 'waiting_for_info') {
        // Server-side enforcement: waiting_for_info requires at least a comment or deliverable
        if (!structured.comment && !structured.deliverable) {
          this.logger.warn('Agent set waiting_for_info but produced no output, forcing resolved', {
            executionId, persona: persona.name,
          });
          mention.resolve({ commentId: resultCommentId, deliverableId: resultDeliverableId });
          await this.mentionStore.save(mention);
          this.onTicketUpdate?.('mention:resolved', mention.toDTO());
        } else {
          mention.waitForInfo();
          await this.mentionStore.save(mention);
          // Auto-block ticket when agent waits for info
          if (ticket) {
            ticket.update({ blocked: true });
            await this.ticketStore.saveTicket(ticket);
            this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
          }
          this.onTicketUpdate?.('mention:waiting_for_info', mention.toDTO());
        }
      } else {
        mention.resolve({ commentId: resultCommentId, deliverableId: resultDeliverableId });
        await this.mentionStore.save(mention);
        this.onTicketUpdate?.('mention:resolved', mention.toDTO());
      }

      // 13. Complete execution tracking
      await this.agentEventStore.completeExecution(executionId, 'completed');
      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'completed', abortController });
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

      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'failed', abortController });
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
   * Ensure a git worktree exists for agent work on the given ticket.
   * Returns the filesystem path to the worktree, or null if no repo/worktree could be resolved.
   *
   * Priority for resolving org/repo/branch:
   * 1. Ticket worktree link (source of truth) — if ref = "org/repo:branch", extract all three
   * 2. Board config (fallback) — if no worktree link, use board.repositoryOrg/Name + generate branch
   * 3. No repo resolved → return null (agent cannot start)
   */
  private async ensureWorktree(ticketId: string): Promise<string | null> {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) return null;

    const board = await this.ticketStore.getBoardById(ticket.boardId);
    const existingWorktreeLink = ticket.links.find((l) => l.type === 'worktree');

    // Resolve org, repo, and branch — ticket worktree link is source of truth
    let org: string | null = null;
    let repo: string | null = null;
    let branchName: string;
    let createNewBranch: boolean;

    if (existingWorktreeLink) {
      if (existingWorktreeLink.ref.includes(':')) {
        // ref = "org/repo:branch" — extract all three
        const [orgRepo, branch] = existingWorktreeLink.ref.split(':');
        const [linkOrg, linkRepo] = orgRepo!.split('/');
        org = linkOrg!;
        repo = linkRepo!;
        branchName = branch!;
      } else {
        // label-only or legacy — use ticket repo link, then board as fallback
        branchName = existingWorktreeLink.label || existingWorktreeLink.ref;
        const repoLink = ticket.links.find((l) => l.type === 'repository');
        if (repoLink && repoLink.ref.includes('/')) {
          const [linkOrg, linkRepo] = repoLink.ref.split('/');
          org = linkOrg!;
          repo = linkRepo!;
        } else {
          org = board?.repositoryOrg ?? null;
          repo = board?.repositoryName ?? null;
        }
      }
      createNewBranch = false;
    } else {
      // No worktree link — check ticket repository link first, then board config
      const repoLink = ticket.links.find((l) => l.type === 'repository');
      if (repoLink && repoLink.ref.includes('/')) {
        const [linkOrg, linkRepo] = repoLink.ref.split('/');
        org = linkOrg!;
        repo = linkRepo!;
      } else {
        org = board?.repositoryOrg ?? null;
        repo = board?.repositoryName ?? null;
      }
      if (!org || !repo) return null;
      const slug = ticket.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      branchName = `agent/${ticket.displayId}-${slug}`;
      createNewBranch = true;
    }

    if (!org || !repo) return null;

    const repoPath = join(this.config.get().basePath, org, repo);

    // Ensure repo is cloned locally
    if (!existsSync(repoPath)) {
      this.logger.info('Cloning repository for agent worktree', {
        ticketId, repoPath, org, name: repo,
      });
      try {
        const remote = `git@github.com:${org}/${repo}.git`;
        const { execSync } = await import('node:child_process');
        execSync(`git clone ${remote} ${repoPath}`, { timeout: 120_000 });
      } catch (err) {
        this.logger.error('Failed to clone repository for agent', {
          ticketId, repoPath,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    // Derive worktree directory name from branch
    const branchSlug = branchName.replace(/\//g, '-');
    const wtPath = join(repoPath, '..', `${repo}.${branchSlug}`);

    // If worktree directory already exists on disk, reuse it directly
    if (existingWorktreeLink && existsSync(wtPath)) {
      this.logger.info('Agent worktree ready', {
        ticketId, worktreePath: wtPath, branchName, reused: true,
      });
      return wtPath;
    }

    // Create or reuse worktree
    try {
      const existingPath = await this.createWorktree.execute(repoPath, wtPath, {
        branch: branchName,
        createNewBranch,
      });
      const worktreePath = existingPath ?? wtPath;

      // If this is a new worktree (no link yet), add the link to the ticket
      if (!existingWorktreeLink) {
        const ref = `${org}/${repo}:${branchName}`;
        ticket.addLink('worktree', ref, branchName, worktreePath, randomUUID());
        await this.ticketStore.saveTicket(ticket);
        this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
      }

      this.logger.info('Agent worktree ready', {
        ticketId, worktreePath, branchName, reused: !!existingWorktreeLink,
      });

      return worktreePath;
    } catch (err) {
      this.logger.error('Failed to ensure agent worktree', {
        ticketId, branchName, wtPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
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

  private composeUserPrompt(
    context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
    mention: TicketMentionEntity,
    isWakeUp = false,
  ): string {
    const parts: string[] = [];

    parts.push(`# Ticket: ${context.ticket.title}`);
    parts.push(`Status: ${context.ticket.status} | Priority: ${context.ticket.priority}`);

    if (context.ticket.description) {
      parts.push(`\n## Description\n\n${context.ticket.description}`);
    }

    if (context.comments.length > 0) {
      parts.push('\n## Comments\n');
      for (const comment of context.comments) {
        parts.push(`**${comment.authorName}** (${comment.authorType}):\n${comment.body}\n`);
      }
    }

    if (context.deliverables.length > 0) {
      parts.push('\n## Deliverables\n');
      for (const d of context.deliverables) {
        parts.push(`### [${d.status}] ${d.title} (${d.type}) by ${d.agentName}\n`);
        if (d.content) {
          parts.push(d.content);
        }
      }
    }

    if (isWakeUp) {
      parts.push(`\n---\n\n**WAKE-UP: You previously indicated you were waiting for more information.** New content has been added to this ticket since then. Review the updated context above and continue your work. You MUST produce at least a comment or a deliverable — decide whether to ask someone else, escalate to a human, or move forward on your own.`);
    } else {
      parts.push(`\n---\n\nYou were mentioned in comment ${mention.commentId} by ${mention.sourceAgent}. Please review the ticket context above and respond appropriately.`);
    }

    return parts.join('\n');
  }
}
