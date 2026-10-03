/**
 * Allow-list SVG sanitiser for action icons.
 *
 * Icon markup is rendered with `dangerouslySetInnerHTML`, and it now comes from
 * three places we do not control: a model, Iconify, and whatever a user pastes.
 * So nothing passes unless it is on the list — elements, attributes, and values
 * alike — and anything that can reach the network or run script (`<script>`,
 * `on*`, external `href`, `style`, `url(…)` other than a local `#id`) is dropped
 * rather than escaped.
 *
 * Colours are kept as drawn: whether an icon shows them or follows the theme is
 * a per-action display choice (`iconColors`), applied when it is rendered.
 * Gradients and clip paths survive, wired only through local `#id` references.
 *
 * Deliberately a small tokenizer, not a DOM: icons are flat geometry, text
 * nodes are meaningless in them, and the server has no DOM to lean on.
 */

/** Colour logos (gradients, many paths) are far heavier than line icons. */
export const SVG_MAX_BYTES = 32 * 1024;

/** Lower-case name → the SVG spelling a browser expects. */
const ALLOWED_ELEMENTS = new Map(
  ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath']
    .map((name) => [name.toLowerCase(), name]),
);

/** Lower-case name → output spelling (SVG attributes are case-sensitive). */
const ALLOWED_ATTRIBUTES = new Map(
  [
    'viewBox', 'xmlns', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height',
    'points', 'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
    'transform', 'opacity',
    // Gradients and clip paths.
    'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
    'fx', 'fy', 'fr', 'clip-path', 'clipPathUnits', 'href', 'xlink:href',
  ].map((name) => [name.toLowerCase(), name]),
);

/** Attributes that may point at a gradient or clip path of the same SVG. */
const URL_ATTRIBUTES = new Set(['fill', 'stroke', 'clip-path']);
const LOCAL_URL = /^url\(\s*['"]?#([A-Za-z_][\w.-]*)['"]?\s*\)$/;
const SAFE_ID = /^[A-Za-z_][\w.-]*$/;
const DANGEROUS_VALUE = /url\s*\(|javascript:|data:|expression\s*\(|[<>]/i;

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<\s*([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Returns sanitised markup, or null when nothing usable (or too large) remains. */
export function sanitizeSvg(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  if (input.length > SVG_MAX_BYTES * 4) return null;

  const out: string[] = [];
  /** Open elements; `keep: false` marks a dropped subtree. */
  const stack: { name: string; keep: boolean }[] = [];
  let sawRoot = false;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;

  while ((match = TOKEN.exec(input)) !== null) {
    const [, closeName, openName, rawAttrs = '', selfClosing] = match;
    if (closeName) {
      const name = closeName.toLowerCase();
      // Ignore a close that matches nothing open (malformed input).
      if (!stack.some((e) => e.name === name)) continue;
      while (stack.length > 0) {
        const open = stack.pop()!;
        if (open.keep) out.push(`</${ALLOWED_ELEMENTS.get(open.name)}>`);
        if (open.name === name) break;
      }
      continue;
    }
    if (!openName) continue; // comment, doctype, CDATA, processing instruction

    const name = openName.toLowerCase();
    const insideDropped = stack.some((e) => !e.keep);
    const isRoot = stack.length === 0;
    // Exactly one root, and it must be <svg>.
    const keep = !insideDropped && ALLOWED_ELEMENTS.has(name) && (isRoot ? name === 'svg' && !sawRoot : true);
    if (keep && isRoot) sawRoot = true;

    if (keep) {
      const attrs = sanitizeAttributes(name, rawAttrs, isRoot);
      out.push(`<${ALLOWED_ELEMENTS.get(name)}${attrs}${selfClosing ? '/>' : '>'}`);
    }
    if (!selfClosing) stack.push({ name, keep });
  }
  // Close anything left open by malformed input.
  while (stack.length > 0) {
    const open = stack.pop()!;
    if (open.keep) out.push(`</${ALLOWED_ELEMENTS.get(open.name)}>`);
  }

  if (!sawRoot) return null;
  const svg = out.join('');
  if (!/<(path|circle|ellipse|rect|line|polyline|polygon)\b/.test(svg)) return null;
  if (Buffer.byteLength(svg, 'utf8') > SVG_MAX_BYTES) return null;
  return svg;
}

function sanitizeAttributes(element: string, raw: string, isRoot: boolean): string {
  const attrs = new Map<string, string>();
  let m: RegExpExecArray | null;
  ATTRIBUTE.lastIndex = 0;
  while ((m = ATTRIBUTE.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!ALLOWED_ATTRIBUTES.has(name)) continue;
    if (name === 'id') {
      if (SAFE_ID.test(value)) attrs.set(name, value);
      continue;
    }
    if (name === 'href' || name === 'xlink:href') {
      // Only a gradient inheriting from another one of the same SVG.
      if ((element === 'lineargradient' || element === 'radialgradient') && value.startsWith('#') && SAFE_ID.test(value.slice(1))) attrs.set('href', value);
      continue;
    }
    if (URL_ATTRIBUTES.has(name)) {
      const local = LOCAL_URL.exec(value);
      if (local) {
        attrs.set(name, `url(#${local[1]})`);
        continue;
      }
    }
    if (DANGEROUS_VALUE.test(value)) continue;
    attrs.set(name, value);
  }

  if (element === 'svg' && isRoot) {
    if (!attrs.has('viewbox')) {
      const w = parseFloat(attrs.get('width') ?? '');
      const h = parseFloat(attrs.get('height') ?? '');
      attrs.set('viewbox', Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `0 0 ${w} ${h}` : '0 0 24 24');
    }
    // The container sizes the icon; fixed dimensions would fight it.
    attrs.delete('width');
    attrs.delete('height');
    attrs.set('xmlns', 'http://www.w3.org/2000/svg');
  }

  let result = '';
  for (const [name, value] of attrs) {
    const outName = ALLOWED_ATTRIBUTES.get(name) ?? name;
    result += ` ${outName}="${value.replace(/"/g, '&quot;')}"`;
  }
  return result;
}

/** Wrap an Iconify icon body into a standalone SVG before sanitising it. */
export function iconifyBodyToSvg(body: string, width = 24, height = 24): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/**
 * Sanitise the inline SVG icons of actions about to be persisted.
 *
 * The picker already routes every import through `sanitizeSvg`, but the config
 * is saved by the client: the server must not trust it to have done so (a
 * direct `PUT /api/config`, an older client, icons saved before the sanitiser
 * existed). An icon with nothing usable left becomes empty rather than unsafe.
 */
export function sanitizeActionIcons<T extends { icon: string; iconType: string }>(actions: T[]): T[] {
  return actions.map((action) =>
    action && action.iconType === 'svg' && typeof action.icon === 'string' && action.icon
      ? { ...action, icon: sanitizeSvg(action.icon) ?? '' }
      : action,
  );
}
