/**
 * `[[...]]` links in notes.
 *
 * Lives in `shared` because both ends need the same parse: the web renders the
 * links and the server resolves them into backlinks. Two implementations would
 * drift, and a link that renders but does not resolve is worse than no link.
 */

/** What a wiki-link points at, once its target has been classified. */
export type WikiLinkKind = 'ticket' | 'scratchpad' | 'unresolved';

export interface WikiLink {
  /** The raw text between the brackets. */
  raw: string;
  /** Target after stripping any display alias. */
  target: string;
  /** Text to render — the alias when given, else the target. */
  label: string;
  kind: WikiLinkKind;
  /** Ticket display id, for `[[#42]]`. */
  ticketDisplayId?: number;
  /** Scratchpad key, for `[[org/repo]]` or `[[global]]`. */
  scratchpadKey?: string;
  /** Character offsets in the source text, so a renderer can splice. */
  start: number;
  end: number;
}

/**
 * Matches `[[target]]` and `[[target|label]]`.
 *
 * Rejects newlines and nested brackets inside the target so an unclosed `[[` on
 * one line cannot swallow the rest of a document.
 */
const WIKI_LINK_RE = /\[\[([^\]\n|]{1,200})(?:\|([^\]\n]{1,200}))?\]\]/g;

/** `#42` — a ticket by its display id. */
const TICKET_REF_RE = /^#(\d{1,9})$/;

/** `org/repo` — a per-repo scratchpad. */
const REPO_REF_RE = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * Find every wiki-link in a piece of markdown.
 *
 * Classification is syntactic only: `#42` is a ticket, `org/repo` is a
 * repository note, `global` is the global note, anything else is unresolved.
 * Deciding what an arbitrary phrase refers to needs the database, and doing it
 * here would make the parser untestable without one.
 */
export function parseWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  // A fresh regex per call: a shared global regex carries `lastIndex` between
  // calls and would skip matches on the second document it saw.
  const re = new RegExp(WIKI_LINK_RE.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const target = match[1]!.trim();
    if (!target) continue;
    const alias = match[2]?.trim();

    links.push({
      raw: match[0],
      target,
      label: alias || target,
      start: match.index,
      end: match.index + match[0].length,
      ...classify(target),
    });
  }
  return links;
}

function classify(target: string): Pick<WikiLink, 'kind' | 'ticketDisplayId' | 'scratchpadKey'> {
  const ticket = TICKET_REF_RE.exec(target);
  if (ticket) return { kind: 'ticket', ticketDisplayId: Number.parseInt(ticket[1]!, 10) };

  if (target.toLowerCase() === 'global') return { kind: 'scratchpad', scratchpadKey: '__global__' };

  const repo = REPO_REF_RE.exec(target);
  if (repo) return { kind: 'scratchpad', scratchpadKey: `${repo[1]!.toLowerCase()}/${repo[2]!.toLowerCase()}` };

  return { kind: 'unresolved' };
}

/** Distinct resolvable targets in a document, for backlink indexing. */
export function collectWikiLinkTargets(text: string): string[] {
  const seen = new Set<string>();
  for (const link of parseWikiLinks(text)) {
    if (link.kind === 'unresolved') continue;
    seen.add(link.kind === 'ticket' ? `#${link.ticketDisplayId}` : link.scratchpadKey!);
  }
  return [...seen];
}

/**
 * Whether `text` links to `target`.
 *
 * Used to compute backlinks by scanning candidate documents, which is the right
 * trade at this scale: a handful of scratchpads is cheaper to scan than a link
 * table is to keep consistent through every edit.
 */
export function linksTo(text: string, target: string): boolean {
  return collectWikiLinkTargets(text).includes(target);
}
