import type { TicketLinkType } from '../types/ticket.js';

/**
 * The identifier of an import source. It is deliberately the SAME string as the
 * {@link TicketLinkType} of the link the source produces — there is no separate
 * mapping table between "where a task comes from" and "what link records it".
 */
export type ImportSourceId = Extract<
  TicketLinkType,
  'github_issue' | 'github_pr' | 'slack_message'
>;

/**
 * A recognized source, produced by {@link ImportSourceDescriptor.detect} (from a
 * pasted URL) or by the GitHub descriptors' `fromParts` (from a browse row). It
 * carries everything the UI needs to announce the source and everything the
 * server needs to resolve it — but never contacts the network itself.
 */
export interface SourceMatch {
  readonly sourceId: ImportSourceId;
  /**
   * The ref stored on the source link, in the EXACT format the rest of Fleex
   * already uses so {@link getTicketsLinkedTo} keeps matching existing tickets:
   * `org/name#N` for an issue (casing preserved), `org/name#N` in lowercase for
   * a PR, `channelId/ts` for Slack. See the source modules for the guarantees.
   */
  readonly ref: string;
  /**
   * The canonical URL of the source. GitHub URLs are rebuilt without any query
   * or fragment; the Slack URL is kept whole (trimmed) because its `thread_ts`
   * query param is load-bearing.
   */
  readonly url: string;
  /** Short link label, e.g. `#123` | `Slack thread` | `Slack message`. */
  readonly label: string;
  /** One-line text for the recognition row, e.g. `org/name#123` | `#C0123 · thread`. */
  readonly display: string;
  /** Structured parts a server adapter resolves against (org/name/number, channelId/ts…). */
  readonly params: Readonly<Record<string, string | number>>;
}

/**
 * A registered import source. `resolution` drives the resolving screen: `instant`
 * sources (GitHub) fetch a single record and are usually invisible; `slow` ones
 * (Slack) read a whole conversation and always show progress.
 */
export interface ImportSourceDescriptor {
  readonly id: ImportSourceId;
  readonly name: string;
  readonly resolution: 'instant' | 'slow';
  /** First `detect` that returns non-null (in registry order) wins. */
  detect(input: string): SourceMatch | null;
}

/**
 * A GitHub source descriptor also exposes `fromParts`, used by the "browse" rows
 * and by the server aliases which already hold `(org, name, number)` and must
 * produce the exact same {@link SourceMatch} as detecting the equivalent URL.
 */
export interface GitHubImportSourceDescriptor extends ImportSourceDescriptor {
  fromParts(org: string, name: string, number: number): SourceMatch;
}

/**
 * Owner / repository name guard, mirroring `GITHUB_NAME_RE` on the GraphQL
 * adapter. Anything outside this set is not a repo slug we can query, so it is
 * not a recognizable GitHub source.
 */
export const GITHUB_NAME_RE = /^[A-Za-z0-9_.-]+$/;
