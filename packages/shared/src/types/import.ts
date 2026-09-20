import type { TicketLink, TicketType, GitHubIssueMetadata, TicketStatus } from './ticket.js';
import type { ImportSourceId } from '../sources/types.js';

/**
 * Repository info attached by a resolved import. Casing is GitHub's own
 * (`nameWithOwner`); the client matches it against its configured repos
 * case-insensitively and keeps the store's key.
 */
export interface ImportRepoInfo {
  readonly org: string;
  readonly name: string;
  /** PR only — the PR's head branch, the default base to branch on top of. */
  readonly headRefName?: string;
  /** PR only — true when the PR comes from a fork (forces a direct checkout). */
  readonly isCrossRepository?: boolean;
  /** PR only. */
  readonly prState?: 'open' | 'merged' | 'closed';
}

/**
 * The outcome of resolving a source into a draft. It is what an
 * `ImportSourceAdapter.resolve()` returns and what the preview route ships —
 * nothing here is persisted; `Start` turns it into a ticket by the normal path.
 */
export interface ResolvedImport {
  readonly title: string;
  readonly description: string;
  readonly tags: string[];
  /**
   * The source link first. NEVER includes the `repository` link — that is
   * described by {@link repo} and attached separately at create time.
   */
  readonly links: Omit<TicketLink, 'id' | 'createdAt'>[];
  readonly repo?: ImportRepoInfo;
  /** Issue only — the metadata the ticket carries (state, labels, author…). */
  readonly githubMetadata?: GitHubIssueMetadata;
  /** PR → `review`; absent for issue and Slack. */
  readonly suggested?: { type?: TicketType };
}

/** A ticket already linked to the same source, surfaced (non-blocking) on preview. */
export interface ImportExistingTicket {
  readonly id: string;
  readonly displayId: number;
  readonly title: string;
  readonly status: TicketStatus;
  readonly archived: boolean;
}

/**
 * The preview response: a {@link ResolvedImport} plus the source identity and any
 * existing tickets already linked to it. Returned by `POST /api/tickets/import/preview`.
 */
export interface ImportPreview extends ResolvedImport {
  readonly sourceId: ImportSourceId;
  readonly ref: string;
  readonly url: string;
  readonly label: string;
  readonly existingTickets: ImportExistingTicket[];
}

export interface ImportPreviewRequest {
  readonly input: string;
}

export interface ImportRequest {
  readonly input: string;
  readonly boardId: string;
  readonly status?: TicketStatus;
  readonly type?: TicketType;
}
