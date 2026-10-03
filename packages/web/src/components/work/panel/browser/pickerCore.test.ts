import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

type Core = Record<string, any>;
let core: Core;

beforeAll(async () => {
  // @ts-expect-error — a plain classic script (no types); imported for its global side effect
  await import('../../../../../../desktop/src/picker/core.js');
  core = (globalThis as unknown as { __fleexPickerCore: Core }).__fleexPickerCore;
});

beforeEach(() => {
  document.body.innerHTML = `
    <main id="app">
      <ul><li>a</li><li class="x y">b</li><li>c</li></ul>
      <section><p>one</p><p>two</p></section>
    </main>`;
});

describe('selectors', () => {
  it('uses a unique id directly', () => {
    expect(core.uniqueSelector(document.getElementById('app'))).toBe('#app');
  });
  it('builds an nth-of-type path from the closest id', () => {
    const li = document.querySelectorAll('li')[1];
    const sel = core.uniqueSelector(li);
    expect(sel).toBe('#app > ul > li:nth-of-type(2)');
    expect(document.querySelector(sel)).toBe(li);
  });
  it('builds an xpath with indexes only where needed', () => {
    const p = document.querySelectorAll('p')[1];
    expect(core.xpathOf(p)).toBe('//*[@id="app"]/section/p[2]');
  });
});

describe('siblingsOf', () => {
  it('lists the parent children and marks the selected one', () => {
    const li = document.querySelectorAll('li')[1];
    expect(core.siblingsOf(li)).toEqual([
      { tag: 'li', text: 'a' },
      { tag: 'li', classes: 'x y', text: 'b', selected: true },
      { tag: 'li', text: 'c' },
    ]);
  });
});

describe('pickStyles', () => {
  it('keeps only tracked properties that differ from the defaults', () => {
    const computed = { getPropertyValue: (p: string) => ({ display: 'flex', color: 'rgb(0, 0, 0)' } as Record<string, string>)[p] ?? '' };
    expect(core.pickStyles(computed, { display: 'block', color: 'rgb(0, 0, 0)' })).toEqual({ display: 'flex' });
  });
});

describe('buildContext', () => {
  it('truncates long text, attributes and html, and has no react section without React', () => {
    const div = document.createElement('div');
    div.setAttribute('data-long', 'z'.repeat(500));
    div.textContent = 'w'.repeat(1000);
    document.body.appendChild(div);
    const { context, react } = core.buildContext(div, { defaultsFor: () => ({}) });
    expect(react).toBeNull();
    expect(context.react).toBeUndefined();
    expect(context.text.length).toBe(300);
    expect(context.attributes['data-long'].length).toBe(200);
    expect(context.html.length).toBeLessThanOrEqual(2048);
    expect(context.v).toBe(1);
  });
});

describe('reactInfo', () => {
  it('walks the fiber chain for component names', () => {
    const btn = document.createElement('button');
    function App() {}
    function Toolbar() {}
    const SaveButton = { displayName: 'SaveButton', render() {} };
    const appFiber = { type: App, return: null };
    const toolbarFiber = { type: Toolbar, return: appFiber };
    const saveFiber = { type: SaveButton, return: toolbarFiber, _debugStack: { stack: 'Error\n at X (http://h/src/Save.tsx:3:4)' } };
    const host = { type: 'button', return: saveFiber, _debugStack: { stack: 'Error\n at SaveButton (http://h/src/Save.tsx?t=1:9:2)' } };
    (btn as any)['__reactFiber$abc'] = host;
    const info = core.reactInfo(btn);
    expect(info.component).toBe('SaveButton');
    expect(info.owners).toEqual(['Toolbar', 'App']);
    expect(info.stack).toContain('Save.tsx?t=1:9:2');
  });
});

describe('source maps', () => {
  it('decodes VLQ segments', () => {
    expect(core.decodeVlq('AAAA')).toEqual([0, 0, 0, 0]);
    expect(core.decodeVlq('AACA')).toEqual([0, 0, 1, 0]);
    expect(core.decodeVlq('D')).toEqual([-1]);
    expect(core.decodeVlq('gB')).toEqual([16]);
  });

  it('maps a generated position back to the original line', () => {
    // gen line 1 col 0 -> src 0 line 0 col 0 ; gen line 2 col 4 -> src 0 line 9 col 2
    const map = { sources: ['App.tsx'], mappings: 'AAAA;IASE' };
    expect(core.originalPosition(map, 2, 5)).toEqual({ source: 'App.tsx', line: 10, column: 3 });
    expect(core.originalPosition(map, 1, 1)).toEqual({ source: 'App.tsx', line: 1, column: 1 });
  });

  it('extracts an inline base64 source map', () => {
    const json = JSON.stringify({ version: 3, sources: ['a.tsx'], mappings: 'AAAA' });
    const code = `x();\n//# sourceMappingURL=data:application/json;base64,${btoa(json)}\n`;
    expect(core.extractInlineSourceMap(code).sources).toEqual(['a.tsx']);
    expect(core.extractInlineSourceMap('x();')).toBeNull();
  });

  it('picks the first app frame, skipping deps', () => {
    const stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)',
      '    at App (http://localhost:5173/src/App.tsx?t=17:120:9)',
    ].join('\n');
    expect(core.pickAppFrame(core.parseStackFrames(stack))).toEqual({ url: 'http://localhost:5173/src/App.tsx?t=17', line: 120, column: 9 });
  });

  it('resolves to file:line through the module source map, and falls back to the file alone', async () => {
    const map = { version: 3, sources: ['App.tsx'], mappings: 'AAAA;IASE' };
    const code = `a\n    b\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}`;
    const info = { component: 'App', owners: [], stack: 'Error\n    at App (http://localhost:5173/src/App.tsx?t=1:2:5)' };
    await expect(core.resolveSource(info, async () => code)).resolves.toEqual({ file: '/src/App.tsx', line: 10, column: 3 });
    await expect(core.resolveSource(info, async () => { throw new Error('offline'); })).resolves.toEqual({ file: '/src/App.tsx' });
    await expect(core.resolveSource({ component: 'A', owners: [], debugSource: { fileName: '/x/A.tsx', lineNumber: 4, columnNumber: 2 } }, async () => ''))
      .resolves.toEqual({ file: '/x/A.tsx', line: 4, column: 2 });
    await expect(core.resolveSource({ component: 'A', owners: [] }, async () => '')).resolves.toBeUndefined();
  });
});
