/**
 * The context of one UI element picked in the ticket browser (desktop only).
 * It travels as a ```fleex-element fenced JSON block inside a plain comment
 * body, so the server and the agent need nothing new: the agent reads the JSON,
 * the thread renders it as an ElementContextCard.
 */
export interface ElementContext {
  v: 1;
  page: { url: string; title: string; viewport: { w: number; h: number; dpr: number } };
  tag: string;
  rect: { x: number; y: number; w: number; h: number };
  selector: string;
  xpath: string;
  text?: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  html: string;
  siblings: { tag: string; classes?: string; text?: string; selected?: true }[];
  react?: {
    component: string;
    owners: string[];
    source?: { file: string; line?: number; column?: number };
  };
}

/** A picked element waiting in the composer, before the comment is sent. */
export interface PendingElement {
  id: string;
  context: ElementContext;
  screenshotUrl?: string;
  captureFailed?: boolean;
}

export const ELEMENT_FENCE_LANG = 'fleex-element';

export function isElementContextCode(className: string | undefined): boolean {
  return !!className && /\blanguage-fleex-element\b/.test(className);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const strMap = (v: unknown): Record<string, string> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};

/**
 * Accept anything that looks like an ElementContext and fill in what the card
 * and the capture need. Both the thread (any comment author or agent can write a
 * fleex-element block) and the picker IPC (a guest page could forge a payload)
 * go through here, so a partial object never crashes a render.
 */
export function normalizeElementContext(raw: unknown): ElementContext | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.tag !== 'string' || typeof raw.selector !== 'string') return null;
  const page = isObj(raw.page) ? raw.page : null;
  if (!page || typeof page.url !== 'string') return null;
  const vp = isObj(page.viewport) ? page.viewport : {};
  const rect = isObj(raw.rect) ? raw.rect : {};
  const ctx: ElementContext = {
    v: 1,
    page: { url: page.url, title: str(page.title) ?? '', viewport: { w: num(vp.w), h: num(vp.h), dpr: num(vp.dpr, 1) } },
    tag: raw.tag,
    rect: { x: num(rect.x), y: num(rect.y), w: num(rect.w), h: num(rect.h) },
    selector: raw.selector,
    xpath: str(raw.xpath) ?? '',
    attributes: strMap(raw.attributes),
    styles: strMap(raw.styles),
    html: str(raw.html) ?? '',
    siblings: Array.isArray(raw.siblings)
      ? raw.siblings.filter(isObj).filter((s) => typeof s.tag === 'string').map((s) => ({
          tag: s.tag as string,
          ...(str(s.classes) ? { classes: str(s.classes) } : {}),
          ...(str(s.text) ? { text: str(s.text) } : {}),
          ...(s.selected === true ? { selected: true as const } : {}),
        }))
      : [],
  };
  const text = str(raw.text);
  if (text) ctx.text = text;
  const react = isObj(raw.react) ? raw.react : null;
  if (react && typeof react.component === 'string') {
    const owners = Array.isArray(react.owners) ? react.owners.filter((o): o is string => typeof o === 'string') : [];
    const src = isObj(react.source) && typeof react.source.file === 'string' ? react.source : null;
    ctx.react = { component: react.component, owners };
    if (src) {
      ctx.react.source = { file: src.file as string };
      if (typeof src.line === 'number') ctx.react.source.line = src.line;
      if (typeof src.column === 'number') ctx.react.source.column = src.column;
    }
  }
  return ctx;
}

export function parseElementContext(raw: string): ElementContext | null {
  try {
    return normalizeElementContext(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A fence one backtick longer than the longest run inside, never shorter than 3. */
function fenceFor(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((r) => r.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

export function serializeElement(el: PendingElement): string {
  const json = JSON.stringify(el.context, null, 2);
  const fence = fenceFor(json);
  const image = el.screenshotUrl ? `![element](${el.screenshotUrl})\n\n` : '';
  return `${image}${fence}${ELEMENT_FENCE_LANG}\n${json}\n${fence}`;
}

export function composeBody(text: string, elements: readonly PendingElement[]): string {
  return [text.trim(), ...elements.map(serializeElement)].filter(Boolean).join('\n\n');
}

export function canSend(text: string, elementCount: number): boolean {
  return text.trim().length > 0 || elementCount > 0;
}

const LABEL_TEXT_MAX = 24;

export function elementLabel(ctx: ElementContext): string {
  const name = ctx.react?.component ? `<${ctx.react.component} />` : `<${ctx.tag}>`;
  if (!ctx.text) return name;
  const clipped = ctx.text.length > LABEL_TEXT_MAX ? `${ctx.text.slice(0, LABEL_TEXT_MAX - 1)}…` : ctx.text;
  return `${name} ${clipped}`;
}
