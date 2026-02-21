import type { TicketComment, CommentVisibility } from '@asm/shared';

const MENTION_PATTERN = /@agent:([a-zA-Z0-9_-]+)/g;

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
    for (const match of body.matchAll(MENTION_PATTERN)) {
      matches.add(match[1]!);
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
