import { githubIssueSource } from './github-issue.js';
import { githubPrSource } from './github-pr.js';
import { slackMessageSource } from './slack-message.js';
import type { ImportSourceDescriptor, ImportSourceId, SourceMatch } from './types.js';

/**
 * The ordered registry of import sources. Detection walks this list and returns
 * the first match; the entries are mutually exclusive by URL shape (issues vs
 * pulls vs slack), so the order is stable rather than significant.
 *
 * Adding a source (Linear, Jira, Notion…) = append a descriptor here + register
 * its server adapter under the same `id`. Nothing else changes.
 */
export const IMPORT_SOURCES: readonly ImportSourceDescriptor[] = [
  githubIssueSource,
  githubPrSource,
  slackMessageSource,
];

const BY_ID = new Map<ImportSourceId, ImportSourceDescriptor>(
  IMPORT_SOURCES.map((s) => [s.id, s]),
);

/**
 * Recognize a source from a single pasted value. Returns `null` for anything
 * that is not a lone, recognizable URL — including a URL surrounded by prose
 * (that is a title, not an import) — so the caller can fall back to plain text.
 */
export function detectSource(input: string): SourceMatch | null {
  const trimmed = input.trim();
  // A lone URL never contains whitespace; a URL in the middle of a sentence is a
  // title, not an import. Short-circuiting here keeps that contract explicit.
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  for (const source of IMPORT_SOURCES) {
    const match = source.detect(trimmed);
    if (match) return match;
  }
  return null;
}

/** Look up a descriptor by id. Throws on an unknown id (a programming error). */
export function getSource(id: ImportSourceId): ImportSourceDescriptor {
  const source = BY_ID.get(id);
  if (!source) throw new Error(`Unknown import source: ${id}`);
  return source;
}
