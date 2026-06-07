import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PanelNotFoundError, AgentPersonaNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import { buildTicketBranchName, buildTicketWorkspaceId, buildWorktreeDirName } from '../../domain/services/branch-utils.js';
import type { PanelEntity } from '../../domain/entities/panel.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { EventBus } from '../event-bus.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { MentionExecutionMode } from '@fleex/shared';
import { normalizeDeliverableTypes } from '@fleex/shared';
import { buildSdkOptions } from '../utils/build-sdk-options.js';
import { parseAgentOutput } from '../utils/parse-agent-output.js';
import type { FileMetaStorePort } from '../ports/file-meta-store.port.js';
import type { FileStorePort } from '../ports/file-store.port.js';
import type { BareCloneManager } from '../services/bare-clone-manager.js';
import type { SdkConcurrencyLimiter } from '../services/sdk-concurrency-limiter.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import { resolveFileReferences, type PromptContentBlock } from '../utils/resolve-file-references.js';
import type { STANDARD_OUTPUT_SCHEMA } from '../utils/merge-output-schemas.js';

interface SdkMetrics {
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface MemberResponse {
  personaName: string;
  personaDisplayName: string;
  emoji: string;
  response: string;
  model: string;
  durationMs: number;
  error?: string;
}

export interface PanelResult {
  panelName: string;
  panelDisplayName: string;
  topic: string;
  memberResponses: MemberResponse[];
  synthesis: string;
  durationMs: number;
}

export class RunPanelUseCase {
  public eventBus: EventBus | null = null;
  public onEvent: ((event: AgentEventEntity) => void) | null = null;
  public fileMetaStore: FileMetaStorePort | null = null;
  public fileStore: FileStorePort | null = null;
  public bareCloneManager: BareCloneManager | null = null;
  public resolver: RepoPathResolver | null = null;

  constructor(
    private readonly panelStore: PanelStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly postComment: PostCommentUseCase,
    private readonly submitDeliverable: SubmitDeliverableUseCase,
    private readonly getTicketContext: GetTicketContextUseCase,
    private readonly createWorktree: CreateWorktreeUseCase,
    private readonly agentEventStore: AgentEventStorePort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
    private readonly sdkLimiter: SdkConcurrencyLimiter,
  ) {}

