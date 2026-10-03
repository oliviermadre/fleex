/**
 * Parse a `github_pr` ticket-link ref into its parts. The canonical ref shape
 * is `"org/name#number"` (the format the PR-state feed is keyed by), so this is
 * reliable even when the link's display `label` is inconsistent
 * (e.g. "PR #209" from detect-merge vs "org/name#204"). Returns null when the
 * ref carries no PR number.
 */
export function parseGithubPrRef(ref: string): { org: string; name: string; number: number } | null {
  const hash = ref.lastIndexOf('#');
  if (hash < 0) return null;
  const number = Number.parseInt(ref.slice(hash + 1), 10);
  if (!Number.isFinite(number)) return null;
  const repo = ref.slice(0, hash);
  const slash = repo.indexOf('/');
  if (slash <= 0) return { org: '', name: repo, number };
  return { org: repo.slice(0, slash), name: repo.slice(slash + 1), number };
}

/** The key a PR is watched by in the CI store: `org/name#number`, lowercased. */
export function prCiRef(org: string, name: string, number: number): string {
  return `${org}/${name}#${number}`.toLowerCase();
}

/** A PR as the chips take it, parsed from a ticket's `github_pr` link. */
export interface LinkedPr {
  org: string;
  name: string;
  number: number;
  href?: string;
  title: string;
  /** Last known state, shown until the CI store answers (default open). */
  state?: 'open' | 'merged' | 'closed';
  isDraft?: boolean;
}

/** The ticket's `github_pr` links as chips can show them; unparsable refs are left out. */
export function linkedPrs(links: { type: string; ref: string; url?: string | null }[]): LinkedPr[] {
  return links.flatMap((link) => {
    if (link.type !== 'github_pr') return [];
    const parsed = parseGithubPrRef(link.ref);
    return parsed ? [{ ...parsed, href: link.url ?? undefined, title: link.ref }] : [];
  });
}

type PrKey = { org: string; name: string; number: number };

/** The one PR order: org/repo (case-insensitive), then PR number. */
export function comparePrs(a: PrKey, b: PrKey): number {
  const repo = `${a.org}/${a.name}`.localeCompare(`${b.org}/${b.name}`, undefined, { sensitivity: 'base' });
  return repo !== 0 ? repo : a.number - b.number;
}

/** `github_pr` links in that order; refs that don't parse go last, by ref. */
export function sortPrLinks<T extends { ref: string }>(links: T[]): T[] {
  return [...links].sort((a, b) => {
    const pa = parseGithubPrRef(a.ref);
    const pb = parseGithubPrRef(b.ref);
    if (pa && pb) return comparePrs(pa, pb);
    if (pa || pb) return pa ? -1 : 1;
    return a.ref.localeCompare(b.ref);
  });
}
