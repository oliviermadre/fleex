/**
 * `[3]` and `[1, 3]` in an answer, turned into links.
 *
 * The model is asked to cite its sources by number, and it complies in whichever
 * shape reads best — `[3]`, `[1, 3]`, `[2][5]`. Left as text those numbers are a
 * promise the reader cannot follow: the source they name sits further down the
 * panel with nothing connecting the two.
 *
 * Encoded as ordinary markdown links with a `#fleex-cite:` href, the same trick
 * mentions and wiki-links use, so the renderer keeps handling everything else and
 * only the `a` override knows about citations.
 */

/** Href prefix a citation is encoded to. */
export const CITATION_HREF_PREFIX = '#fleex-cite:';

/** `[3]` or `[1, 3]` or `[1,3,7]` — one bracket, one or more numbers. */
const CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Code spans and fences, where `array[1]` is an index and not a citation. */
const CODE_SPAN_RE = /```[\s\S]*?```|`[^`\n]*`/g;

/** Decode the source number out of a `#fleex-cite:` href. */
export function decodeCitation(href: string): number | null {
  const parsed = Number.parseInt(href.slice(CITATION_HREF_PREFIX.length), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Rewrite every citation that names one of `sourceCount` sources.
 *
 * The bound is what keeps `items[2]` in a code sample from becoming a dead link:
 * a number with no source behind it is left as the text the model wrote.
 */
export function linkifyCitations(answer: string, sourceCount: number): string {
  if (sourceCount <= 0) return answer;

  const protectedRanges = codeRanges(answer);
  const re = new RegExp(CITATION_RE.source, 'g');

  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(answer)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (protectedRanges.some(([from, to]) => start >= from && end <= to)) continue;

    const numbers = match[1]!.split(',')
      .map((n) => Number.parseInt(n.trim(), 10))
      .filter((n) => n >= 1 && n <= sourceCount);
    // A bracket naming nothing real stays as written.
    if (numbers.length === 0) continue;

    out += answer.slice(cursor, start);
    // One link per number, each keeping its own brackets, so `[1, 3]` reads as two
    // separate targets rather than one link that can only lead to one of them.
    out += numbers.map((n) => `[\\[${n}\\]](${CITATION_HREF_PREFIX}${n})`).join('');
    cursor = end;
  }

  return out + answer.slice(cursor);
}

function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = new RegExp(CODE_SPAN_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/**
 * A source title, trimmed of what the panel already says.
 *
 * The chunk counter is bookkeeping — which slice of a document was retrieved tells
 * the reader nothing about whether to open it — and it is the part that pushes a
 * long title onto a second line.
 */
export function sourceLabel(title: string, originTitle?: string | null): string {
  const withoutCounter = title.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
  if (!originTitle) return withoutCounter;

  // A deliverable's breadcrumb ends with the title of the ticket it belongs to, so
  // every row repeated the same parenthetical. Removed by comparison rather than by
  // pattern — the ticket is shown as its own reference beside the row, and guessing
  // which parenthetical is structural would eventually eat a real one.
  const suffix = `(${originTitle.trim()})`;
  return withoutCounter.endsWith(suffix)
    ? withoutCounter.slice(0, -suffix.length).trim()
    : withoutCounter;
}
