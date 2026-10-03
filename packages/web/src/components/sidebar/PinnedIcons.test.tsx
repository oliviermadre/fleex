import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { renderIcon, scopeSvgIds } from './PinnedIcons';
import { defaultIconColors, hasOwnColors } from '../settings/actions/actionModel';

afterEach(cleanup);

const GRADIENT_LOGO =
  '<svg viewBox="0 0 24 24"><defs><linearGradient id="a"><stop offset="0" stop-color="#f00"/></linearGradient>' +
  '<linearGradient id="b" href="#a"/></defs><path d="M1 1" fill="url(#b)"/></svg>';

describe('renderIcon', () => {
  it('paints an svg icon in the text colour by default (mono), in its own colours when asked', () => {
    const { container: mono } = render(<>{renderIcon({ icon: GRADIENT_LOGO, iconType: 'svg', label: 'x' }, 16)}</>);
    expect(mono.querySelector('.action-icon-mono svg')).not.toBeNull();
    const { container: original } = render(<>{renderIcon({ icon: GRADIENT_LOGO, iconType: 'svg', label: 'x', iconColors: 'original' }, 16)}</>);
    expect(original.querySelector('svg')).not.toBeNull();
    expect(original.querySelector('.action-icon-mono')).toBeNull();
  });

  it('gives each rendered copy its own gradient ids, so two icons never paint each other', () => {
    const { container } = render(
      <>
        {renderIcon({ icon: GRADIENT_LOGO, iconType: 'svg', label: 'x', iconColors: 'original' }, 16)}
        {renderIcon({ icon: GRADIENT_LOGO, iconType: 'svg', label: 'x', iconColors: 'original' }, 16)}
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(4);
    for (const path of container.querySelectorAll('path')) {
      const ref = /url\(#(.+)\)/.exec(path.getAttribute('fill')!)![1];
      expect(path.closest('svg')!.querySelector(`[id="${ref}"]`)).not.toBeNull();
    }
  });
});

describe('scopeSvgIds', () => {
  it('prefixes ids, url(#…) and href="#…" references alike, and leaves id-less svgs untouched', () => {
    expect(scopeSvgIds(GRADIENT_LOGO, 'p-')).toBe(
      '<svg viewBox="0 0 24 24"><defs><linearGradient id="p-a"><stop offset="0" stop-color="#f00"/></linearGradient>' +
      '<linearGradient id="p-b" href="#p-a"/></defs><path d="M1 1" fill="url(#p-b)"/></svg>',
    );
    const plain = '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>';
    expect(scopeSvgIds(plain, 'p-')).toBe(plain);
  });
});

describe('hasOwnColors', () => {
  it('tells a logo from a glyph: black, none and currentColor are no colour', () => {
    expect(hasOwnColors('<svg><path fill="#2396ed" d="M1 1"/></svg>')).toBe(true);
    expect(hasOwnColors(GRADIENT_LOGO)).toBe(true);
    expect(hasOwnColors('<svg fill="none" stroke="currentColor"><path d="M1 1"/></svg>')).toBe(false);
    expect(hasOwnColors('<svg><path fill="#000000" d="M1 1"/></svg>')).toBe(false);
  });

  it('picks the display mode a freshly chosen icon gets', () => {
    expect(defaultIconColors({ icon: '<svg><path fill="red" d="M1 1"/></svg>', iconType: 'svg' })).toBe('original');
    expect(defaultIconColors({ icon: '<svg><path d="M1 1"/></svg>', iconType: 'svg' })).toBe('mono');
    expect(defaultIconColors({ icon: 'https://x/i.png', iconType: 'url' })).toBe('mono');
  });
});
