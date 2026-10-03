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

export function parseElementContext(raw: string): ElementContext | null {
  try {
    const v = JSON.parse(raw) as Partial<ElementContext> | null;
    if (v && v.v === 1 && typeof v.tag === 'string' && typeof v.selector === 'string' && typeof v.page?.url === 'string') {
      return v as ElementContext;
    }
  } catch {
    // fall through
  }
  return null;
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
