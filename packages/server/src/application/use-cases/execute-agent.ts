import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentExecutionResult, AgentEventType, AgentStructuredOutput } from '@asm/shared';
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
    this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'running' });

    const humanName = this.resolveHumanMentionName(persona);

    try {
      // 1. Acknowledge mention
      mention.acknowledge();
      await this.mentionStore.save(mention);

      // 1b. Claim ticket for agent
      const ticket = await this.ticketStore.getTicketById(mention.ticketId);
      if (ticket && ticket.assignee !== persona.name) {
        ticket.claim(persona.name);
        await this.ticketStore.saveTicket(ticket);
        this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
      }

      // 2. Start execution tracking
      await this.agentEventStore.startExecution({
        executionId,
        personaId: persona.id,
        ticketId: mention.ticketId,
        mentionId: mention.id,
      });

      // 3. Ensure worktree exists for agent work (needed before prompt composition)
      const worktreePath = await this.ensureWorktree(mention.ticketId);

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

      // 9. Call Claude Agent SDK
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

      for await (const message of query({
        prompt: userPrompt,
        options: queryOptions as Parameters<typeof query>[0]['options'],
      })) {
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

      // 9. Parse structured output — prefer SDK-validated output, fall back to text parser
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
            authorName: persona.name,
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
          authorName: persona.name,
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
      }

      // 13. Complete execution tracking
      await this.agentEventStore.completeExecution(executionId, 'completed');
      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'completed' });
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

      this.activeExecutions.set(mention.id, { mentionId: mention.id, executionId, personaId: persona.id, status: 'failed' });
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
   * Returns the filesystem path to the worktree, or the repo basePath if no repo is associated.
   *
   * Worktree links use `ref = "org/repo:branch"` (matching frontend convention),
   * `label = branchName`, and `url = filesystemPath`.
   */
  private async ensureWorktree(ticketId: string): Promise<string | null> {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) return null;

    // Resolve repository from board
    const board = await this.ticketStore.getBoardById(ticket.boardId);
    const hasRepo = !!(board?.repositoryOrg && board.repositoryName);
    const repoPath = hasRepo
      ? join(this.config.get().basePath, board!.repositoryOrg!, board!.repositoryName!)
      : null;

    // Check if ticket already has a worktree link — reuse it
    const existingWorktreeLink = ticket.links.find((l) => l.type === 'worktree');
    if (existingWorktreeLink) {
      // url stores the filesystem path (new convention)
      if (existingWorktreeLink.url) {
        return existingWorktreeLink.url;
      }
      // Legacy: ref is a filesystem path (starts with /)
      if (existingWorktreeLink.ref.startsWith('/')) {
        return existingWorktreeLink.ref;
      }
      // org/repo:branch ref without url — fall back to repo path
      return repoPath ?? this.config.get().basePath;
    }

    if (!hasRepo || !repoPath) {
      return this.config.get().basePath;
    }

    const slug = ticket.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const branchName = `agent/${ticket.displayId}-${slug}`;
    const wtPath = join(repoPath, '..', `${board!.repositoryName}.agent-${ticket.displayId}-${slug}`);

    try {
      const existingPath = await this.createWorktree.execute(repoPath, wtPath, {
        branch: branchName,
        createNewBranch: true,
      });
      const worktreePath = existingPath ?? wtPath;

      // Link worktree to ticket: ref=org/repo:branch, label=branch, url=filesystem path
      const ref = `${board!.repositoryOrg}/${board!.repositoryName}:${branchName}`;
      ticket.addLink('worktree', ref, branchName, worktreePath, randomUUID());
      await this.ticketStore.saveTicket(ticket);
      this.onTicketUpdate?.('ticket:updated', ticket.toDTO());

      this.logger.info('Agent worktree created', {
        ticketId, worktreePath, branchName, ref,
      });

      return worktreePath;
    } catch (err) {
      this.logger.warn('Failed to create agent worktree, using repo path', {
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      return repoPath;
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
