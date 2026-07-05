import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { TicketStatus, TicketType, TicketLinkType, TicketLink, GitHubIssueMetadata, ConversationMode, EffortLevel } from '@fleex/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../../application/ports/ticket-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
const MAX_ACTIVITY_ENTRIES = 5000;

/** Map legacy 14-type values to new 6-type system */
const LEGACY_TYPE_MAP: Record<string, TicketType> = {
  feat: 'build', refactor: 'build', perf: 'build', test: 'build',
  ci: 'build', chore: 'build', task: 'build',
  fix: 'fix', review: 'review', ops: 'ops',
  doc: 'think', research: 'think', design: 'think', data: 'think',
};

interface SerializedBoard {
  id: string;
  name: string;
  emoji: string;
  /** @deprecated — kept for backward-compat in older boards.json files; unused */
  nextDisplayId?: number;
  createdAt: string;
  updatedAt: string;
}

interface SerializedTicket {
  id: string;
  boardId: string;
  displayId: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: string;
  type?: TicketType | null;
  position: number;
  tags: string[];
  links: TicketLink[];
  blocked: boolean;
  favorite?: boolean;
  dueDate: string | null;
  assignee: string | null;
  agentClaimedAt: string | null;
  githubMetadata?: GitHubIssueMetadata | null;
  archivedAt?: string | null;
  firstDoingAt?: string | null;
  statusChangedAt?: string;
  conversationMode?: ConversationMode;
  modelOverride?: string | null;
  effortOverride?: EffortLevel | null;
  fastMode?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SerializedActivity {
  id: string;
  ticketId: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  actorType: 'user' | 'agent';
  actorName: string | null;
  source: 'web' | 'api';
  createdAt: string;
}

export class JsonTicketStore implements TicketStorePort {
  private readonly boards = new Map<string, BoardEntity>();
  private readonly tickets = new Map<string, TicketEntity>();
  private readonly activities: TicketActivityEntity[] = [];
  private readonly projectsDir: string;
  private readonly boardsFile: string;
  private readonly ticketsFile: string;
  private readonly activityFile: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.projectsDir = join(this.homedir, FLEEX_DIR, 'projects');
    this.boardsFile = join(this.projectsDir, 'boards.json');
    this.ticketsFile = join(this.projectsDir, 'tickets.json');
    this.activityFile = join(this.projectsDir, 'activity.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!(await this.hostFs.exists(this.projectsDir))) {
      await this.hostFs.mkdir(this.projectsDir);
    }
    await this.loadFromDisk();
    this.initialized = true;
  }

  // ── Boards ──

  async getAllBoards(): Promise<BoardEntity[]> {
    return Array.from(this.boards.values());
  }

  async getBoardById(id: string): Promise<BoardEntity | null> {
    return this.boards.get(id) ?? null;
  }

  async saveBoard(board: BoardEntity): Promise<void> {
    this.boards.set(board.id, board);
    await this.syncBoardsToDisk();
  }

  async removeBoard(id: string): Promise<void> {
    this.boards.delete(id);
    await this.syncBoardsToDisk();
  }

  // ── Tickets ──

  async getAllTickets(): Promise<TicketEntity[]> {
    return Array.from(this.tickets.values()).filter((t) => t.archivedAt === null);
  }

  async getTicketById(id: string): Promise<TicketEntity | null> {
    return this.tickets.get(id) ?? null;
  }

  async getTicketByDisplayId(displayId: number): Promise<TicketEntity | null> {
    // Spans archived tickets (no archivedAt filter) — display ids are globally
    // unique and `ticket unarchive` needs to resolve an archived ticket.
    return Array.from(this.tickets.values()).find((t) => t.displayId === displayId) ?? null;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    return Array.from(this.tickets.values())
      .filter((t) => t.boardId === boardId && t.archivedAt === null)
      .sort((a, b) => a.position - b.position);
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    return (await this.getTicketsByBoard(boardId)).filter((t) => t.status === status);
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    return Array.from(this.tickets.values()).filter((t) =>
      t.links.some((l) => l.type === type && l.ref === ref),
    );
  }

