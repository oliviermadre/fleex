import { describe, expect, it } from 'vitest';
import { order, paintPieces, type Layer, type Piece } from './skin';

const log: string[] = [];
const piece = (name: string, layer: Layer, depth: number, on?: Piece): Piece => ({ layer, depth, on, draw: () => log.push(name) });
const names = (ps: Piece[]) => { log.length = 0; for (const p of order(ps)) p.draw(); return [...log]; };

describe('the order pieces are painted in', () => {
  it('is the floor, then what stands by depth, then what is overhead', () => {
    expect(names([piece('boom', 'overhead', 0), piece('near', 'standing', 5), piece('tile', 'floor', 9), piece('far', 'standing', 1)])).toEqual(['tile', 'far', 'near', 'boom']);
  });

  it('keeps the order things came in when their depth is the same: a flat skin paints as it always has', () => {
    expect(names([piece('a', 'standing', 0), piece('b', 'standing', 0), piece('c', 'standing', 0)])).toEqual(['a', 'b', 'c']);
  });

  it('paints what is carried just after its carrier, whatever its own depth', () => {
    const belt = piece('belt', 'standing', 3), station = piece('station', 'standing', 4);
    /* a ticket on the belt would otherwise slip under the next tile; one in the station would be hidden by it */
    const onBelt = piece('ticket on belt', 'standing', 99, belt), inStation = piece('ticket in station', 'floor', 0, station);
    expect(names([inStation, onBelt, station, belt, piece('next tile', 'standing', 3.5)])).toEqual(['belt', 'ticket on belt', 'next tile', 'station', 'ticket in station']);
  });

  it('follows what carries the carrier, and loses nothing', () => {
    const arm = piece('arm', 'overhead', 1), ticket = piece('ticket', 'standing', 0, arm), star = piece('star', 'standing', 0, ticket);
    const away = piece('carried by nothing here', 'standing', 2, piece('elsewhere', 'standing', 0));
    expect(names([star, ticket, arm, away])).toEqual(['carried by nothing here', 'arm', 'ticket', 'star']);
    /* a ring has no first piece: it is painted all the same */
    const a: Piece = piece('a', 'standing', 0), b = piece('b', 'standing', 0, a);
    a.on = b;
    expect(names([a, b]).sort()).toEqual(['a', 'b']);
  });
});

describe('painting the pieces', () => {
  it('leaves out a piece that fails, puts the canvas back as it was, and paints the rest: the arms after a person that threw', () => {
    const T = { a: 2 }, calls: string[] = [], told: string[] = [];
    const ctx = {
      globalAlpha: 1, globalCompositeOperation: 'source-over' as GlobalCompositeOperation, lineCap: 'butt' as CanvasLineCap, lineJoin: 'miter' as CanvasLineJoin, shadowBlur: 0,
      getTransform: () => T as unknown as DOMMatrix, setTransform: (m: unknown) => { calls.push(m === T ? 'transform back' : 'other'); }, setLineDash: () => { calls.push('dashes off'); },
    };
    const person: Piece = { layer: 'standing', depth: 6.5, draw: () => { ctx.globalAlpha = 0.35; ctx.lineCap = 'round'; throw new Error('no shirt'); } };
    const arm: Piece = { layer: 'standing', depth: 7, draw: () => { calls.push(`arm at alpha ${ctx.globalAlpha}, cap ${ctx.lineCap}`); } };
    paintPieces([arm, person], ctx as never, (err) => told.push((err as Error).message));
    expect(calls).toEqual(['transform back', 'dashes off', 'arm at alpha 1, cap butt']);
    expect(told).toEqual(['no shirt']);
  });
});