  /**
   * Execute a panel discussion on a ticket.
   * Called by DomainEventListener when a @panel:name mention is created,
   * or by skill execution route.
   *
   * When `returnStructured: true` is provided (workflow orchestrator path):
   *  - `extraContextPrompt` is appended to the orchestrator synthesis prompt
   *  - `outputFormatOverride` overrides the orchestrator's output schema
   *  - Returns `{ structuredOutput, executionId }` and skips all side effects
   *    (comment posts, deliverable creation, mention resolution, activity log)
   */
  async execute(params: {
    panelName: string;
    ticketId: string;
    mentionId?: string; // the mention that triggered this panel (if from @panel:name)
    topic?: string; // override topic (if not provided, derived from ticket)
    /** Workflow orchestrator: extra instructions injected into the synthesis prompt */
    extraContextPrompt?: string;
    /** Workflow orchestrator: override the orchestrator's output schema */
    outputFormatOverride?: typeof STANDARD_OUTPUT_SCHEMA;
    /** Workflow orchestrator: return structured output and skip all side effects */
    returnStructured?: boolean;
    /**
     * Workflow orchestrator: identifies the workflow run that triggered this
     * panel, so the announce comment is authored with a workflow-aware label
     * instead of the bare `panel:<name>`.
     */
    workflowContext?: { workflowName: string; stepName: string };
  }): Promise<PanelResult | { structuredOutput: Record<string, unknown> | null; executionId: string }> {
    const startTime = Date.now();

    // 1. Load panel config
    const panel = await this.panelStore.getByName(params.panelName);
    if (!panel) throw new PanelNotFoundError(params.panelName);
    if (!panel.enabled) throw new PanelNotFoundError(`Panel ${params.panelName} is disabled`);

    // 2. Load ticket context
    const context = await this.getTicketContext.execute({
      ticketId: params.ticketId,
      agentName: `panel:${panel.name}`,
    });

    const topic = params.topic || context.ticket.title;
    const ticketContextBlocks = await this.buildTicketContextBlocks(context);

    this.logger.info('Panel execution started', {
      panelName: panel.name,
      ticketId: params.ticketId,
      mentionId: params.mentionId,
      memberCount: panel.members.length,
    });

    // 3. Acknowledge mention if present
    if (params.mentionId) {
      const mention = await this.mentionStore.getById(params.mentionId);
      if (mention && mention.status === 'pending') {
        mention.acknowledge();
        await this.mentionStore.save(mention);

        if (this.eventBus) {
          this.eventBus.emit({
            type: 'mention.acknowledged',
            mentionId: mention.id,
            ticketId: params.ticketId,
            targetAgent: mention.targetAgent,
            occurredAt: new Date(),
          });
        }
      }
    }

    // 4. Post announcement comment
    const panelAuthor = params.workflowContext
      ? `workflow:${params.workflowContext.workflowName} → ${params.workflowContext.stepName}`
      : `panel:${panel.name}`;
    const { comment: announceComment } = await this.postComment.execute({
      ticketId: params.ticketId,
      body: `🏛️ **${panel.displayName}** — Panel discussion started on: **${topic}**\n\n_${panel.members.length} members participating..._`,
      authorName: panelAuthor,
      authorType: 'agent',
      humanMentionNames: [],
    });

    if (this.eventBus) {
      this.eventBus.emit({
        type: 'comment.posted',
        commentId: announceComment.id,
        ticketId: params.ticketId,
        authorType: 'agent',
        authorName: panelAuthor,
        createdMentions: [],
        occurredAt: new Date(),
      });
    }

    // 5. Ensure worktree exists (skip for message mode)
    let worktreePath: string | null = null;
    if (panel.executionMode !== 'message') {
      worktreePath = await this.ensureWorktree(params.ticketId);

      if (worktreePath) {
        this.logger.info('Panel has worktree access', { panelName: panel.name, worktreePath });
      } else {
        this.logger.warn('Panel has NO worktree — agents will not have code access', { panelName: panel.name });
      }
    }

    // 6. Load all member personas
    const memberPersonas = await this.loadMemberPersonas(panel);

    // 7. Query all members in parallel
    const panelMentionId = params.mentionId ?? `panel:${panel.id}:${randomUUID().slice(0, 8)}`;
    const memberResponses = await this.queryAllMembers(
      panel,
      memberPersonas,
      topic,
      ticketContextBlocks,
      worktreePath,
      params.ticketId,
      panelMentionId,
    );

    // 8. Generate synthesis
    const { text: synthesis, structuredOutput: synthStructured, executionId: synthExecutionId } = await this.generateSynthesis(
      panel,
      topic,
      memberResponses,
      worktreePath,
      params.ticketId,
      panelMentionId,
      params.extraContextPrompt,
      params.outputFormatOverride,
    );

    const durationMs = Date.now() - startTime;

    // Short-circuit for workflow orchestrator: skip side effects, return structured output
    if (params.returnStructured) {
      this.logger.info('Panel execution completed (structured return)', {
        panelName: panel.name,
        ticketId: params.ticketId,
        durationMs,
      });
      return { structuredOutput: synthStructured, executionId: synthExecutionId };
    }

    const result: PanelResult = {
      panelName: panel.name,
      panelDisplayName: panel.displayName,
      topic,
      memberResponses,
      synthesis,
      durationMs,
    };

    // 8. Post synthesis as comment
    const { comment: synthComment } = await this.postComment.execute({
      ticketId: params.ticketId,
      body: synthesis,
      authorName: panelAuthor,
      authorType: 'agent',
      parentId: announceComment.id,
      humanMentionNames: [],
    });

    if (this.eventBus) {
      this.eventBus.emit({
        type: 'comment.posted',
        commentId: synthComment.id,
        ticketId: params.ticketId,
        authorType: 'agent',
        authorName: panelAuthor,
        createdMentions: [],
        occurredAt: new Date(),
      });
    }

    // 9. Submit full transcript as deliverable
    const transcript = this.buildTranscript(panel, topic, memberResponses, synthesis, durationMs);
    const deliverable = await this.submitDeliverable.execute({
      ticketId: params.ticketId,
      agentName: panelAuthor,
      type: 'report',
      title: `${panel.displayName} — ${topic}`,
      content: transcript,
      status: 'final',
      mentionId: params.mentionId,
    });

    if (this.eventBus) {
      this.eventBus.emit({
        type: 'deliverable.created',
        deliverableId: deliverable.id,
        ticketId: params.ticketId,
        agentName: panelAuthor,
        status: 'final',
        title: deliverable.title,
        occurredAt: new Date(),
      });
    }

    // 10. Resolve mention if present
    if (params.mentionId) {
      const mention = await this.mentionStore.getById(params.mentionId);
      if (mention && mention.status !== 'resolved') {
        mention.resolve({
          commentId: synthComment.id,
          deliverableId: deliverable.id,
        });
        await this.mentionStore.save(mention);

        if (this.eventBus) {
          this.eventBus.emit({
            type: 'mention.resolved',
            mentionId: mention.id,
            ticketId: params.ticketId,
            targetAgent: mention.targetAgent,
            resolvedBy: panelAuthor,
            occurredAt: new Date(),
          });
        }
      }
    }

    // 11. Log activity
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      action: 'panel_executed',
      changes: {
        panelName: { from: null, to: panel.name },
        memberCount: { from: null, to: panel.members.length },
        durationMs: { from: null, to: durationMs },
      },
      actorType: 'agent',
      actorName: panelAuthor,
      source: 'api',
    }));

    const respondedMembers = memberResponses.filter((r) => !r.error && r.response).length;
    const failedMemberCount = memberResponses.filter((r) => r.error || !r.response).length;
    const panelStatus = respondedMembers > 0 ? 'completed' as const : 'failed' as const;

    // 12. Emit panel.executed domain event
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'panel.executed',
        panelId: panel.id,
        panelName: panel.name,
        panelDisplayName: panel.displayName,
        ticketId: params.ticketId,
        status: panelStatus,
        durationMs,
        memberCount: memberResponses.length,
        respondedMembers,
        failedMembers: failedMemberCount,
        occurredAt: new Date(),
      });
    }

    this.logger.info('Panel execution completed', {
      panelName: panel.name,
      ticketId: params.ticketId,
      status: panelStatus,
      durationMs,
      memberCount: memberResponses.length,
      respondedMembers,
      failedMembers: failedMemberCount,
    });

    return result;
  }

  private async loadMemberPersonas(panel: PanelEntity): Promise<Map<string, AgentPersonaEntity>> {
    const personas = new Map<string, AgentPersonaEntity>();
    for (const member of panel.members) {
      const persona = await this.personaStore.getById(member.personaId);
      if (persona) {
        personas.set(member.personaId, persona);
      } else {
        this.logger.warn('Panel member persona not found', {
          panelName: panel.name,
          personaId: member.personaId,
        });
      }
    }
    return personas;
  }

  private async queryAllMembers(
    panel: PanelEntity,
    memberPersonas: Map<string, AgentPersonaEntity>,
    topic: string,
    ticketContextBlocks: PromptContentBlock[],
    worktreePath: string | null,
    ticketId: string,
    mentionId: string,
  ): Promise<MemberResponse[]> {
    const sortedMembers = [...panel.members].sort((a, b) => a.order - b.order);
    this.logger.info('Panel members starting', {
      panelName: panel.name,
      members: sortedMembers.map((m) => memberPersonas.get(m.personaId)?.name ?? m.personaId),
      hasWorktree: !!worktreePath,
    });

    // All members are dispatched at once; the global SdkConcurrencyLimiter (one
    // limit shared with mentions/skills/workflows) decides how many actually run
    // in parallel — no per-panel batching or fixed pause anymore.
    return Promise.all(
      sortedMembers.map((member) => {
        const persona = memberPersonas.get(member.personaId);
        if (!persona) {
          return Promise.resolve({
            personaName: member.personaId,
            personaDisplayName: 'Unknown',
            emoji: '❓',
            response: '',
            model: '',
            durationMs: 0,
            error: `Persona not found: ${member.personaId}`,
          } satisfies MemberResponse);
        }

        const model = member.modelOverride === 'inherited'
          ? (persona.model || panel.defaultMemberModel)
          : member.modelOverride;

        const identityEmoji = this.extractEmojiFromIdentity(persona.identityMd);
        const panelMode: MentionExecutionMode = panel.executionMode === 'message' ? 'talk' : 'edit';

        return this.sdkLimiter.run(async () => {
          const response = await this.queryMember(persona, model, topic, ticketContextBlocks, identityEmoji, worktreePath, panelMode, ticketId, mentionId);

          this.logger.info('Panel member completed', {
            persona: persona.name,
            model,
            responseLength: response.response.length,
            hasError: !!response.error,
            durationMs: response.durationMs,
          });

          return response;
        });
      }),
    );
  }

  private async querySDK(
    prompt: string | PromptContentBlock[],
    options: {
      model: string;
      systemPrompt?: string;
      cwd?: string | null;
      maxTurns?: number;
      effectiveMode?: MentionExecutionMode;
      outputFormat?: Record<string, unknown>;
    },
  ): Promise<{ text: string; structuredOutput: Record<string, unknown> | null; metrics: SdkMetrics }> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const mode = options.effectiveMode ?? 'edit';

    const queryOptions = buildSdkOptions(mode, {
      model: options.model,
      systemPrompt: options.systemPrompt ?? '',
      cwd: options.cwd,
      outputFormat: options.outputFormat,
    });

    // For non-talk modes, override maxTurns if explicitly provided
    if (mode !== 'talk' && options.maxTurns !== undefined) {
      queryOptions.maxTurns = options.maxTurns;
    }

    let resultText = '';
    let structuredOutput: Record<string, unknown> | null = null;
    let messageCount = 0;
    const metrics: SdkMetrics = {};

    // If content blocks (multimodal), wrap in SDKUserMessage async iterable
    const promptArg = Array.isArray(prompt)
      ? (async function* () {
          yield {
            type: 'user' as const,
            message: { role: 'user' as const, content: prompt },
            parent_tool_use_id: null,
            session_id: '',
          };
        })()
      : prompt;

    for await (const message of query({
      prompt: promptArg,
      options: queryOptions as Parameters<typeof query>[0]['options'],
    })) {
      messageCount++;
      const msg = message as Record<string, unknown>;
      if (messageCount <= 3 || 'result' in message) {
        this.logger.debug('SDK message', {
          type: msg['type'],
          subtype: msg['subtype'],
          hasResult: 'result' in message,
          messageCount,
        });
      }
      if ('result' in message) {
        resultText = (message as { result: string }).result;
        // Capture structured output when outputFormat was requested
        if (msg['structured_output']) {
          structuredOutput = msg['structured_output'] as Record<string, unknown>;
        }
        // Capture instrumentation from SDK result message
        if (typeof msg['duration_ms'] === 'number') metrics.durationMs = msg['duration_ms'] as number;
        if (typeof msg['total_cost_usd'] === 'number') metrics.costUsd = msg['total_cost_usd'] as number;
        const modelUsage = msg['modelUsage'] as Record<string, Record<string, number>> | undefined;
        if (modelUsage) {
          let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheCreation = 0;
          for (const mu of Object.values(modelUsage)) {
            totalIn += mu['inputTokens'] ?? 0;
            totalOut += mu['outputTokens'] ?? 0;
            totalCacheRead += mu['cacheReadInputTokens'] ?? 0;
            totalCacheCreation += mu['cacheCreationInputTokens'] ?? 0;
          }
          metrics.inputTokens = totalIn;
          metrics.outputTokens = totalOut;
          metrics.cacheReadTokens = totalCacheRead;
          metrics.cacheCreationTokens = totalCacheCreation;
        }
      }
    }
    this.logger.info('SDK query done', {
      model: options.model,
      mode,
      messageCount,
      resultLength: resultText.length,
      costUsd: metrics.costUsd,
    });
    return { text: resultText, structuredOutput, metrics };
  }

  private async queryMember(
    persona: AgentPersonaEntity,
    model: string,
    topic: string,
    ticketContextBlocks: PromptContentBlock[],
    emoji: string,
    worktreePath: string | null,
    effectiveMode: MentionExecutionMode,
    ticketId: string,
    mentionId: string,
  ): Promise<MemberResponse> {
    const startTime = Date.now();
    const executionId = randomUUID();

    // Track execution + emit event for real-time UI
    await this.agentEventStore.startExecution({
      executionId,
      personaId: persona.id,
      ticketId,
      mentionId,
    });

    const startEvent = AgentEventEntity.create({
      executionId,
      eventType: 'execution_start',
      data: { executionId, personaId: persona.id, personaName: persona.name, ticketId, mentionId, model },
      sequence: 0,
    });
    await this.agentEventStore.appendEvent(startEvent);
    this.onEvent?.(startEvent);

    // Build system prompt from persona's soul + identity + memory
    const systemParts: string[] = [];
    if (persona.soulMd) systemParts.push(persona.soulMd);
    if (persona.identityMd) systemParts.push(persona.identityMd);
    if (persona.memoryMd) systemParts.push(persona.memoryMd);
    const systemPrompt = systemParts.join('\n\n---\n\n');

    const codeAccessInstructions = worktreePath
      ? `\n\nYou have access to the codebase. Use Read, Grep, Glob to inspect relevant files. You can run \`gh pr view\` or \`gh pr diff\` via Bash to review the PR if one exists. Ground your analysis in the actual code.`
      : '';

    // Build content blocks for multimodal support
    const promptBlocks: PromptContentBlock[] = [
      { type: 'text', text: `# Panel Discussion Topic\n\n**Subject:** ${topic}\n\n## Ticket Context\n` },
      ...ticketContextBlocks,
      { type: 'text', text: `${codeAccessInstructions}\n\n---\n\nAs ${persona.displayName || persona.name}, share your expert perspective on this topic.\nBe concise (3-5 paragraphs max) but incisive.\nRaise the key points from your area of expertise.\nIf you disagree with the approach, explain why and propose alternatives.` },
    ];

    const hasImages = promptBlocks.some((b) => b.type === 'image');
    const userPrompt = hasImages ? promptBlocks : promptBlocks.map((b) => (b as { text: string }).text).join('');

    try {
      const { text, metrics } = await this.querySDK(userPrompt, {
        model,
        systemPrompt: systemPrompt || undefined,
        cwd: worktreePath,
        maxTurns: worktreePath ? 150 : 10,
        effectiveMode,
      });

      await this.agentEventStore.completeExecution(executionId, 'completed', {
        model,
        effectiveMode,
        ...metrics,
      });

      const endEvent = AgentEventEntity.create({
        executionId,
        eventType: 'execution_end',
        data: { status: 'completed', ticketId, effectiveMode, model, ...metrics },
        sequence: 1,
      });
      await this.agentEventStore.appendEvent(endEvent);
      this.onEvent?.(endEvent);

      return {
        personaName: persona.name,
        personaDisplayName: persona.displayName || persona.name,
        emoji,
        response: text,
        model,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Panel member query failed', {
        persona: persona.name,
        model,
        error: errorMsg,
      });

      await this.agentEventStore.completeExecution(executionId, 'failed', { model, effectiveMode });

      const failEvent = AgentEventEntity.create({
        executionId,
        eventType: 'execution_end',
        data: { status: 'failed', ticketId, effectiveMode, model, error: errorMsg },
        sequence: 1,
      });
      await this.agentEventStore.appendEvent(failEvent);
      this.onEvent?.(failEvent);

      return {
        personaName: persona.name,
        personaDisplayName: persona.displayName || persona.name,
        emoji,
        response: '',
        model,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };
    }
  }

  private async generateSynthesis(
    panel: PanelEntity,
    topic: string,
    memberResponses: MemberResponse[],
    worktreePath: string | null,
    ticketId: string,
    mentionId: string,
    extraContextPrompt?: string,
    outputFormatOverride?: typeof STANDARD_OUTPUT_SCHEMA,
  ): Promise<{ text: string; structuredOutput: Record<string, unknown> | null; executionId: string }> {
    const validResponses = memberResponses.filter((r) => !r.error && r.response);

    if (validResponses.length === 0) {
      const fallbackText = `**${panel.displayName} — Synthesis**\n\n⚠️ No panel members responded successfully. Panel execution failed.`;
      return { text: fallbackText, structuredOutput: null, executionId: randomUUID() };
    }

    const responsesText = validResponses
      .map((r) => `## ${r.emoji} ${r.personaDisplayName}\n\n${r.response}`)
      .join('\n\n---\n\n');

    // Orchestrator persona system prompt
    let orchestratorSystemPrompt: string | undefined;
    if (panel.orchestratorPersonaId) {
      const orchestratorPersona = await this.personaStore.getById(panel.orchestratorPersonaId);
      if (orchestratorPersona) {
        const parts: string[] = [];
        if (orchestratorPersona.soulMd) parts.push(orchestratorPersona.soulMd);
        if (orchestratorPersona.identityMd) parts.push(orchestratorPersona.identityMd);
        if (orchestratorPersona.memoryMd) parts.push(orchestratorPersona.memoryMd);
        if (parts.length > 0) {
          orchestratorSystemPrompt = parts.join('\n\n---\n\n');
        }
      }
    }

    const synthesisPrompt = `# Panel Discussion — ${panel.displayName}

**Topic:** ${topic}

## Expert Opinions

${responsesText}

---

${panel.orchestratorPrompt ? `${panel.orchestratorPrompt}\n\n` : ''}Synthesize the expert opinions above in markdown:
1. **Points of consensus**
2. **Points of divergence & identified risks**
3. **Final recommendation**
4. **Concrete next steps**

Be concise and decision-oriented. Write in the same language as the panel members' responses.${extraContextPrompt ? `\n\n---\n\n${extraContextPrompt}` : ''}`;

    const executionId = randomUUID();
    const orchestratorPersonaId = panel.orchestratorPersonaId ?? `orchestrator:${panel.id}`;
    const effectiveMode: MentionExecutionMode = panel.executionMode === 'message' ? 'talk' : 'edit';

    await this.agentEventStore.startExecution({
      executionId,
      personaId: orchestratorPersonaId,
      ticketId,
      mentionId,
    });

    // Broadcast orchestrator start so the Execution Log can show it live.
    const orchestratorPersonaForEvent = panel.orchestratorPersonaId
      ? await this.personaStore.getById(panel.orchestratorPersonaId)
      : null;
    const startEvent = AgentEventEntity.create({
      executionId,
      eventType: 'execution_start',
      data: {
        executionId,
        personaId: orchestratorPersonaId,
        personaName: orchestratorPersonaForEvent?.name ?? panel.name,
        ticketId,
        mentionId,
        model: panel.orchestratorModel,
      },
      sequence: 0,
    });
    await this.agentEventStore.appendEvent(startEvent);
    this.onEvent?.(startEvent);

    try {
      const { text, structuredOutput: rawStructured, metrics } = await this.querySDK(synthesisPrompt, {
        model: panel.orchestratorModel,
        systemPrompt: orchestratorSystemPrompt,
        cwd: worktreePath,
        effectiveMode,
        outputFormat: outputFormatOverride,
      });

      await this.agentEventStore.completeExecution(executionId, 'completed', {
        model: panel.orchestratorModel,
        effectiveMode,
        ...metrics,
      });

      const endEvent = AgentEventEntity.create({
        executionId,
        eventType: 'execution_end',
        data: { status: 'completed', ticketId, effectiveMode, model: panel.orchestratorModel, ...metrics },
        sequence: 1,
      });
      await this.agentEventStore.appendEvent(endEvent);
      this.onEvent?.(endEvent);

      const validTypes = normalizeDeliverableTypes(this.config.get().deliverableTypes)
        .filter((t) => !t.system)
        .map((t) => t.id);
      const structuredOutput = (rawStructured ?? parseAgentOutput(text, { validTypes })) as Record<string, unknown> | null;
      return { text: `**🏛️ ${panel.displayName} — Synthesis**\n\n${text}`, structuredOutput, executionId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Panel synthesis generation failed', {
        panelName: panel.name,
        error: errorMsg,
      });

      await this.agentEventStore.completeExecution(executionId, 'failed', { model: panel.orchestratorModel, effectiveMode });

      const failEvent = AgentEventEntity.create({
        executionId,
        eventType: 'execution_end',
        data: { status: 'failed', ticketId, effectiveMode, model: panel.orchestratorModel, error: errorMsg },
        sequence: 1,
      });
      await this.agentEventStore.appendEvent(failEvent);
      this.onEvent?.(failEvent);

      const fallbackText = `**🏛️ ${panel.displayName} — Synthesis (auto-generated)**\n\n⚠️ Synthesis generation failed. Individual member responses are available in the full transcript deliverable.\n\n${validResponses.map((r) => `- **${r.emoji} ${r.personaDisplayName}** responded (${r.durationMs}ms)`).join('\n')}`;
      return { text: fallbackText, structuredOutput: null, executionId };
    }
  }

  private buildTranscript(
    panel: PanelEntity,
    topic: string,
    memberResponses: MemberResponse[],
    synthesis: string,
    durationMs: number,
  ): string {
    const date = new Date().toISOString().split('T')[0];
    const parts: string[] = [
      `# ${panel.displayName} — Panel Transcript`,
      '',
      `**Date**: ${date}`,
      `**Topic**: ${topic}`,
      `**Duration**: ${Math.round(durationMs / 1000)}s`,
      `**Members**: ${memberResponses.length}`,
      '',
      '---',
      '',
      '## Expert Opinions',
      '',
    ];

    for (const member of memberResponses) {
      parts.push(`### ${member.emoji} ${member.personaDisplayName}`);
      parts.push(`*Model: ${member.model} — ${Math.round(member.durationMs / 1000)}s*`);
      parts.push('');
      if (member.error) {
        parts.push(`⚠️ **Error**: ${member.error}`);
      } else {
        parts.push(member.response);
      }
      parts.push('');
      parts.push('---');
      parts.push('');
    }

    parts.push('## Synthesis');
    parts.push('');
    parts.push(synthesis);
    parts.push('');
    parts.push('---');
    parts.push(`*Generated by Fleex Panel Orchestrator — ${panel.displayName}*`);

    return parts.join('\n');
  }

  private async buildTicketContextBlocks(context: { ticket: { title: string; description: string }; comments: Array<{ authorName: string; body: string }>; deliverables: Array<{ title: string; type: string; content: string; status: string; agentName: string }>; epics?: Array<{ name: string; emoji: string; description: string; timeframe: string; groupStatus: string }> }): Promise<PromptContentBlock[]> {
    const blocks: PromptContentBlock[] = [];
    const pushText = (text: string) => blocks.push({ type: 'text', text });

    pushText(`## Ticket: ${context.ticket.title}`);
    if (context.ticket.description) {
      blocks.push(...await this.resolveText(`\n${context.ticket.description}`));
    }

    if (context.comments.length > 0) {
      pushText('\n## Recent Comments');
      const recentComments = context.comments.slice(-10);
      for (const comment of recentComments) {
        blocks.push(...await this.resolveText(`\n**${comment.authorName}:**\n${comment.body}`));
      }
    }

    if (context.deliverables.length > 0) {
      pushText('\n## Deliverables');
      for (const d of context.deliverables) {
        pushText(`\n### [${d.status}] ${d.title} (${d.type}) by ${d.agentName}`);
        pushText(d.content.length > 2000 ? d.content.substring(0, 2000) + '\n...(truncated)' : d.content);
      }
    }

    if (context.epics && context.epics.length > 0) {
      pushText('\n## Epics');
      for (const epic of context.epics) {
        pushText(`\n### ${epic.emoji} ${epic.name} (${epic.timeframe}, ${epic.groupStatus})`);
        if (epic.description) {
          blocks.push(...await this.resolveText(epic.description));
        }
      }
    }

    return blocks;
  }

  private async resolveText(text: string): Promise<PromptContentBlock[]> {
    if (this.fileMetaStore && this.fileStore && text.includes('/api/files/')) {
      try {
        return await resolveFileReferences(text, this.fileMetaStore, this.fileStore);
      } catch {
        // Fallback
      }
    }
    return [{ type: 'text', text }];
  }

  private extractEmojiFromIdentity(identityMd: string): string {
    const emojiMatch = identityMd.match(/emoji\s*[:：]\s*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/iu);
    if (emojiMatch) return emojiMatch[1]!;
    const lineEmoji = identityMd.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/mu);
    if (lineEmoji) return lineEmoji[1]!;
    return '💬';
  }

  /**
   * Ensure a worktree exists for the ticket (same logic as ExecuteAgentUseCase).
   * Creates the worktree on-the-fly if it doesn't exist yet.
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
      if (existsSync(wtPath)) continue;

      const barePath = this.resolver!.barePath(repo.org, repo.name);
      if (!existsSync(barePath)) {
        try {
          await this.bareCloneManager!.ensureBareClone(repo.org, repo.name);
        } catch (err) {
          this.logger.warn('Failed to clone repository for panel', {
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
        this.logger.info('Panel worktree ready', { ticketId, repo: `${repo.org}/${repo.name}`, wtPath, branch: usedBranch });
      } catch (err) {
        this.logger.warn('Failed to create panel worktree', {
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
}