  async createTicket(ticket: TicketEntity): Promise<void> {
    ticket.displayId = this.computeNextDisplayId();
    this.tickets.set(ticket.id, ticket);
    await this.syncTicketsToDisk();
  }

  async saveTicket(ticket: TicketEntity): Promise<void> {
    this.tickets.set(ticket.id, ticket);
    await this.syncTicketsToDisk();
  }

  private computeNextDisplayId(): number {
    let max = 0;
    for (const t of this.tickets.values()) {
      if (t.displayId > max) max = t.displayId;
    }
    return max + 1;
  }

  async removeTicket(id: string): Promise<void> {
    this.tickets.delete(id);
    await this.syncTicketsToDisk();
  }

  async removeTicketsByBoard(boardId: string): Promise<void> {
    for (const [id, t] of this.tickets) {
      if (t.boardId === boardId) this.tickets.delete(id);
    }
    await this.syncTicketsToDisk();
  }

  // ── Agent queries ──

  async getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null> {
    let candidates = Array.from(this.tickets.values()).filter(
      (t) => t.status === 'todo' && !t.blocked && t.archivedAt === null,
    );
    if (boardId) {
      candidates = candidates.filter((t) => t.boardId === boardId);
    }
    candidates.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.position - b.position;
    });
    return candidates[0] ?? null;
  }

  async getClaimedByAgent(agentName: string): Promise<TicketEntity[]> {
    return Array.from(this.tickets.values()).filter(
      (t) => t.assignee === agentName && t.status === 'doing' && t.archivedAt === null,
    );
  }

  async getArchivedTickets(boardId?: string, limit = 50, offset = 0): Promise<TicketEntity[]> {
    let archived = Array.from(this.tickets.values()).filter((t) => t.archivedAt !== null);
    if (boardId) archived = archived.filter((t) => t.boardId === boardId);
    archived.sort((a, b) => (b.archivedAt!.getTime()) - (a.archivedAt!.getTime()));
    return archived.slice(offset, offset + limit);
  }

  async countArchivedTickets(boardId?: string): Promise<number> {
    let archived = Array.from(this.tickets.values()).filter((t) => t.archivedAt !== null);
    if (boardId) archived = archived.filter((t) => t.boardId === boardId);
    return archived.length;
  }

  // ── Activity ──

  async saveActivity(entry: TicketActivityEntity): Promise<void> {
    this.activities.push(entry);
    // Cap activity entries
    if (this.activities.length > MAX_ACTIVITY_ENTRIES) {
      this.activities.splice(0, this.activities.length - MAX_ACTIVITY_ENTRIES);
    }
    await this.syncActivityToDisk();
  }

  async getActivitiesByTicket(ticketId: string, limit = 50): Promise<TicketActivityEntity[]> {
    return this.activities
      .filter((a) => a.ticketId === ticketId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async searchTicketsByActivityFilters(options: {
    since?: Date;
    until?: Date;
    action?: string;
    limit?: number;
  }): Promise<TicketActivityEntity[]> {
    let filtered = this.activities;

    if (options.since) {
      const sinceTime = options.since.getTime();
      filtered = filtered.filter((a) => a.createdAt.getTime() >= sinceTime);
    }
    if (options.until) {
      const untilTime = options.until.getTime();
      filtered = filtered.filter((a) => a.createdAt.getTime() <= untilTime);
    }
    if (options.action) {
      filtered = filtered.filter((a) => a.action === options.action);
    }

    return filtered
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit ?? 200);
  }

  // ── Persistence ──

  private async loadFromDisk(): Promise<void> {
    await this.loadBoards();
    await this.loadTickets();
    await this.loadActivity();
  }

  private async loadBoards(): Promise<void> {
    if (!(await this.hostFs.exists(this.boardsFile))) return;
    try {
      const raw = await this.hostFs.readFile(this.boardsFile);
      const data = JSON.parse(raw) as SerializedBoard[];
      for (const b of data) {
        const entity = new BoardEntity(
          b.id, b.name, b.emoji,
          new Date(b.createdAt), new Date(b.updatedAt),
        );
        this.boards.set(entity.id, entity);
      }
      this.logger.info('Board store loaded', { count: this.boards.size });
    } catch (err) {
      this.logger.warn('Failed to load boards from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadTickets(): Promise<void> {
    if (!(await this.hostFs.exists(this.ticketsFile))) return;
    try {
      const raw = await this.hostFs.readFile(this.ticketsFile);
      const data = JSON.parse(raw) as SerializedTicket[];
      for (const t of data) {
        const entity = new TicketEntity(
          t.id, t.boardId, t.displayId ?? 0, t.title, t.description,
          t.status, t.priority as TicketEntity['priority'],
          (t.type ? (LEGACY_TYPE_MAP[t.type] ?? t.type as TicketType) : null),
          t.position, t.tags, t.links, t.blocked, t.favorite ?? false,
          t.dueDate ? new Date(t.dueDate) : null,
          t.assignee,
          t.agentClaimedAt ? new Date(t.agentClaimedAt) : null,
          t.githubMetadata ?? null,
          t.archivedAt ? new Date(t.archivedAt) : null,
          t.firstDoingAt ? new Date(t.firstDoingAt) : null,
          new Date(t.statusChangedAt ?? t.updatedAt),
          new Date(t.createdAt), new Date(t.updatedAt),
          t.conversationMode ?? 'plan',
          t.modelOverride ?? null,
          t.effortOverride ?? null,
          t.fastMode ?? false,
        );
        this.tickets.set(entity.id, entity);
      }
      this.logger.info('Ticket store loaded', { count: this.tickets.size });
    } catch (err) {
      this.logger.warn('Failed to load tickets from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadActivity(): Promise<void> {
    if (!(await this.hostFs.exists(this.activityFile))) return;
    try {
      const raw = await this.hostFs.readFile(this.activityFile);
      const data = JSON.parse(raw) as SerializedActivity[];
      for (const a of data) {
        this.activities.push(new TicketActivityEntity(
          a.id, a.ticketId, a.action, a.changes,
          a.actorType, a.actorName, a.source,
          new Date(a.createdAt),
        ));
      }
    } catch (err) {
      this.logger.warn('Failed to load activity from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncBoardsToDisk(): Promise<void> {
    try {
      const data: SerializedBoard[] = Array.from(this.boards.values()).map((b) => ({
        id: b.id, name: b.name, emoji: b.emoji,
        createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.boardsFile, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync boards to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncTicketsToDisk(): Promise<void> {
    try {
      const data: SerializedTicket[] = Array.from(this.tickets.values()).map((t) => ({
        id: t.id, boardId: t.boardId, displayId: t.displayId, title: t.title, description: t.description,
        status: t.status, priority: t.priority, type: t.type ?? null, position: t.position,
        tags: t.tags, links: t.links, blocked: t.blocked, favorite: t.favorite,
        dueDate: t.dueDate?.toISOString() ?? null,
        assignee: t.assignee,
        agentClaimedAt: t.agentClaimedAt?.toISOString() ?? null,
        githubMetadata: t.githubMetadata ?? null,
        archivedAt: t.archivedAt?.toISOString() ?? null,
        firstDoingAt: t.firstDoingAt?.toISOString() ?? null,
        statusChangedAt: t.statusChangedAt.toISOString(),
        conversationMode: t.conversationMode,
        modelOverride: t.modelOverride,
        effortOverride: t.effortOverride,
        fastMode: t.fastMode,
        createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.ticketsFile, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync tickets to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncActivityToDisk(): Promise<void> {
    try {
      const data: SerializedActivity[] = this.activities.map((a) => ({
        id: a.id, ticketId: a.ticketId, action: a.action, changes: a.changes,
        actorType: a.actorType, actorName: a.actorName, source: a.source,
        createdAt: a.createdAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.activityFile, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync activity to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
