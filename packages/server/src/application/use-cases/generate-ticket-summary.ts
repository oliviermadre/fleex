import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { TicketStatus } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a technical summarizer. Generate a concise ticket summary (~400 words max) for developer memory.

Structure your output EXACTLY as follows:

## Ticket Summary: {title}

**Status:** done | cancelled
**Closed at:** {date}

### Problem
1-2 sentences: the problem addressed or the reason for cancellation.

### Solution
What was done — outcomes and results, not low-level implementation details.

### Key Decisions
- Decision — Rationale (only if meaningful decisions were made)

### Files & Components Touched
- \`path/to/file\` — role (from git diff if available, keep to ~10 most important)

### Pitfalls & Resolutions
- Issue → How resolved (only if relevant pitfalls were encountered)

### Closure Reason
Why done or cancelled.

Rules:
- Max 400 words total
- No conversational back-and-forth from comments
- No low-level implementation details (no stack traces, no raw diffs)
- If cancelled with no work done: only fill Problem + Closure Reason sections
- Be factual, not speculative — only describe what actually happened
- Omit any section that has no meaningful content (except Problem and Closure Reason which are always required)`.trim();

export class GenerateTicketSummaryUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: { ticketId: string; status: TicketStatus }): Promise<void> {
    const { ticketId, status } = params;

    if (status !== 'done' && status !== 'cancelled') return;

    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) {
      this.logger.warn('Ticket not found for summary generation', { ticketId });
      return;
    }

    this.logger.info('Generating ticket summary', { ticketId, status, title: ticket.title });

    // Gather full context
    const comments = await this.commentStore.getByTicket(ticketId);
    const deliverables = await this.deliverableStore.getByTicket(ticketId);

    // Resolve git context from worktree link
    let gitLog = '';
    let gitDiff = '';
    try {
      const resolved = await this.resolveWorktreeInfo(ticket);
      if (resolved) {
        const { repoPath, branch } = resolved;
        [gitLog, gitDiff] = await Promise.all([
          this.git.getLogOneline(repoPath, branch),
          this.git.getDiffSummary(repoPath, branch),
        ]);
      }
    } catch (err) {
      this.logger.debug('Failed to get git context for summary', {
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Build user prompt
    const userPrompt = this.buildPrompt(ticket, comments, deliverables, gitLog, gitDiff);

    // Call Claude via Agent SDK (same auth as all other agents — no API key needed)
    let summaryText: string;
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      let resultText = '';
      for await (const message of query({
        prompt: userPrompt,
        options: {
          model: MODEL,
          systemPrompt: SYSTEM_PROMPT,
          allowedTools: [],
          permissionMode: 'dontAsk' as const,
          maxTurns: 0,
        },
      })) {
        if ('result' in message) {
          resultText = (message as { result: string }).result;
        }
      }
      if (!resultText) {
        this.logger.error('Empty summary response', { ticketId });
        return;
      }
      summaryText = resultText;
    } catch (err) {
      this.logger.error('Claude Agent SDK call failed for ticket summary', {
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Upsert deliverable
    const existing = await this.deliverableStore.getByTicketAndType(ticketId, 'ticket-summary');
    if (existing) {
      existing.update({ content: summaryText, title: `Summary: ${ticket.title}`, status: 'final' });
      await this.deliverableStore.save(existing);
      this.logger.info('Ticket summary updated', { ticketId, deliverableId: existing.id, version: existing.version });
    } else {
      const deliverable = TicketDeliverableEntity.create({
        id: randomUUID(),
        ticketId,
        agentName: 'system',
        type: 'ticket-summary',
        title: `Summary: ${ticket.title}`,
        content: summaryText,
        status: 'final',
      });
      await this.deliverableStore.save(deliverable);
      this.logger.info('Ticket summary created', { ticketId, deliverableId: deliverable.id });
    }
  }

  private buildPrompt(
    ticket: { title: string; description: string; status: string; tags: string[]; displayId: number },
    comments: Array<{ toDTO(): { authorName: string; authorType: string; body: string } }>,
    deliverables: Array<{ toDTO(): { title: string; type: string; content: string; agentName: string; status: string } }>,
    gitLog: string,
    gitDiff: string,
  ): string {
    const parts: string[] = [];

    parts.push(`# Ticket #${ticket.displayId}: ${ticket.title}`);
    parts.push(`Status: ${ticket.status}`);
    if (ticket.tags.length > 0) {
      parts.push(`Tags: ${ticket.tags.join(', ')}`);
    }

    if (ticket.description) {
      parts.push(`\n## Description\n\n${ticket.description}`);
    }

    if (comments.length > 0) {
      parts.push('\n## Comments\n');
      for (const c of comments) {
        const dto = c.toDTO();
        parts.push(`**${dto.authorName}** (${dto.authorType}):\n${dto.body}\n`);
      }
    }

    // Include deliverables except ticket-summary itself
    const relevantDeliverables = deliverables.filter((d) => d.toDTO().type !== 'ticket-summary');
    if (relevantDeliverables.length > 0) {
      parts.push('\n## Deliverables\n');
      for (const d of relevantDeliverables) {
        const dto = d.toDTO();
        parts.push(`### [${dto.status}] ${dto.title} (${dto.type}) by ${dto.agentName}\n`);
        if (dto.content) {
          parts.push(dto.content);
        }
      }
    }

    if (gitLog) {
      parts.push(`\n## Git Commits\n\n\`\`\`\n${gitLog}\n\`\`\``);
    }

    if (gitDiff) {
      parts.push(`\n## Git Diff Summary\n\n\`\`\`\n${gitDiff}\n\`\`\``);
    }

    parts.push('\n---\nGenerate the ticket summary now.');

    return parts.join('\n');
  }

  private async resolveWorktreeInfo(
    ticket: { boardId: string; links: Array<{ type: string; ref: string; label: string }> },
  ): Promise<{ repoPath: string; branch: string } | null> {
    const worktreeLink = ticket.links.find((l) => l.type === 'worktree');
    if (!worktreeLink) return null;

    let org: string | null = null;
    let repo: string | null = null;
    let branch: string;

    if (worktreeLink.ref.includes(':')) {
      const [orgRepo, branchPart] = worktreeLink.ref.split(':');
      const [linkOrg, linkRepo] = orgRepo!.split('/');
      org = linkOrg!;
      repo = linkRepo!;
      branch = branchPart!;
    } else {
      branch = worktreeLink.label || worktreeLink.ref;
      const repoLink = ticket.links.find((l) => l.type === 'repository');
      if (repoLink && repoLink.ref.includes('/')) {
        const [linkOrg, linkRepo] = repoLink.ref.split('/');
        org = linkOrg!;
        repo = linkRepo!;
      } else {
        const board = await this.ticketStore.getBoardById(ticket.boardId);
        org = board?.repositoryOrg ?? null;
        repo = board?.repositoryName ?? null;
      }
    }

    if (!org || !repo) return null;

    const repoPath = join(this.config.get().basePath, org, repo);
    return { repoPath, branch };
  }
}
