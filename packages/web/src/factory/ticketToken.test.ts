import { describe, it, expect } from 'vitest';
import { TICKET_TYPES } from '@fleex/shared';
import { shade, shapeOf, tokenSprite } from './ticketToken';
import { TYPE_COLORS } from './renderer';

describe('ticket tokens', () => {
  it('every ticket type has a shape of its own, read from the icon Fleex draws for it', () => {
    const shapes = TICKET_TYPES.map((t) => shapeOf(t));
    for (const s of shapes) { expect(s.solid).toBe(false); expect(s.parts.length).toBeGreaterThan(0); }
    /* six types, six different drawings */
    expect(new Set(shapes.map((s) => JSON.stringify(s.parts))).size).toBe(TICKET_TYPES.length);
    /* and each has a colour to be drawn in */
    for (const t of TICKET_TYPES) expect(TYPE_COLORS[t]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('reads the strokes an icon is made of: paths, circles and rounded rectangles', () => {
    const kinds = (type: string) => [...new Set(shapeOf(type).parts.map((p) => p.kind))].sort();
    expect(kinds('fix')).toEqual(['path']);
    expect(kinds('review')).toEqual(['circle', 'path']);     // the eye: an outline and a pupil
    expect(kinds('lead')).toEqual(['path', 'rect']);         // the briefcase: a handle and a body
    expect(shapeOf('review').parts.find((p) => p.kind === 'circle')).toEqual({ kind: 'circle', cx: 12, cy: 12, r: 3 });
  });

  it('a ticket with no type, or of a type it does not know, is a plain crate', () => {
    for (const type of ['', 'none', 'something-new']) {
      const s = shapeOf(type);
      expect(s.solid).toBe(true);
      expect(s.parts).toEqual([{ kind: 'rect', x: 4.5, y: 4.5, w: 15, h: 15, rx: 4 }]);
    }
  });

  it('gives the same shape every time it is asked', () => {
    expect(shapeOf('build')).toBe(shapeOf('build'));
  });

  it('shades a colour towards black or white', () => {
    expect(shade('#4ade80', 0.5)).toBe('rgb(37, 111, 64)');
    expect(shade('#000000', 1.5)).toBe('rgb(128, 128, 128)');
    expect(shade('#ffffff', 1)).toBe('rgb(255, 255, 255)');
    expect(shade('teal', 0.5)).toBe('teal');   // not a hex colour: left as it is
  });

  it('draws nothing where there is no canvas to draw on, rather than fail', () => {
    expect(tokenSprite('build', '#4ade80', 16)).toBeNull();   // jsdom has no Path2D: the floor then falls back to squares
  });
});
