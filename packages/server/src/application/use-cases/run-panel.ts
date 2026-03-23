import { randomUUID } from 'node:crypto';
import { PanelNotFoundError, AgentPersonaNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { PanelEntity } from '../../domain/entities/panel.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { EventBus } from '../event-bus.js';

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

const DEFAULT_MEMBER_TIMEOUT_MS = 60_000; // 60s per member

export class RunPanelUseCase {
  public eventBus: EventBus | null = null;

  constructor(
    private readonly panelStore: PanelStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly postComment: PostCommentUseCase,
    private readonly submitDeliverable: SubmitDeliverableUseCase,
    private readonly getTicketContext: GetTicketContextUseCase,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Execute a panel discussion on a ticket.
   * Called by DomainEventListener when a @panel:name mention is created,
   * or by skill execution route.
   */
  async execute(params: {
    panelName: string;
    ticketId: string;
    mentionId?: string; // the mention that triggered this panel (if from @panel:name)
    topic?: string; // override topic (if not provided, derived from ticket)
  }): Promise<PanelResult> {
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
    const ticketContext = this.buildTicketContextString(context);

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
    const panelAuthor = `panel:${panel.name}`;
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

    // 5. Load all member personas
    const memberPersonas = await this.loadMemberPersonas(panel);

    // 6. Query all members in parallel via Messages API
    const memberResponses = await this.queryMembersInParallel(
      panel,
      memberPersonas,
      topic,
      ticketContext,
    );

    // 7. Generate synthesis via Messages API
    const synthesis = await this.generateSynthesis(
      panel,
      topic,
      memberResponses,
    );

    const durationMs = Date.now() - startTime;

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

    this.logger.info('Panel execution completed', {
      panelName: panel.name,
      ticketId: params.ticketId,
      durationMs,
      memberCount: memberResponses.length,
      failedMembers: memberResponses.filter((r) => r.error).length,
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

  private async queryMembersInParallel(
    panel: PanelEntity,
    memberPersonas: Map<string, AgentPersonaEntity>,
    topic: string,
    ticketContext: string,
  ): Promise<MemberResponse[]> {
    const sortedMembers = [...panel.members].sort((a, b) => a.order - b.order);

    const promises = sortedMembers.map(async (member) => {
      const persona = memberPersonas.get(member.personaId);
      if (!persona) {
        return {
          personaName: member.personaId,
          personaDisplayName: 'Unknown',
          emoji: '❓',
          response: '',
          model: '',
          durationMs: 0,
          error: `Persona not found: ${member.personaId}`,
        } satisfies MemberResponse;
      }

      // Resolve model: explicit override > persona model > default
      const model = member.modelOverride === 'inherited'
        ? (persona.model || panel.defaultMemberModel)
        : member.modelOverride;

      // Build the persona's display info from IDENTITY.md
      const identityEmoji = this.extractEmojiFromIdentity(persona.identityMd);

      return this.queryMember(persona, model, topic, ticketContext, identityEmoji);
    });

    return Promise.all(promises);
  }

  private async queryMember(
    persona: AgentPersonaEntity,
    model: string,
    topic: string,
    ticketContext: string,
    emoji: string,
  ): Promise<MemberResponse> {
    const startTime = Date.now();

    // Build system prompt from persona's soul + identity + memory
    const systemParts: string[] = [];
    if (persona.soulMd) systemParts.push(persona.soulMd);
    if (persona.identityMd) systemParts.push(persona.identityMd);
    if (persona.memoryMd) systemParts.push(persona.memoryMd);
    const systemPrompt = systemParts.join('\n\n---\n\n');

    const userPrompt = `# Panel Discussion Topic

**Subject:** ${topic}

## Ticket Context

${ticketContext}

---

As ${persona.displayName || persona.name}, share your expert perspective on this topic.
Be concise (3-5 paragraphs max) but incisive.
Raise the key points from your area of expertise.
If you disagree with the approach, explain why and propose alternatives.`;

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_MEMBER_TIMEOUT_MS);

      try {
        const message = await client.messages.create({
          model,
          max_tokens: 1500,
          system: systemPrompt || undefined,
          messages: [{ role: 'user', content: userPrompt }],
        }, { signal: controller.signal });

        clearTimeout(timeout);

        const responseText = message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { type: 'text'; text: string }).text)
          .join('\n');

        return {
          personaName: persona.name,
          personaDisplayName: persona.displayName || persona.name,
          emoji,
          response: responseText,
          model,
          durationMs: Date.now() - startTime,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Panel member query failed', {
        persona: persona.name,
        model,
        error: errorMsg,
      });

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
  ): Promise<string> {
    const validResponses = memberResponses.filter((r) => !r.error && r.response);

    if (validResponses.length === 0) {
      return `**${panel.displayName} — Synthesis**\n\n⚠️ No panel members responded successfully. Panel execution failed.`;
    }

    const responsesText = validResponses
      .map((r) => `### ${r.emoji} ${r.personaDisplayName}\n\n${r.response}`)
      .join('\n\n---\n\n');

    const synthesisPrompt = `You are synthesizing the opinions from a panel discussion on the following topic:

**Topic:** ${topic}

Here are the expert opinions:

${responsesText}

${panel.orchestratorPrompt ? `\nAdditional orchestrator instructions:\n${panel.orchestratorPrompt}\n` : ''}

Generate a structured synthesis in markdown with:
1. **Points of consensus** — What do the experts agree on?
2. **Points of divergence & identified risks** — Where do opinions differ? What risks were raised?
3. **Final recommendation** — Your decision-oriented recommendation
4. **Concrete next steps** — Actionable items

Be concise and decision-oriented. Write in the same language as the panel members' responses.
Format the output as a clean markdown section starting with the panel name.`;

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic();

      const message = await client.messages.create({
        model: panel.orchestratorModel,
        max_tokens: 2000,
        messages: [{ role: 'user', content: synthesisPrompt }],
      });

      const synthesisText = message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('\n');

      return `**🏛️ ${panel.displayName} — Synthesis**\n\n${synthesisText}`;
    } catch (err) {
      this.logger.error('Panel synthesis generation failed', {
        panelName: panel.name,
        error: err instanceof Error ? err.message : String(err),
      });

      // Fallback: list responses without synthesis
      return `**🏛️ ${panel.displayName} — Synthesis (auto-generated)**\n\n⚠️ Synthesis generation failed. Individual member responses are available in the full transcript deliverable.\n\n${validResponses.map((r) => `- **${r.emoji} ${r.personaDisplayName}** responded (${r.durationMs}ms)`).join('\n')}`;
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

  private buildTicketContextString(context: { ticket: { title: string; description: string }; comments: Array<{ authorName: string; body: string }>; deliverables: Array<{ title: string; type: string; content: string; status: string; agentName: string }> }): string {
    const parts: string[] = [];

    parts.push(`## Ticket: ${context.ticket.title}`);
    if (context.ticket.description) {
      parts.push('');
      parts.push(context.ticket.description);
    }

    if (context.comments.length > 0) {
      parts.push('');
      parts.push('## Recent Comments');
      // Include last 10 comments for context
      const recentComments = context.comments.slice(-10);
      for (const comment of recentComments) {
        parts.push('');
        parts.push(`**${comment.authorName}:**`);
        parts.push(comment.body);
      }
    }

    if (context.deliverables.length > 0) {
      parts.push('');
      parts.push('## Deliverables');
      for (const d of context.deliverables) {
        parts.push('');
        parts.push(`### [${d.status}] ${d.title} (${d.type}) by ${d.agentName}`);
        // Include first 2000 chars of deliverable content
        parts.push(d.content.length > 2000 ? d.content.substring(0, 2000) + '\n...(truncated)' : d.content);
      }
    }

    return parts.join('\n');
  }

  private extractEmojiFromIdentity(identityMd: string): string {
    // Try to extract emoji from IDENTITY.md (common pattern: "Emoji : 🔨")
    const emojiMatch = identityMd.match(/emoji\s*[:：]\s*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/iu);
    if (emojiMatch) return emojiMatch[1]!;

    // Try to find any emoji at the start of a line
    const lineEmoji = identityMd.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/mu);
    if (lineEmoji) return lineEmoji[1]!;

    return '💬';
  }
}
