import { describe, it, expect } from 'vitest';
import { normalizeUrl } from './url';
import { captureRect, dataUrlToFile } from './capture';
import type { ElementContext } from '../../../shared/elementContext';

describe('normalizeUrl', () => {
  it.each([
    ['localhost:5173', 'http://localhost:5173'],
    [':5173', 'http://localhost:5173'],
    ['5173', 'http://localhost:5173'],
    ['127.0.0.1:3000/x', 'http://127.0.0.1:3000/x'],
    ['app.localhost', 'http://app.localhost'],
    ['example.com', 'https://example.com'],
    ['https://example.com/a', 'https://example.com/a'],
    ['  http://x.y  ', 'http://x.y'],
  ])('%s → %s', (input, out) => expect(normalizeUrl(input)).toBe(out));

  it('rejects empty input, spaces and unsupported schemes', () => {
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('hello world')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

const ctx = (rect: ElementContext['rect']): ElementContext => ({
  v: 1, page: { url: 'u', title: 't', viewport: { w: 800, h: 600, dpr: 2 } }, tag: 'div', rect,
  selector: 'div', xpath: '/div', attributes: {}, styles: {}, html: '', siblings: [],
});

describe('captureRect', () => {
  it('pads, clamps to the viewport and scales by zoom', () => {
    expect(captureRect(ctx({ x: 100, y: 50, w: 200, h: 20 }), 1)).toEqual({ x: 92, y: 42, width: 216, height: 36 });
    expect(captureRect(ctx({ x: 100, y: 50, w: 200, h: 20 }), 1.5)).toEqual({ x: 138, y: 63, width: 324, height: 54 });
  });
  it('clips an element bigger than or partly outside the viewport', () => {
    expect(captureRect(ctx({ x: -50, y: 500, w: 2000, h: 400 }), 1)).toEqual({ x: 0, y: 492, width: 800, height: 108 });
  });
  it('returns null when nothing is visible', () => {
    expect(captureRect(ctx({ x: 900, y: 10, w: 10, h: 10 }), 1)).toBeNull();
    expect(captureRect(ctx({ x: 10, y: 10, w: 0, h: 0 }), 1)).toEqual({ x: 2, y: 2, width: 16, height: 16 });
  });
});

describe('dataUrlToFile', () => {
  it('decodes a base64 png data URL', async () => {
    const f = dataUrlToFile('data:image/png;base64,aGVsbG8=', 'el.png');
    expect(f.type).toBe('image/png');
    expect(f.name).toBe('el.png');
    // jsdom's File has no .text(); read it the old way.
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(f);
    });
    expect(text).toBe('hello');
  });
});
