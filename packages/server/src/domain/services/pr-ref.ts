/**
 * A `github_pr` ticket link stores its target as `"org/name#number"`. Parsing is
 * needed wherever we go back to GitHub to ask about those PRs (state lookups,
 * merge detection), so keep the one regex here instead of re-deriving it.
 */
export interface ParsedPRRef {
  org: string;
  name: string;
  number: number;
}

const PR_REF_RE = /^([^/]+)\/([^#]+)#(\d+)$/;

/** Returns null when the ref doesn't carry a `org/name#number` triple. */
export function parsePRRef(ref: string): ParsedPRRef | null {
  const match = ref.match(PR_REF_RE);
  if (!match) return null;
  return { org: match[1]!, name: match[2]!, number: parseInt(match[3]!, 10) };
}

/** Parse a batch of refs, dropping the ones that don't match. */
export function parsePRRefs(refs: string[]): ParsedPRRef[] {
  return refs
    .map(parsePRRef)
    .filter((p): p is ParsedPRRef => p !== null);
}
