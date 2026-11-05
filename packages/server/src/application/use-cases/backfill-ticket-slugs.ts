import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Lock the slug of tickets created before slugs were stored, from the
 * workspace folder they already have on disk. Runs once per boot; only touches
 * rows whose slug is still NULL, so it is idempotent and safe to run from
 * several instances sharing one database.
 *
 * Why disk: a ticket renamed before this change (CLI, MCP, mobile) has a folder
 * and a branch named after its *old* title, which its current title can't give
 * back. The folder name is the one trace of it: `<id6>-<slug>`, its manifest
 * `.fleex.json` holding the ticket id.
 *
 * Tickets with no folder here need nothing: their slug derives from their title
 * (never renamed while it mattered) and locks on their next save.
 */
export class BackfillTicketSlugsUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly resolver: { workspacesRoot(): string },
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<{ locked: number }> {
    const root = this.resolver.workspacesRoot();
    const foldersByTicket = await this.foldersByTicket(root);

    let locked = 0;
    for (const [ticketId, folders] of foldersByTicket) {
      const ticket = await this.ticketStore.getTicketById(ticketId);
      if (!ticket || ticket.lockedSlug !== null) continue;

      const folder = folders.length === 1 ? folders[0]! : await this.oldest(root, folders);
      if (folders.length > 1) {
        // A rename on an older version opened a second, empty folder: the
        // original one holds the work started first.
        this.logger.warn('Several workspace folders for one ticket, locking its slug on the oldest', {
          ticketId, folders, chosen: folder,
        });
      }
      ticket.lockedSlug = folder.slice(ticketId.slice(0, 6).length + 1);
      await this.ticketStore.saveTicket(ticket);
      locked++;
    }
    if (locked > 0) this.logger.info('Ticket slugs locked from their workspace folders', { locked });
    return { locked };
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

async function manifestTicketId(dir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, '.fleex.json'), 'utf-8')) as { ticketId?: unknown };
    return typeof parsed.ticketId === 'string' ? parsed.ticketId : null;
  } catch {
    return null;
  }
}
