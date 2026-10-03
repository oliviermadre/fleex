import { describe, it, expect } from 'vitest';
import {
  type ElementContext, type PendingElement,
  isElementContextCode, parseElementContext, serializeElement, composeBody, canSend, elementLabel,
} from './elementContext';

const ctx: ElementContext = {
  v: 1,
  page: { url: 'http://localhost:5173/work', title: 'Fleex', viewport: { w: 1200, h: 800, dpr: 2 } },
  tag: 'div',
  rect: { x: 10, y: 20, w: 300, h: 40 },
  selector: 'body > div:nth-of-type(2)',
  xpath: '/html/body/div[2]',
  text: 'SupabaseDeliverableStore.getAll failed',
  attributes: { class: 'flex items-center' },
  styles: { display: 'flex' },
  html: '<div class="flex items-center">…</div>',
  siblings: [{ tag: 'div', selected: true }],
  react: { component: 'ToastContainer', owners: ['Router', 'App'], source: { file: '/src/App.tsx', line: 36, column: 7 } },
};
const el: PendingElement = { id: 'e1', context: ctx, screenshotUrl: '/api/files/abc.png' };

describe('isElementContextCode', () => {
  it('matches the fleex-element language class only', () => {
    expect(isElementContextCode('language-fleex-element')).toBe(true);
    expect(isElementContextCode('hljs language-fleex-element')).toBe(true);
    expect(isElementContextCode('language-json')).toBe(false);
    expect(isElementContextCode(undefined)).toBe(false);
  });
});

describe('serializeElement / parseElementContext', () => {
  it('round-trips through the fenced block', () => {
    const md = serializeElement(el);
    expect(md.startsWith('![element](/api/files/abc.png)\n\n```fleex-element\n')).toBe(true);
    const json = md.split('```fleex-element\n')[1].replace(/\n```$/, '');
    expect(parseElementContext(json)).toEqual(ctx);
  });

  it('omits the image when there is no screenshot', () => {
    expect(serializeElement({ id: 'e2', context: ctx }).startsWith('```fleex-element')).toBe(true);
  });

  it('uses a longer fence when the content contains backticks', () => {
    const withTicks: PendingElement = { id: 'e3', context: { ...ctx, html: '<pre>```js\nx\n```</pre>' } };
    const md = serializeElement(withTicks);
    expect(md.startsWith('````fleex-element\n')).toBe(true);
    expect(md.endsWith('\n````')).toBe(true);
  });

  it('rejects malformed or foreign JSON', () => {
    expect(parseElementContext('{not json')).toBeNull();
    expect(parseElementContext('{"v":2,"tag":"div"}')).toBeNull();
    expect(parseElementContext('{"v":1}')).toBeNull();
  });
});

describe('composeBody / canSend', () => {
  it('keeps the typed text first, then each element', () => {
    const body = composeBody('  fix this  ', [el]);
    expect(body.startsWith('fix this\n\n![element](/api/files/abc.png)')).toBe(true);
  });
  it('sends elements alone when no text is typed', () => {
    expect(composeBody('', [el]).startsWith('![element]')).toBe(true);
    expect(canSend('', 1)).toBe(true);
    expect(canSend('   ', 0)).toBe(false);
    expect(canSend('hi', 0)).toBe(true);
  });
});

describe('elementLabel', () => {
  it('prefers the React component and clips the text', () => {
    expect(elementLabel(ctx)).toBe('<ToastContainer /> SupabaseDeliverableStor…');
    expect(elementLabel({ ...ctx, react: undefined, text: undefined })).toBe('<div>');
  });
});
