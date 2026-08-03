import { describe, it, expect } from 'vitest';

import { stripHtmlCodeFence } from '@fleex/shared';

describe('stripHtmlCodeFence', () => {
  it('unwraps a ```html fenced block', () => {
    const fenced = '```html\n<!DOCTYPE html>\n<html><body>Hi</body></html>\n```';
    expect(stripHtmlCodeFence(fenced)).toBe('<!DOCTYPE html>\n<html><body>Hi</body></html>');
  });

  it('unwraps a bare ``` fenced block', () => {
    const fenced = '```\n<!DOCTYPE html><body>Hi</body>\n```';
    expect(stripHtmlCodeFence(fenced)).toBe('<!DOCTYPE html><body>Hi</body>');
  });

  it('tolerates surrounding whitespace around the fence', () => {
    const fenced = '\n\n  ```html\n<p>x</p>\n```  \n';
    expect(stripHtmlCodeFence(fenced)).toBe('<p>x</p>');
  });

  it('leaves raw HTML untouched', () => {
    const raw = '<!DOCTYPE html>\n<html><body>Hi</body></html>';
    expect(stripHtmlCodeFence(raw)).toBe(raw);
  });

  it('leaves content with only an inner (non-wrapping) code block untouched', () => {
    const md = 'Intro paragraph.\n\n```html\n<div></div>\n```\n\nTrailing text.';
    expect(stripHtmlCodeFence(md)).toBe(md);
  });

  it('is a no-op on empty input', () => {
    expect(stripHtmlCodeFence('')).toBe('');
  });
});
