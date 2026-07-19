/**
 * Parse a Fleex-managed git branch name to a ticket lookup key.
 *
 * Fleex creates two branch shapes:
 *   - `ticket/<6-hex>-<slug>` — the first 6 hex chars of the ticket UUID
 *     (see buildTicketBranchName in branch-utils).
 *   - `agent/<displayId>-<slug>` — the ticket's human display id.
 *
 * Returns the extracted key, or null for a branch that follows neither
 * convention. This is the fallback used when a worktree has no `.fleex.json`
 * manifest to read the ticket id from directly.
 */
export type ParsedTicketBranch = { idPrefix: string } | { displayId: number } | null;

export function parseTicketBranch(branch: string): ParsedTicketBranch {
  const ticketMatch = /^ticket\/([0-9a-f]{6})-/i.exec(branch);
  if (ticketMatch?.[1]) return { idPrefix: ticketMatch[1].toLowerCase() };

  const agentMatch = /^agent\/(\d+)-/.exec(branch);
  if (agentMatch?.[1]) return { displayId: Number(agentMatch[1]) };

  return null;
}
