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

/** The ticket's workspace directory name: `<short-id>-<slug>`. */
export function ticketWorkspaceId(ticket: { id: string; slug: string }): string {
  return `${ticket.id.slice(0, 6)}-${ticket.slug}`;
}

/** The ticket's git branch: `ticket/<short-id>-<slug>`. */
export function ticketBranchName(ticket: { id: string; slug: string }): string {
  return `ticket/${ticketWorkspaceId(ticket)}`;
}
