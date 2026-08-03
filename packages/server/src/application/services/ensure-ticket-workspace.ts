import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildTicketWorkspaceId } from '../../domain/services/branch-utils.js';

import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';

export interface TicketWorkspace {
  workspaceId: string;
  workspacePath: string;
}

/**
 * Materialises a ticket's workspace folder and its `.fleex.json` marker.
 *
 * A workspace is created lazily (on session/agent start), so it may not exist
 * for a ticket that never ran one. Both `POST /api/tickets/:id/ensure-workspace`
 * and the action runner need it on disk before handing `{{workspace_path}}` to a
 * command — hence one helper rather than a duplicated mkdir in each route.
 */
export function ensureTicketWorkspace(
  resolver: RepoPathResolver,
  ticket: { id: string; title: string },
): TicketWorkspace {
  const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
  const workspacePath = resolver.workspacePath(workspaceId);

  mkdirSync(workspacePath, { recursive: true });

  const manifestPath = join(workspacePath, '.fleex.json');
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ ticketId: ticket.id }, null, 2));
  }

  return { workspaceId, workspacePath };
}
