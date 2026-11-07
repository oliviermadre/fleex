/**
 * Parse a Fleex-managed git branch name to a ticket lookup key.
 *
 * Fleex names a ticket's branch `fleex/<displayId>-<slug>` (see
 * ticketBranchName in @fleex/shared). Tickets started before that kept their
 * former branch, still recognised:
 *   - `ticket/<6-hex>-<slug>` — the first 6 hex chars of the ticket UUID.
 *   - `agent/<displayId>-<slug>` — the ticket's human display id.
 *
 * Returns the extracted key, or null for a branch that follows none of these
 * conventions. This is the fallback used when a worktree has no `.fleex.json`
 * manifest to read the ticket id from directly.
 */
export type ParsedTicketBranch = { idPrefix: string } | { displayId: number } | null;

export function parseTicketBranch(branch: string): ParsedTicketBranch {
  const displayMatch = /^(?:fleex|agent)\/(\d+)-/.exec(branch);
  if (displayMatch?.[1]) return { displayId: Number(displayMatch[1]) };

  const ticketMatch = /^ticket\/([0-9a-f]{6})-/i.exec(branch);
  if (ticketMatch?.[1]) return { idPrefix: ticketMatch[1].toLowerCase() };

  return null;
}
