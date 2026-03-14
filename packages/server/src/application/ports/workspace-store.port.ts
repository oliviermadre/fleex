import type { Workspace } from '@fleex/shared';

export interface WorkspaceStorePort {
  save(workspace: Workspace): Promise<void>;
  remove(ticketId: string): Promise<void>;
  getByTicketId(ticketId: string): Promise<Workspace | null>;
  getAll(): Promise<Workspace[]>;
}
