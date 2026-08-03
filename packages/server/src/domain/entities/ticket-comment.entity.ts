import type { TicketComment, CommentVisibility } from '@fleex/shared';

const AGENT_MENTION_PATTERN = /@agent:([a-zA-Z0-9_-]+)/g;
const PANEL_MENTION_PATTERN = /@panel:([a-zA-Z0-9_-]+)/g;
const SKILL_MENTION_PATTERN = /@skill:([a-zA-Z0-9_-]+)/g;
const WORKFLOW_MENTION_PATTERN = /@workflow:([a-zA-Z0-9_-]+)/g;
const HUMAN_MENTION_PATTERN = /@([a-zA-Z0-9_-]+)/g;
// A ticket reference (@ticket:<displayId|uuid>) is purely referential — it must
// never be captured as an actionable mention. Only the human fallback could
// otherwise match its `@ticket` prefix, so we guard that one specific case.
const TICKET_REFERENCE_SUFFIX = /^:(?:\d+|[0-9a-fA-F-]{36})/;

export class TicketCommentEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly authorType: 'user' | 'agent',
    public readonly authorName: string,
    public body: string,
    public readonly visibility: CommentVisibility,
    public readonly privateRecipients: string[],
    public mentions: string[],
    public readonly parentId: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    authorType: 'user' | 'agent';
    authorName: string;
    body: string;
    visibility?: CommentVisibility;
    privateRecipients?: string[];
    parentId?: string | null;
  }): TicketCommentEntity {
    const now = new Date();
    const mentions = TicketCommentEntity.extractMentions(params.body);
    return new TicketCommentEntity(
      params.id,
      params.ticketId,
      params.authorType,
      params.authorName,
      params.body,
      params.visibility ?? 'public',
      params.privateRecipients ?? [],
      mentions,
      params.parentId ?? null,
      now,
      now,
    );
  }

  static extractMentions(body: string): string[] {
    const matches = new Set<string>();
    for (const match of body.matchAll(AGENT_MENTION_PATTERN)) {
      // Skip struck-through mentions: ~~@agent:name~~
      const prefix = match.index! >= 2 ? body.substring(match.index! - 2, match.index!) : '';
      if (prefix === '~~') continue;
      matches.add(match[1]!);
    }
    return Array.from(matches);
  }

  static extractPanelMentions(body: string): string[] {
    const matches = new Set<string>();
    for (const match of body.matchAll(PANEL_MENTION_PATTERN)) {
      // Skip struck-through mentions: ~~@panel:name~~
      const prefix = match.index! >= 2 ? body.substring(match.index! - 2, match.index!) : '';
      if (prefix === '~~') continue;
      matches.add(match[1]!);
    }
    return Array.from(matches);
  }

  static extractSkillMentions(body: string): string[] {
    const matches = new Set<string>();
    for (const match of body.matchAll(SKILL_MENTION_PATTERN)) {
      // Skip struck-through mentions: ~~@skill:name~~
      const prefix = match.index! >= 2 ? body.substring(match.index! - 2, match.index!) : '';
      if (prefix === '~~') continue;
      matches.add(match[1]!);
    }
    return Array.from(matches);
  }

  static extractWorkflowMentions(body: string): string[] {
    const matches = new Set<string>();
    for (const match of body.matchAll(WORKFLOW_MENTION_PATTERN)) {
      // Skip struck-through mentions: ~~@workflow:name~~
      const prefix = match.index! >= 2 ? body.substring(match.index! - 2, match.index!) : '';
      if (prefix === '~~') continue;
      matches.add(match[1]!);
    }
    return Array.from(matches);
  }

  static extractHumanMentions(body: string, humanNames: string[]): string[] {
    if (humanNames.length === 0) return [];
    const nameSet = new Set(humanNames.map((n) => n.toLowerCase()));
    const matches = new Set<string>();
    for (const match of body.matchAll(HUMAN_MENTION_PATTERN)) {
      const name = match[1]!;
      // Skip if this is an @agent:xxx, @panel:xxx, @skill:xxx, or @workflow:xxx mention (already captured)
      const prefix = body.substring(Math.max(0, match.index! - 10), match.index!);
      if (
        prefix.endsWith('@agent:') ||
        prefix.endsWith('@panel:') ||
        prefix.endsWith('@skill:') ||
        prefix.endsWith('@workflow:')
      )
        continue;
      // Skip ticket references: @ticket:378 / @ticket:<uuid> are links, not mentions
      // (even if a user happens to be named "ticket").
      if (
        name.toLowerCase() === 'ticket' &&
        TICKET_REFERENCE_SUFFIX.test(body.substring(match.index! + match[0].length))
      )
        continue;
      // Skip struck-through mentions: ~~@name~~
      const prefix2 = match.index! >= 2 ? body.substring(match.index! - 2, match.index!) : '';
      if (prefix2 === '~~') continue;
      if (nameSet.has(name.toLowerCase())) {
        matches.add(name);
      }
    }
    return Array.from(matches);
  }

  updateBody(body: string): void {
    this.body = body;
    this.mentions = TicketCommentEntity.extractMentions(body);
    this.updatedAt = new Date();
  }

  isVisibleTo(agentName: string): boolean {
    if (this.visibility === 'public') return true;
    if (this.authorName === agentName) return true;
    return this.privateRecipients.includes(agentName);
  }

  toDTO(): TicketComment {
    return {
      id: this.id,
      ticketId: this.ticketId,
      authorType: this.authorType,
      authorName: this.authorName,
      body: this.body,
      visibility: this.visibility,
      privateRecipients: this.privateRecipients,
      mentions: this.mentions,
      parentId: this.parentId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
