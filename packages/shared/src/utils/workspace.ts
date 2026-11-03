/**
 * The name a ticket's workspace directory gets when it is *created*:
 * `<short-id>-<title-slug>`.
 *
 * Not where an existing workspace is: the folder keeps this name after a rename,
 * so it must be found by ticket id — server-side `resolveTicketWorkspaceId`, and
 * `GET /api/tickets/:id/workspace` for the web client.
 */
export function buildTicketWorkspaceId(title: string, ticketId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = ticketId.slice(0, 6);
  return `${short}-${slug}`;
}
