import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TicketLink } from '@fleex/shared';
import { slugifyTicketTitle } from '@fleex/shared';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Lock the naming of tickets created before it was stored (`slug` NULL). Runs
 * once per boot; only touches rows whose slug is still NULL, so it is
 * idempotent and safe to run from several instances sharing one database.
 *
 * A ticket's folder is `<displayId>-<slug>` and its branch
 * `fleex/<displayId>-<slug>` — except for a ticket that already has a folder or
 * a branch under the former naming, which keeps it: renaming them would break
 * open tmux sessions, Claude session resume (keyed on the cwd) and open PRs.
 *
 * - folder: `workspaces/<id6>-*` whose manifest `.fleex.json` names the ticket.
 *   Disk is the one trace of a ticket renamed before slugs were stored: its
 *   folder carries the *old* title, which its current title can't give back.
 *   → `workspaceDir` = that folder, `slug` = its slug part.
 * - branch: its first worktree link's branch, else (folder but no link) the
 *   `ticket/<folder>` branch that folder was created with → `branchName`.
 * - neither: `slug` from its title, no override — it moves to the new format,
 *   having nothing on disk or in git to keep.
 */
export class BackfillTicketNamingUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly resolver: { workspacesRoot(): string },
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<{ locked: number; kept: number }> {
    const legacy = await this.ticketStore.getTicketsWithoutSlug();
    if (legacy.length === 0) return { locked: 0, kept: 0 };

    const root = this.resolver.workspacesRoot();
    const foldersByTicket = await this.foldersByTicket(root);

    let locked = 0;
    let kept = 0;
    for (const row of legacy) {
      // Through the store's own lookup, so a caching store updates its entry.
      const ticket = await this.ticketStore.getTicketById(row.id);
      if (!ticket || ticket.lockedSlug !== null) continue;

      const folders = foldersByTicket.get(ticket.id) ?? [];
      const folder = folders.length <= 1 ? folders[0] : await this.oldest(root, folders);
      if (folders.length > 1) {
        // A rename on an older version opened a second, empty folder: the
        // original one holds the work started first.
        this.logger.warn('Several workspace folders for one ticket, keeping the oldest', {
          ticketId: ticket.id, folders, chosen: folder,
        });
      }
      const linkBranch = firstWorktreeBranch(ticket.links);

      if (folder) {
        ticket.workspaceDir = folder;
        ticket.lockedSlug = folder.slice(ticket.id.slice(0, 6).length + 1);
      } else {
        ticket.lockedSlug = slugifyTicketTitle(ticket.title);
      }
      ticket.branchName = linkBranch ?? (folder ? `ticket/${folder}` : null);
      if (ticket.workspaceDir || ticket.branchName) kept++;

      await this.ticketStore.saveTicket(ticket);
      locked++;
    }
    this.logger.info('Ticket naming locked', { locked, keptFormerNaming: kept });
    return { locked, kept };
  }

  /** `<id6>-*` folders whose manifest names a ticket whose id starts with that prefix. */
  private async foldersByTicket(root: string): Promise<Map<string, string[]>> {
    const byTicket = new Map<string, string[]>();
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return byTicket; // no workspaces yet
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const ticketId = await manifestTicketId(join(root, entry.name));
      if (!ticketId || !entry.name.startsWith(`${ticketId.slice(0, 6)}-`)) continue;
      byTicket.set(ticketId, [...(byTicket.get(ticketId) ?? []), entry.name]);
    }
    return byTicket;
  }

  private async oldest(root: string, folders: string[]): Promise<string> {
    const born = await Promise.all(
      folders.map(async (name) => {
        const st = await stat(join(root, name)).catch(() => null);
        return { name, at: st ? st.birthtimeMs || st.ctimeMs : Number.POSITIVE_INFINITY };
      }),
    );
    born.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
    return born[0]!.name;
  }
}

/**
 * The branch of the ticket's first worktree link — the one every run and
 * session already reuses. Same reading as `ensureWorkspace`: `org/repo:branch`,
 * else the label (the ref being the worktree path). `null` when neither says.
 */
function firstWorktreeBranch(links: readonly TicketLink[]): string | null {
  const link = links.find((l) => l.type === 'worktree');
  if (!link) return null;
  const colonIdx = link.ref.indexOf(':');
  if (colonIdx > 0 && !link.ref.startsWith('/')) return link.ref.substring(colonIdx + 1) || null;
  return link.label || null;
}

async function manifestTicketId(dir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, '.fleex.json'), 'utf-8')) as { ticketId?: unknown };
    return typeof parsed.ticketId === 'string' ? parsed.ticketId : null;
  } catch {
    return null;
  }
}
