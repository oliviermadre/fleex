import type { TicketStatus, TicketLinkType, TicketLink, TicketPriority, GitHubIssueMetadata } from '@fleex/shared';
import { BoardEntity } from '../../../domain/entities/board.entity.js';
import { TicketEntity } from '../../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../../../application/ports/ticket-store.port.js';
import type { SupabaseConnection } from './connection.js';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
const MAX_ACTIVITY_ENTRIES = 5000;

// ── Row interfaces ──────────────────────────────────────────────────────────

interface BoardRow {
  id: string;
  name: string;
  emoji: string;
  repository_org: string | null;
  repository_name: string | null;
  next_display_id: number;
  created_at: string;
  updated_at: string;
}

interface TicketRow {
  id: string;
  board_id: string;
  display_id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  position: number;
  tags: string[];
  links: TicketLink[];
  blocked: boolean;
  favorite: boolean;
  due_date: string | null;
  assignee: string | null;
  agent_claimed_at: string | null;
  github_metadata: GitHubIssueMetadata | null;
  archived_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  ticket_id: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  actor_type: string;
  actor_name: string | null;
  source: string;
  created_at: string;
}

// ── Row-to-entity mappers ───────────────────────────────────────────────────

function boardRowToEntity(r: BoardRow): BoardEntity {
  return new BoardEntity(
    r.id,
    r.name,
    r.emoji,
    r.repository_org,
    r.repository_name,
    r.next_display_id ?? 1,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

function ticketRowToEntity(r: TicketRow): TicketEntity {
  return new TicketEntity(
    r.id,
    r.board_id,
    r.display_id ?? 0,
    r.title,
    r.description,
    r.status as TicketStatus,
    r.priority as TicketPriority,
    r.position,
    r.tags ?? [],
    r.links ?? [],
    r.blocked,
    r.favorite,
    r.due_date ? new Date(r.due_date) : null,
    r.assignee,
    r.agent_claimed_at ? new Date(r.agent_claimed_at) : null,
    r.github_metadata ?? null,
    r.archived_at ? new Date(r.archived_at) : null,
    new Date(r.status_changed_at),
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

function activityRowToEntity(r: ActivityRow): TicketActivityEntity {
  return new TicketActivityEntity(
    r.id,
    r.ticket_id,
    r.action,
    r.changes ?? {},
    r.actor_type as 'user' | 'agent',
    r.actor_name,
    r.source as 'web' | 'api',
    new Date(r.created_at),
  );
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class SupabaseTicketStore implements TicketStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  // ── Boards ──

  async getAllBoards(): Promise<BoardEntity[]> {
    const { data, error } = await this.conn.client
      .from('boards')
      .select('*');
    if (error) throw new Error(`SupabaseTicketStore.getAllBoards failed: ${error.message}`);
    return (data as BoardRow[]).map(boardRowToEntity);
  }

  async getBoardById(id: string): Promise<BoardEntity | null> {
    const { data, error } = await this.conn.client
      .from('boards')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseTicketStore.getBoardById failed: ${error.message}`);
    return data ? boardRowToEntity(data as BoardRow) : null;
  }

  async saveBoard(board: BoardEntity): Promise<void> {
    const { error } = await this.conn.client.from('boards').upsert({
      id: board.id,
      name: board.name,
      emoji: board.emoji,
      repository_org: board.repositoryOrg,
      repository_name: board.repositoryName,
      next_display_id: board.nextDisplayId,
      created_at: board.createdAt.toISOString(),
      updated_at: board.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseTicketStore.saveBoard failed: ${error.message}`);
  }

  async removeBoard(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('boards')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseTicketStore.removeBoard failed: ${error.message}`);
  }

  // ── Tickets ──

  async getAllTickets(): Promise<TicketEntity[]> {
    const { data, error } = await this.conn.client
      .from('tickets')
      .select('*')
      .is('archived_at', null);
    if (error) throw new Error(`SupabaseTicketStore.getAllTickets failed: ${error.message}`);
    return (data as TicketRow[]).map(ticketRowToEntity);
  }

  async getTicketById(id: string): Promise<TicketEntity | null> {
    const { data, error } = await this.conn.client
      .from('tickets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseTicketStore.getTicketById failed: ${error.message}`);
    return data ? ticketRowToEntity(data as TicketRow) : null;
  }

  async getTicketsByBoard(boardId: string): Promise<TicketEntity[]> {
    const { data, error } = await this.conn.client
      .from('tickets')
      .select('*')
      .eq('board_id', boardId)
      .is('archived_at', null)
      .order('position', { ascending: true });
    if (error) throw new Error(`SupabaseTicketStore.getTicketsByBoard failed: ${error.message}`);
    return (data as TicketRow[]).map(ticketRowToEntity);
  }

  async getTicketsByStatus(boardId: string, status: TicketStatus): Promise<TicketEntity[]> {
    const { data, error } = await this.conn.client
      .from('tickets')
      .select('*')
      .eq('board_id', boardId)
      .eq('status', status)
      .is('archived_at', null)
      .order('position', { ascending: true });
    if (error) throw new Error(`SupabaseTicketStore.getTicketsByStatus failed: ${error.message}`);
    return (data as TicketRow[]).map(ticketRowToEntity);
  }

  async getTicketsLinkedTo(type: TicketLinkType, ref: string): Promise<TicketEntity[]> {
    // Supabase JS client doesn't easily support JSONB containment operators,
    // so we fetch all tickets and filter in JS.
    const { data, error } = await this.conn.client
      .from('tickets')
      .select('*');
    if (error) throw new Error(`SupabaseTicketStore.getTicketsLinkedTo failed: ${error.message}`);
    return (data as TicketRow[])
      .map(ticketRowToEntity)
      .filter((t) => t.links.some((l) => l.type === type && l.ref === ref));
  }

  async saveTicket(ticket: TicketEntity): Promise<void> {
    const { error } = await this.conn.client.from('tickets').upsert({
      id: ticket.id,
      board_id: ticket.boardId,
      display_id: ticket.displayId,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      position: ticket.position,
      tags: ticket.tags,
      links: ticket.links,
      blocked: ticket.blocked,
      favorite: ticket.favorite,
      due_date: ticket.dueDate?.toISOString() ?? null,
      assignee: ticket.assignee,
      agent_claimed_at: ticket.agentClaimedAt?.toISOString() ?? null,
      github_metadata: ticket.githubMetadata,
      archived_at: ticket.archivedAt?.toISOString() ?? null,
      status_changed_at: ticket.statusChangedAt.toISOString(),
      created_at: ticket.createdAt.toISOString(),
      updated_at: ticket.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseTicketStore.saveTicket failed: ${error.message}`);
  }

  async removeTicket(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('tickets')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseTicketStore.removeTicket failed: ${error.message}`);
  }

  async removeTicketsByBoard(boardId: string): Promise<void> {
    const { error } = await this.conn.client
      .from('tickets')
      .delete()
      .eq('board_id', boardId);
    if (error) throw new Error(`SupabaseTicketStore.removeTicketsByBoard failed: ${error.message}`);
  }

  // ── Agent queries ──

  async getNextTicketForAgent(boardId?: string): Promise<TicketEntity | null> {
    let query = this.conn.client
      .from('tickets')
      .select('*')
      .eq('status', 'todo')
      .eq('blocked', false)
      .is('archived_at', null)
      .order('position', { ascending: true })
      .limit(100);

    if (boardId) {
      query = query.eq('board_id', boardId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`SupabaseTicketStore.getNextTicketForAgent failed: ${error.message}`);

    const candidates = (data as TicketRow[]).map(ticketRowToEntity);

    // Sort by priority in JS since Supabase order doesn't support CASE expressions
    candidates.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.position - b.position;
    });

    return candidates[0] ?? null;
  }

  async getClaimedByAgent(agentName: string): Promise<TicketEntity[]> {
    const { data, error } = await this.conn.client
      .from('tickets')
      .select('*')
      .eq('assignee', agentName)
      .eq('status', 'doing')
      .is('archived_at', null);
    if (error) throw new Error(`SupabaseTicketStore.getClaimedByAgent failed: ${error.message}`);
    return (data as TicketRow[]).map(ticketRowToEntity);
  }

  async getArchivedTickets(boardId?: string, limit = 50, offset = 0): Promise<TicketEntity[]> {
    let query = this.conn.client
      .from('tickets')
      .select('*')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (boardId) query = query.eq('board_id', boardId);
    const { data, error } = await query;
    if (error) throw new Error(`SupabaseTicketStore.getArchivedTickets failed: ${error.message}`);
    return (data as TicketRow[]).map(ticketRowToEntity);
  }

  async countArchivedTickets(boardId?: string): Promise<number> {
    let query = this.conn.client
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .not('archived_at', 'is', null);
    if (boardId) query = query.eq('board_id', boardId);
    const { count, error } = await query;
    if (error) throw new Error(`SupabaseTicketStore.countArchivedTickets failed: ${error.message}`);
    return count ?? 0;
  }

  // ── Display ID ──

  async getNextDisplayId(boardId: string): Promise<number> {
    const { data, error } = await this.conn.client.rpc('increment_board_display_id', { board_id_param: boardId });
    if (error) {
      // Fallback: read-then-write (less atomic but works without RPC)
      const { data: board, error: readErr } = await this.conn.client
        .from('boards')
        .select('next_display_id')
        .eq('id', boardId)
        .single();
      if (readErr || !board) throw new Error(`Board not found: ${boardId}`);
      const currentId = (board as { next_display_id: number }).next_display_id;
      await this.conn.client
        .from('boards')
        .update({ next_display_id: currentId + 1 })
        .eq('id', boardId);
      return currentId;
    }
    return data as number;
  }

  // ── Activity ──

  async saveActivity(entry: TicketActivityEntity): Promise<void> {
    const { error } = await this.conn.client.from('ticket_activities').upsert({
      id: entry.id,
      ticket_id: entry.ticketId,
      action: entry.action,
      changes: entry.changes,
      actor_type: entry.actorType,
      actor_name: entry.actorName,
      source: entry.source,
      created_at: entry.createdAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseTicketStore.saveActivity failed: ${error.message}`);

    // Cap activity entries at MAX_ACTIVITY_ENTRIES by deleting the oldest
    const { count, error: countErr } = await this.conn.client
      .from('ticket_activities')
      .select('*', { count: 'exact', head: true });
    if (countErr) return; // non-fatal

    if (count && count > MAX_ACTIVITY_ENTRIES) {
      const excess = count - MAX_ACTIVITY_ENTRIES;
      const { data: oldest, error: oldErr } = await this.conn.client
        .from('ticket_activities')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(excess);
      if (oldErr || !oldest) return; // non-fatal

      const ids = oldest.map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        await this.conn.client
          .from('ticket_activities')
          .delete()
          .in('id', ids);
      }
    }
  }

  async getActivitiesByTicket(ticketId: string, limit = 50): Promise<TicketActivityEntity[]> {
    const { data, error } = await this.conn.client
      .from('ticket_activities')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseTicketStore.getActivitiesByTicket failed: ${error.message}`);
    return (data as ActivityRow[]).map(activityRowToEntity);
  }

  async searchTicketsByActivityFilters(options: {
    since?: Date;
    until?: Date;
    action?: string;
    limit?: number;
  }): Promise<TicketActivityEntity[]> {
    let query = this.conn.client
      .from('ticket_activities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(options.limit ?? 200);

    if (options.since) {
      query = query.gte('created_at', options.since.toISOString());
    }
    if (options.until) {
      query = query.lte('created_at', options.until.toISOString());
    }
    if (options.action) {
      query = query.eq('action', options.action);
    }

    const { data, error } = await query;
    if (error) throw new Error(`SupabaseTicketStore.searchTicketsByActivityFilters failed: ${error.message}`);
    return (data as ActivityRow[]).map(activityRowToEntity);
  }
}
