/**
 * `[[wiki-link]]` pre-processing for the Markdown surfaces.
 *
 * Same trick as ../markdown/mentions: the link is rewritten as an ordinary
 * Markdown link with a custom `#fleex-wiki:` href, so react-markdown keeps
 * handling everything else and the `a` override turns it into a chip.
 *
 * The parse itself lives in `@fleex/shared` because the server resolves the same
 * syntax into backlinks; only the encoding is local to the renderer.
 */

import { parseWikiLinks } from '@fleex/shared';

/** Href prefix a resolvable wiki-link is encoded to. */
export const WIKI_LINK_HREF_PREFIX = '#fleex-wiki:';

/** Code spans and fences, so `[[x]]` in a snippet stays a snippet. */
const CODE_SPAN_RE = /```[\s\S]*?```|`[^`\n]*`/g;

/**
 * Rewrite every resolvable `[[…]]` as a Markdown link.
 *
 * Unresolvable targets — an arbitrary phrase like `[[the auth module]]` — are
 * left verbatim. Classifying those needs the database, and a chip that leads
 * nowhere is worse than the brackets the author typed.
 *
 * The target is URI-encoded in the href: a note key contains a slash and a label
 * can contain spaces or parentheses, either of which would end the destination
 * early and produce a broken link.
 */
export function preprocessWikiLinks(body: string): string {
  const links = parseWikiLinks(body).filter((link) => link.kind !== 'unresolved');
  if (links.length === 0) return body;

  const protected_ = codeRanges(body);

  let out = '';
  let cursor = 0;
  for (const link of links) {
    if (protected_.some(([from, to]) => link.start >= from && link.end <= to)) continue;
    const target = link.kind === 'ticket' ? `#${link.ticketDisplayId}` : link.scratchpadKey!;
    out += body.slice(cursor, link.start);
    out += `[${escapeLabel(link.label)}](${WIKI_LINK_HREF_PREFIX}${encodeURIComponent(target)})`;
    cursor = link.end;
  }
  return out + body.slice(cursor);
}

/** `[` inside the label would open a nested link and swallow the destination. */
function escapeLabel(label: string): string {
  return label.replace(/[[\]]/g, (c) => `\\${c}`);
}

function codeRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = new RegExp(CODE_SPAN_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** Decode the target back out of a `#fleex-wiki:` href. */
export function decodeWikiTarget(href: string): string {
  return decodeURIComponent(href.slice(WIKI_LINK_HREF_PREFIX.length));
}
