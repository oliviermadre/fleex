import type { SessionType, SessionStatus } from '@asm/shared';
import { SessionEntity } from '../../../domain/entities.js';
import type { SessionStorePort } from '../../../application/ports/session-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface SessionRow {
  id: string;
  tmux_name: string;
  type: string;
  status: string;
  cwd: string;
  created_at: string;
  last_attached_at: string | null;
  repository_org: string | null;
  repository_name: string | null;
  worktree_branch: string | null;
  git_remote: string | null;
  claude_prompt: string | null;
  display_name: string | null;
}

function rowToEntity(r: SessionRow): SessionEntity {
  return new SessionEntity(
    r.id,
    r.tmux_name,
    r.type as SessionType,
    r.status as SessionStatus,
    r.cwd,
    new Date(r.created_at),
    r.last_attached_at ? new Date(r.last_attached_at) : null,
    r.repository_org,
    r.repository_name,
    r.worktree_branch,
    r.git_remote,
    r.claude_prompt ?? undefined,
    r.display_name ?? '',
  );
}

export class SupabaseSessionStore implements SessionStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async save(session: SessionEntity): Promise<void> {
    const { error } = await this.conn.client.from('sessions').upsert({
      id: session.id,
      tmux_name: session.tmuxName,
      type: session.type,
      status: session.status,
      cwd: session.cwd,
      created_at: session.createdAt.toISOString(),
      last_attached_at: session.lastAttachedAt?.toISOString() ?? null,
      repository_org: session.repositoryOrg,
      repository_name: session.repositoryName,
      worktree_branch: session.worktreeBranch,
      git_remote: session.gitRemote,
      claude_prompt: session.claudePrompt ?? null,
      display_name: session.displayName,
    });
    if (error) throw new Error(`SupabaseSessionStore.save failed: ${error.message}`);
  }

  async remove(sessionId: string): Promise<void> {
    const { error } = await this.conn.client
      .from('sessions')
      .delete()
      .eq('id', sessionId);
    if (error) throw new Error(`SupabaseSessionStore.remove failed: ${error.message}`);
  }

  async getAll(): Promise<SessionEntity[]> {
    const { data, error } = await this.conn.client
      .from('sessions')
      .select('*');
    if (error) throw new Error(`SupabaseSessionStore.getAll failed: ${error.message}`);
    return (data as SessionRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<SessionEntity | null> {
    const { data, error } = await this.conn.client
      .from('sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseSessionStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as SessionRow) : null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    const { data, error } = await this.conn.client
      .from('sessions')
      .select('*')
      .eq('tmux_name', name)
      .maybeSingle();
    if (error) throw new Error(`SupabaseSessionStore.getByTmuxName failed: ${error.message}`);
    return data ? rowToEntity(data as SessionRow) : null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    const { data, error } = await this.conn.client
      .from('sessions')
      .select('*')
      .eq('cwd', cwd);
    if (error) throw new Error(`SupabaseSessionStore.getByCwd failed: ${error.message}`);
    return (data as SessionRow[]).map(rowToEntity);
  }
}
