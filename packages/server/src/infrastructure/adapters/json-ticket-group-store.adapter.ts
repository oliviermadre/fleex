import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { TicketGroupTimeframe, TicketGroupStatus, TicketGroupMembership, TicketRelationship } from '@fleex/shared';
import { TicketGroupEntity } from '../../domain/entities/ticket-group.entity.js';
import type { TicketGroupStorePort } from '../../application/ports/ticket-group-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedTicketGroup {
  id: string;
  boardId: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  timeframe: TicketGroupTimeframe;
  groupStatus: TicketGroupStatus;
  blocked?: boolean;
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
}

export class JsonTicketGroupStore implements TicketGroupStorePort {
  private readonly groups = new Map<string, TicketGroupEntity>();
  private readonly memberships: TicketGroupMembership[] = [];
  private readonly relationships: TicketRelationship[] = [];
  private readonly projectsDir: string;
  private readonly groupsFile: string;
  private readonly membershipsFile: string;
  private readonly relationshipsFile: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.projectsDir = join(this.homedir, FLEEX_DIR, 'projects');
    this.groupsFile = join(this.projectsDir, 'ticket-groups.json');
    this.membershipsFile = join(this.projectsDir, 'ticket-group-memberships.json');
    this.relationshipsFile = join(this.projectsDir, 'ticket-relationships.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!(await this.hostFs.exists(this.projectsDir))) {
      await this.hostFs.mkdir(this.projectsDir);
    }
    await this.loadFromDisk();
    this.initialized = true;
  }

  // ── Ticket Groups ──

  async getAllTicketGroups(): Promise<TicketGroupEntity[]> {
    return Array.from(this.groups.values());
  }

  async getTicketGroupById(id: string): Promise<TicketGroupEntity | null> {
    return this.groups.get(id) ?? null;
  }

  async getTicketGroupsByBoard(boardId: string): Promise<TicketGroupEntity[]> {
    return Array.from(this.groups.values()).filter((g) => g.boardId === boardId);
  }

  async saveTicketGroup(group: TicketGroupEntity): Promise<void> {
    this.groups.set(group.id, group);
    await this.syncGroupsToDisk();
  }

  async removeTicketGroup(id: string): Promise<void> {
    this.groups.delete(id);
    // Also remove associated memberships
    await this.removeMembershipsByGroup(id);
    await this.syncGroupsToDisk();
  }

  // ── Memberships ──

  async getMembershipsByGroup(groupId: string): Promise<TicketGroupMembership[]> {
    return this.memberships.filter((m) => m.groupId === groupId);
  }

  async getMembershipsByTicket(ticketId: string): Promise<TicketGroupMembership[]> {
    return this.memberships.filter((m) => m.ticketId === ticketId);
  }

  async addMembership(ticketId: string, groupId: string): Promise<void> {
    const exists = this.memberships.some((m) => m.ticketId === ticketId && m.groupId === groupId);
    if (!exists) {
      this.memberships.push({ ticketId, groupId });
      await this.syncMembershipsToDisk();
    }
  }

  async removeMembership(ticketId: string, groupId: string): Promise<void> {
    const idx = this.memberships.findIndex((m) => m.ticketId === ticketId && m.groupId === groupId);
    if (idx >= 0) {
      this.memberships.splice(idx, 1);
      await this.syncMembershipsToDisk();
    }
  }

  async removeMembershipsByGroup(groupId: string): Promise<void> {
    let i = this.memberships.length;
    while (i--) {
      if (this.memberships[i]!.groupId === groupId) this.memberships.splice(i, 1);
    }
    await this.syncMembershipsToDisk();
  }

  async removeMembershipsByTicket(ticketId: string): Promise<void> {
    let i = this.memberships.length;
    while (i--) {
      if (this.memberships[i]!.ticketId === ticketId) this.memberships.splice(i, 1);
    }
    await this.syncMembershipsToDisk();
  }

  // ── Relationships ──

  async getChildRelationships(parentId: string): Promise<TicketRelationship[]> {
    return this.relationships.filter((r) => r.parentId === parentId);
  }

  async getParentRelationships(childId: string): Promise<TicketRelationship[]> {
    return this.relationships.filter((r) => r.childId === childId);
  }

  async addRelationship(parentId: string, childId: string): Promise<void> {
    const exists = this.relationships.some((r) => r.parentId === parentId && r.childId === childId);
    if (!exists) {
      this.relationships.push({ parentId, childId });
      await this.syncRelationshipsToDisk();
    }
  }

  async removeRelationship(parentId: string, childId: string): Promise<void> {
    const idx = this.relationships.findIndex((r) => r.parentId === parentId && r.childId === childId);
    if (idx >= 0) {
      this.relationships.splice(idx, 1);
      await this.syncRelationshipsToDisk();
    }
  }

  async removeRelationshipsByTicket(ticketId: string): Promise<void> {
    let i = this.relationships.length;
    while (i--) {
      const r = this.relationships[i]!;
      if (r.parentId === ticketId || r.childId === ticketId) this.relationships.splice(i, 1);
    }
    await this.syncRelationshipsToDisk();
  }

  // ── Persistence ──

  private async loadFromDisk(): Promise<void> {
    // Groups
    if (await this.hostFs.exists(this.groupsFile)) {
      try {
        const raw = await this.hostFs.readFile(this.groupsFile);
        const items: SerializedTicketGroup[] = JSON.parse(raw);
        for (const g of items) {
          this.groups.set(g.id, new TicketGroupEntity(
            g.id, g.boardId, g.name, g.emoji, g.color, g.description,
            g.timeframe, g.groupStatus, g.blocked ?? false, g.favorite ?? false,
            new Date(g.createdAt), new Date(g.updatedAt),
          ));
        }
      } catch (err) {
        this.logger.warn('Failed to load ticket groups', { error: String(err) });
      }
    }

    // Memberships
    if (await this.hostFs.exists(this.membershipsFile)) {
      try {
        const raw = await this.hostFs.readFile(this.membershipsFile);
        const items: TicketGroupMembership[] = JSON.parse(raw);
        this.memberships.push(...items);
      } catch (err) {
        this.logger.warn('Failed to load ticket group memberships', { error: String(err) });
      }
    }

    // Relationships
    if (await this.hostFs.exists(this.relationshipsFile)) {
      try {
        const raw = await this.hostFs.readFile(this.relationshipsFile);
        const items: TicketRelationship[] = JSON.parse(raw);
        this.relationships.push(...items);
      } catch (err) {
        this.logger.warn('Failed to load ticket relationships', { error: String(err) });
      }
    }
  }

  private async syncGroupsToDisk(): Promise<void> {
    const data: SerializedTicketGroup[] = Array.from(this.groups.values()).map((g) => ({
      id: g.id, boardId: g.boardId, name: g.name, emoji: g.emoji, color: g.color,
      description: g.description, timeframe: g.timeframe, groupStatus: g.groupStatus,
      blocked: g.blocked, favorite: g.favorite,
      createdAt: g.createdAt.toISOString(), updatedAt: g.updatedAt.toISOString(),
    }));
    await this.hostFs.writeFile(this.groupsFile, JSON.stringify(data, null, 2));
  }

  private async syncMembershipsToDisk(): Promise<void> {
    await this.hostFs.writeFile(this.membershipsFile, JSON.stringify(this.memberships, null, 2));
  }

  private async syncRelationshipsToDisk(): Promise<void> {
    await this.hostFs.writeFile(this.relationshipsFile, JSON.stringify(this.relationships, null, 2));
  }
}
