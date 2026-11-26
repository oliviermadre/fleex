/**
 * An HTML body as text a person (or an agent) reads: what a mail's HTML part says, without its markup. Not a
 * renderer: blocks become lines, links keep their address, lists their bullets, and the rest is the text between tags.
 * Used where only an HTML part came (a mail with no text part), and to read an older item that kept HTML as its text.
 */

/** True when this looks like HTML rather than text: a document, or a few block tags. */
export function looksLikeHtml(s: string | null | undefined): boolean {
  if (!s) return false;
  const head = s.slice(0, 4000);
  if (/<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]/i.test(head)) return true;
  return (head.match(/<\/?(?:div|p|br|table|tr|td|span|a|img|ul|ol|li|h[1-6]|strong|b|em|font|center|style)\b[^>]*>/gi) ?? []).length >= 3;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', euro: '€', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', zwnj: '', zwj: '', shy: '' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    /* a link keeps where it goes, when that is not just its own text */
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      if (!/^https?:/i.test(href)) return inner;
      return !label ? href : decode(label) === href ? label : `${inner} (${href})`;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|blockquote|section|article|header|footer|table|ul|ol)\s*>/gi, '\n')
    .replace(/<(p|div|tr|h[1-6]|blockquote|table|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '  ')
    .replace(/<[^>]+>/g, '');
  s = decode(s).replace(/ /g, ' ').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
