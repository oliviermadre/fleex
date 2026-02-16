import type { Ticket, TicketStatus, TicketPriority, TicketLink, TicketLinkType } from '@asm/shared';

export class TicketEntity {
  constructor(
    public readonly id: string,
    public boardId: string,
    public title: string,
    public description: string,
    public status: TicketStatus,
    public priority: TicketPriority,
    public position: number,
    public tags: string[],
    public links: TicketLink[],
    public blocked: boolean,
    public dueDate: Date | null,
    public assignee: string | null,
    public agentClaimedAt: Date | null,
    public statusChangedAt: Date,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    boardId: string;
    title: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    position?: number;
    tags?: string[];
    links?: TicketLink[];
    dueDate?: Date | null;
  }): TicketEntity {
    const now = new Date();
    return new TicketEntity(
      params.id,
      params.boardId,
      params.title,
      params.description ?? '',
      params.status ?? 'backlog',
      params.priority ?? 'none',
      params.position ?? 0,
      params.tags ?? [],
      params.links ?? [],
      false,
      params.dueDate ?? null,
      null,
      null,
      now,
      now,
      now,
    );
  }

  update(changes: {
    boardId?: string;
    title?: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    position?: number;
    tags?: string[];
    blocked?: boolean;
    dueDate?: Date | null;
    assignee?: string | null;
  }): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (changes.boardId !== undefined && changes.boardId !== this.boardId) {
      diff['boardId'] = { from: this.boardId, to: changes.boardId };
      this.boardId = changes.boardId;
    }
    if (changes.title !== undefined && changes.title !== this.title) {
      diff['title'] = { from: this.title, to: changes.title };
      this.title = changes.title;
    }
    if (changes.description !== undefined && changes.description !== this.description) {
      diff['description'] = { from: this.description, to: changes.description };
      this.description = changes.description;
    }
    if (changes.status !== undefined && changes.status !== this.status) {
      diff['status'] = { from: this.status, to: changes.status };
      this.status = changes.status;
      this.statusChangedAt = new Date();
    }
    if (changes.priority !== undefined && changes.priority !== this.priority) {
      diff['priority'] = { from: this.priority, to: changes.priority };
      this.priority = changes.priority;
    }
    if (changes.position !== undefined && changes.position !== this.position) {
      diff['position'] = { from: this.position, to: changes.position };
      this.position = changes.position;
    }
    if (changes.tags !== undefined) {
      diff['tags'] = { from: this.tags, to: changes.tags };
      this.tags = changes.tags;
    }
    if (changes.blocked !== undefined && changes.blocked !== this.blocked) {
      diff['blocked'] = { from: this.blocked, to: changes.blocked };
      this.blocked = changes.blocked;
    }
    if (changes.dueDate !== undefined) {
      const fromStr = this.dueDate?.toISOString() ?? null;
      const toStr = changes.dueDate?.toISOString() ?? null;
      if (fromStr !== toStr) {
        diff['dueDate'] = { from: fromStr, to: toStr };
        this.dueDate = changes.dueDate;
      }
    }
    if (changes.assignee !== undefined && changes.assignee !== this.assignee) {
      diff['assignee'] = { from: this.assignee, to: changes.assignee };
      this.assignee = changes.assignee;
    }

    if (Object.keys(diff).length > 0) {
      this.updatedAt = new Date();
    }

    return diff;
  }

  moveTo(status: TicketStatus): Record<string, { from: unknown; to: unknown }> {
    const from = this.status;
    if (from === status) return {};
    this.status = status;
    const now = new Date();
    this.statusChangedAt = now;
    this.updatedAt = now;
    return { status: { from, to: status } };
  }

  addLink(type: TicketLinkType, ref: string, label: string, url: string | null, linkId: string): TicketLink {
    const link: TicketLink = {
      id: linkId,
      type,
      ref,
      label,
      url,
      createdAt: new Date().toISOString(),
    };
    this.links = [...this.links, link];
    this.updatedAt = new Date();
    return link;
  }

  removeLink(linkId: string): boolean {
    const before = this.links.length;
    this.links = this.links.filter((l) => l.id !== linkId);
    if (this.links.length !== before) {
      this.updatedAt = new Date();
      return true;
    }
    return false;
  }

  claim(agentName: string): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    diff['assignee'] = { from: this.assignee, to: agentName };
    this.assignee = agentName;
    this.agentClaimedAt = new Date();
    diff['agentClaimedAt'] = { from: null, to: this.agentClaimedAt.toISOString() };

    if (this.status === 'backlog' || this.status === 'todo') {
      diff['status'] = { from: this.status, to: 'doing' };
      this.status = 'doing';
      this.statusChangedAt = new Date();
    }

    this.updatedAt = new Date();
    return diff;
  }

  unclaim(): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (this.agentClaimedAt) {
      diff['agentClaimedAt'] = { from: this.agentClaimedAt.toISOString(), to: null };
      this.agentClaimedAt = null;
    }
    if (this.assignee) {
      diff['assignee'] = { from: this.assignee, to: null };
      this.assignee = null;
    }
    this.updatedAt = new Date();
    return diff;
  }

  assign(name: string): Record<string, { from: unknown; to: unknown }> {
    const from = this.assignee;
    this.assignee = name;
    this.updatedAt = new Date();
    return { assignee: { from, to: name } };
  }

  unassign(): Record<string, { from: unknown; to: unknown }> {
    const from = this.assignee;
    this.assignee = null;
    this.updatedAt = new Date();
    return { assignee: { from, to: null } };
  }

  toDTO(): Ticket {
    return {
      id: this.id,
      boardId: this.boardId,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      position: this.position,
      tags: this.tags,
      links: this.links,
      blocked: this.blocked,
      dueDate: this.dueDate?.toISOString() ?? null,
      assignee: this.assignee,
      agentClaimedAt: this.agentClaimedAt?.toISOString() ?? null,
      statusChangedAt: this.statusChangedAt.toISOString(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
