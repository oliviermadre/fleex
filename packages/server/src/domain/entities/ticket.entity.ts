import type {
  Ticket,
  TicketStatus,
  TicketPriority,
  TicketType,
  TicketLink,
  TicketLinkType,
  GitHubIssueMetadata,
  ConversationMode,
  EffortLevel,
} from '@fleex/shared';
import { DEFAULT_CONVERSATION_MODE, isEffortLevel } from '@fleex/shared';

export class TicketEntity {
  constructor(
    public readonly id: string,
    public boardId: string,
    public displayId: number,
    public title: string,
    public description: string,
    public status: TicketStatus,
    public priority: TicketPriority,
    public type: TicketType | null,
    public position: number,
    public tags: string[],
    public links: TicketLink[],
    public blocked: boolean,
    public favorite: boolean,
    public dueDate: Date | null,
    public assignee: string | null,
    public agentClaimedAt: Date | null,
    public githubMetadata: GitHubIssueMetadata | null,
    public archivedAt: Date | null,
    public firstDoingAt: Date | null,
    public statusChangedAt: Date,
    public readonly createdAt: Date,
    public updatedAt: Date,
    // ── Conversation-scoped execution config (appended; default-backed so
    // existing positional callers keep compiling). ──
    public conversationMode: ConversationMode = DEFAULT_CONVERSATION_MODE,
    public modelOverride: string | null = null,
    public effortOverride: EffortLevel | null = null,
    public fastMode: boolean = false,
  ) {}

  static create(params: {
    id: string;
    boardId: string;
    displayId: number;
    title: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    type?: TicketType | null;
    position?: number;
    tags?: string[];
    links?: TicketLink[];
    dueDate?: Date | null;
  }): TicketEntity {
    const now = new Date();
    return new TicketEntity(
      params.id,
      params.boardId,
      params.displayId,
      params.title,
      params.description ?? '',
      params.status ?? 'backlog',
      params.priority ?? 'none',
      params.type ?? null,
      params.position ?? 0,
      params.tags ?? [],
      params.links ?? [],
      false,
      false,
      params.dueDate ?? null,
      null,
      null,
      null,
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
    type?: TicketType | null;
    position?: number;
    tags?: string[];
    blocked?: boolean;
    favorite?: boolean;
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
      if (changes.status === 'doing' && !this.firstDoingAt) {
        this.firstDoingAt = new Date();
        diff['firstDoingAt'] = { from: null, to: this.firstDoingAt.toISOString() };
      }
    }
    if (changes.priority !== undefined && changes.priority !== this.priority) {
      diff['priority'] = { from: this.priority, to: changes.priority };
      this.priority = changes.priority;
    }
    if (changes.type !== undefined && changes.type !== this.type) {
      diff['type'] = { from: this.type, to: changes.type };
      this.type = changes.type;
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
    if (changes.favorite !== undefined && changes.favorite !== this.favorite) {
      diff['favorite'] = { from: this.favorite, to: changes.favorite };
      this.favorite = changes.favorite;
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
      // Clear agent claim when manually reassigned to user or unassigned
      if (this.agentClaimedAt && (changes.assignee === 'user' || changes.assignee === null)) {
        diff['agentClaimedAt'] = { from: this.agentClaimedAt.toISOString(), to: null };
        this.agentClaimedAt = null;
      }
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
    const diff: Record<string, { from: unknown; to: unknown }> = { status: { from, to: status } };
    if (status === 'doing' && !this.firstDoingAt) {
      this.firstDoingAt = now;
      diff['firstDoingAt'] = { from: null, to: now.toISOString() };
    }
    return diff;
  }

  /**
   * Update the conversation-scoped execution config. Only the provided keys are
   * applied; `null` clears the model/effort override. Returns a diff so the
   * caller can broadcast/log it. Never creates a comment.
   */
  updateExecutionConfig(changes: {
    conversationMode?: ConversationMode;
    modelOverride?: string | null;
    effortOverride?: EffortLevel | null;
    fastMode?: boolean;
  }): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (
      changes.conversationMode !== undefined &&
      changes.conversationMode !== this.conversationMode
    ) {
      diff['conversationMode'] = { from: this.conversationMode, to: changes.conversationMode };
      this.conversationMode = changes.conversationMode;
    }
    if (changes.modelOverride !== undefined && changes.modelOverride !== this.modelOverride) {
      diff['modelOverride'] = { from: this.modelOverride, to: changes.modelOverride };
      this.modelOverride = changes.modelOverride;
    }
    // Ignore anything that isn't a known level, so an unvalidated API body can't
    // persist a value the SDK would 400 on. `null` (clear it) stays valid; the
    // level is still resolved against the model at execution time, since a model
    // change can leave a perfectly valid level above the new model's ceiling.
    const nextEffort =
      changes.effortOverride === undefined ||
      changes.effortOverride === null ||
      isEffortLevel(changes.effortOverride)
        ? changes.effortOverride
        : undefined;
    if (nextEffort !== undefined && nextEffort !== this.effortOverride) {
      diff['effortOverride'] = { from: this.effortOverride, to: nextEffort };
      this.effortOverride = nextEffort;
    }
    if (changes.fastMode !== undefined && changes.fastMode !== this.fastMode) {
      diff['fastMode'] = { from: this.fastMode, to: changes.fastMode };
      this.fastMode = changes.fastMode;
    }

    if (Object.keys(diff).length > 0) {
      this.updatedAt = new Date();
    }
    return diff;
  }

  setGithubMetadata(metadata: GitHubIssueMetadata | null): void {
    this.githubMetadata = metadata;
    this.updatedAt = new Date();
  }

  addLink(
    type: TicketLinkType,
    ref: string,
    label: string,
    url: string | null,
    linkId: string,
  ): TicketLink {
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

  archive(): Record<string, { from: unknown; to: unknown }> {
    const now = new Date();
    this.archivedAt = now;
    this.updatedAt = now;
    return { archivedAt: { from: null, to: now.toISOString() } };
  }

  unarchive(): Record<string, { from: unknown; to: unknown }> {
    const from = this.archivedAt?.toISOString() ?? null;
    const now = new Date();
    this.archivedAt = null;
    this.updatedAt = now;
    return { archivedAt: { from, to: null } };
  }

  toDTO(): Ticket {
    return {
      id: this.id,
      boardId: this.boardId,
      displayId: this.displayId,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      type: this.type,
      position: this.position,
      tags: this.tags,
      links: this.links,
      blocked: this.blocked,
      favorite: this.favorite,
      dueDate: this.dueDate?.toISOString() ?? null,
      assignee: this.assignee,
      agentClaimedAt: this.agentClaimedAt?.toISOString() ?? null,
      githubMetadata: this.githubMetadata,
      archivedAt: this.archivedAt?.toISOString() ?? null,
      firstDoingAt: this.firstDoingAt?.toISOString() ?? null,
      statusChangedAt: this.statusChangedAt.toISOString(),
      conversationMode: this.conversationMode,
      modelOverride: this.modelOverride,
      effortOverride: this.effortOverride,
      fastMode: this.fastMode,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
