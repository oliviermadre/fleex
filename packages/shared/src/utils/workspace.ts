/**
 * A ticket's slug: its title at creation, slugified. Locked from then on — a
 * rename changes the title, never the slug — so everything derived from it
 * (the workspace folder, the git branch) keeps pointing at the same place.
 *
 * Max 40 characters. The cut can leave a trailing `-`: kept as is, because
 * existing folders and branches were named exactly that way.
 */
export function slugifyTicketTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * What names a ticket on disk and in git. All of it is fixed once the ticket
 * exists: `displayId` is assigned at insert and never changes, `slug` is locked
 * at creation. `workspaceDir` / `branchName` are set only for a ticket that
 * already had a folder or a branch under the former naming (backfilled at
 * boot): they keep it where it is.
 */
export interface TicketNaming {
  readonly displayId: number;
  readonly slug: string;
  readonly workspaceDir?: string | null;
  readonly branchName?: string | null;
}

/**
 * `<displayId>-<slug>`. Throws on a ticket not inserted yet (`displayId` 0):
 * a name computed before the database assigns the number would be `0-foo`, a
 * folder no later call finds again.
 */
function ticketHandle(ticket: TicketNaming): string {
  if (!Number.isInteger(ticket.displayId) || ticket.displayId <= 0) {
    throw new Error(`Cannot name the workspace of a ticket with no display id yet (slug "${ticket.slug}")`);
  }
  return `${ticket.displayId}-${ticket.slug}`;
}

/** The ticket's workspace directory name: `<displayId>-<slug>` (or the folder it already had). */
export function ticketWorkspaceId(ticket: TicketNaming): string {
  return ticket.workspaceDir ?? ticketHandle(ticket);
}

/** The ticket's git branch, shared by every linked repo: `fleex/<displayId>-<slug>` (or the branch it already had). */
export function ticketBranchName(ticket: TicketNaming): string {
  return ticket.branchName ?? `fleex/${ticketHandle(ticket)}`;
}
