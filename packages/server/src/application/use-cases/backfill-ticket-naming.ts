import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TicketLink } from '@fleex/shared';
import { slugifyTicketTitle } from '@fleex/shared';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Lock the naming of tickets created before it was stored (`slug` NULL). Runs
 * once per boot and is idempotent. Several instances can share one database
 * (two machines on one Supabase): a ticket started on the other machine has no
 * folder on this disk, so its former folder is also read from what the
 * database stores — its worktree link's path or branch.
 *
 * A ticket's folder is `<displayId>-<slug>` and its branch
 * `fleex/<displayId>-<slug>` — except for a ticket that already has a folder or
 * a branch under the former naming, which keeps it: renaming them would break
 * open tmux sessions, Claude session resume (keyed on the cwd) and open PRs.
 *
 * - folder: `workspaces/<id6>-*` whose manifest `.fleex.json` names the ticket,
 *   else the `<id6>-*` folder its first worktree link points into (path, or
 *   `ticket/<id6>-*` branch). It carries the *old* title of a ticket renamed
 *   before slugs were stored, which its current title can't give back.
 *   → `workspaceDir` = that folder, `slug` = its slug part.
 * - branch: its first worktree link's branch, else (folder but no link) the
 *   `ticket/<folder>` branch that folder was created with → `branchName`.
 * - neither: `slug` from its title, no override — it moves to the new format,
 *   having nothing on disk or in git to keep.
 *
 * Repair, every boot: a former-naming folder on this disk whose ticket has a
 * slug but no `workspaceDir` gets recorded. That happens when the slug was
 * locked without this backfill having seen the folder — a rename after a boot
 * where the backfill failed, or a ticket created then started by an older
 * version sharing the database. Without it the next run would open a fresh
 * `<n>-<slug>` folder and orphan the work in progress.
 */
export class BackfillTicketNamingUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly resolver: { workspacesRoot(): string },
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<{ locked: number; kept: number; repaired: number }> {
    const root = this.resolver.workspacesRoot();
    const foldersByTicket = await this.foldersByTicket(root);
    const legacy = await this.ticketStore.getTicketsWithoutSlug();

    let locked = 0;
    let kept = 0;
    for (const row of legacy) {
      // Through the store's own lookup, so a caching store updates its entry.
      const ticket = await this.ticketStore.getTicketById(row.id);
      if (!ticket || ticket.lockedSlug !== null) continue;

      const linkBranch = firstWorktreeBranch(ticket.links);
      const folder =
        (await this.localFolder(root, ticket.id, foldersByTicket)) ?? linkedFolder(ticket.id, ticket.links);

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

    let repaired = 0;
    for (const ticketId of foldersByTicket.keys()) {
      const ticket = await this.ticketStore.getTicketById(ticketId);
      if (!ticket || ticket.lockedSlug === null || ticket.workspaceDir !== null) continue;
      // Already started in the new format (elsewhere): that is where its work is.
      if (firstWorktreeBranch(ticket.links)?.startsWith('fleex/')) continue;
      const folder = await this.localFolder(root, ticketId, foldersByTicket);
      if (!folder) continue;
      ticket.workspaceDir = folder;
      ticket.branchName ??= firstWorktreeBranch(ticket.links) ?? `ticket/${folder}`;
      this.logger.warn('Recorded the former workspace folder of a ticket whose slug was locked without it', {
        ticketId, folder, branch: ticket.branchName,
      });
      await this.ticketStore.saveTicket(ticket);
      repaired++;
    }

    if (locked || repaired) {
      this.logger.info('Ticket naming locked', { locked, keptFormerNaming: kept, repaired });
    }
    return { locked, kept, repaired };
  }

  /** The ticket's former-naming folder on this disk; the oldest if a rename opened a second one. */
  private async localFolder(root: string, ticketId: string, byTicket: Map<string, string[]>): Promise<string | undefined> {
    const folders = byTicket.get(ticketId) ?? [];
    if (folders.length <= 1) return folders[0];
    const chosen = await this.oldest(root, folders);
    // A rename on an older version opened a second, empty folder: the
    // original one holds the work started first.
    this.logger.warn('Several workspace folders for one ticket, keeping the oldest', { ticketId, folders, chosen });
    return chosen;
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

/**
 * The former-naming folder (`<id6>-*`) the ticket's first worktree link points
 * into, read from the database alone — for a ticket started on another
 * machine sharing it. The link's ref is the worktree path
 * (`…/workspaces/<id6>-x/<repo>`, same reading as the worktree cleanup), else
 * its branch `ticket/<id6>-x` is the name that folder was created with.
 */
function linkedFolder(ticketId: string, links: readonly TicketLink[]): string | undefined {
  const link = links.find((l) => l.type === 'worktree');
  if (!link) return undefined;
  const prefix = `${ticketId.slice(0, 6)}-`;
  if (link.ref.startsWith('/')) {
    const parts = link.ref.split('/');
    const at = parts.findIndex((p, i) => i > 0 && parts[i - 1] === 'workspaces' && p.startsWith(prefix));
    if (at > 0 && parts[at]!.length > prefix.length) return parts[at];
  }
  const branch = firstWorktreeBranch(links);
  if (branch?.startsWith(`ticket/${prefix}`) && branch.length > `ticket/${prefix}`.length) {
    return branch.slice('ticket/'.length);
  }
  return undefined;
}

async function manifestTicketId(dir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, '.fleex.json'), 'utf-8')) as { ticketId?: unknown };
    return typeof parsed.ticketId === 'string' ? parsed.ticketId : null;
  } catch {
    return null;
  }
}
