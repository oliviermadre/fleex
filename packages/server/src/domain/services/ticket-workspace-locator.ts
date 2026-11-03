import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildTicketWorkspaceId } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';

/**
 * Find the workspace folder of a ticket — by its id, never by its current title.
 *
 * The folder is named `<id6>-<slug(title)>` from the title it had when the
 * workspace was created, and it never moves: tmux sessions, running processes,
 * Claude session transcripts (indexed by cwd) and stored worktree link paths all
 * point at it. So after a rename, `buildTicketWorkspaceId(newTitle)` names a
 * folder that does not exist — re-deriving it would orphan the work in progress.
 *
 * Resolution: among `workspaces/<id6>-*`, the folder whose `.fleex.json` holds
 * this ticket's id (the 6-char prefix can collide across tickets). None → the
 * name a new workspace gets, from the current title (unchanged behaviour).
 */
export function resolveTicketWorkspaceId(
  resolver: { workspacesRoot(): string },
  ticket: { id: string; title: string },
  logger?: Pick<LoggerPort, 'warn'>,
): string {
  const matches = findTicketWorkspaceIds(resolver.workspacesRoot(), ticket.id);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const oldest = matches
      .map((id) => ({ id, born: birthtime(join(resolver.workspacesRoot(), id)) }))
      .sort((a, b) => a.born - b.born || a.id.localeCompare(b.id))[0]!.id;
    logger?.warn('Several workspace folders belong to the same ticket, using the oldest', {
      ticketId: ticket.id, folders: matches, chosen: oldest,
    });
    return oldest;
  }
  return buildTicketWorkspaceId(ticket.title, ticket.id);
}

/** Workspace folders whose manifest names this ticket. */
function findTicketWorkspaceIds(root: string, ticketId: string): string[] {
  const prefix = `${ticketId.slice(0, 6)}-`;
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
      .map((e) => e.name);
  } catch {
    return []; // no workspaces root yet
  }
  return names.filter((name) => manifestTicketId(join(root, name)) === ticketId);
}

function manifestTicketId(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, '.fleex.json'), 'utf-8')) as { ticketId?: unknown };
    return typeof parsed.ticketId === 'string' ? parsed.ticketId : null;
  } catch {
    return null;
  }
}

function birthtime(dir: string): number {
  try {
    const st = statSync(dir);
    return st.birthtimeMs || st.ctimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
