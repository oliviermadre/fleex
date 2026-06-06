/**
 * Build the workspace directory name for a ticket: `<short-id>-<title-slug>`.
 *
 * This is the single source of truth for the deterministic workspace id, shared
 * between the server (which creates the folder) and the web client (which builds
 * template contexts for workspace actions). Keep the algorithm byte-for-byte in
 * sync with how the workspace folder is actually created on disk.
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
