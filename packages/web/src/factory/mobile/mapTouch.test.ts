import { describe, expect, it } from 'vitest';
import { dropPoint, farBadges, nearestTicket, putLine, toScreen } from './mapTouch';
import { MACHINES, tk } from './fixture';

const layout = { w: 40, h: 20, machines: MACHINES };
/** A phone held upright, looking at the middle of Build from 10 pixels a tile. */
const view = { cam: { x: 10.5, y: 6.5, z: 10 }, w: 390, h: 700 };

describe('which ticket a finger is on', () => {
  const places: [string, { x: number; y: number }][] = [['a', { x: 10.5, y: 6.5 }], ['b', { x: 12, y: 6.5 }], ['far', { x: 30, y: 6.5 }]];
  it('is the nearest one drawn within its reach, in pixels of the screen', () => {
    expect(toScreen(view, 10.5, 6.5)).toEqual({ x: 195, y: 350 });
    expect(nearestTicket(places, view, { x: 195, y: 350 }, 26)).toBe('a');
    expect(nearestTicket(places, view, { x: 206, y: 352 }, 26)).toBe('b');          // 4 px from b, 11 from a
    expect(nearestTicket(places, view, { x: 195, y: 390 }, 26)).toBeNull();         // 40 px under a: the bare floor
  });
  it('reaches as far whatever the zoom: a finger is as wide from far as from near', () => {
    const near = { ...view, cam: { ...view.cam, z: 40 } };
    expect(nearestTicket(places, near, { x: 215, y: 350 }, 26)).toBe('a');          // half a tile away, 20 px
    expect(nearestTicket(places, near, { x: 225, y: 350 }, 26)).toBeNull();
  });
});

describe('what is written over a place seen from far', () => {
  it('counts what each place holds, and says when one of them waits for someone', () => {
    const badges = farBadges(layout, [tk(1, 'build', 'running'), tk(2, 'build', 'question'), tk(3, 'gate', 'review'), tk(4, 'inbound', 'zone'), tk(5, 'belt', 'belt'), tk(6, null, 'loose')]);
    expect(badges.map((b) => [b.machineId, b.count, b.needs])).toEqual([['inbound', 1, false], ['build', 2, true], ['gate', 1, true]]);
    expect(badges[1]).toMatchObject({ x: 8, y: 4, w: 5, h: 5 });
  });
  it('marks a zone of work done by hand whatever its tickets are at, and writes nothing over what is empty', () => {
    expect(farBadges(layout, [tk(1, 'qa', 'zone', 1, { released: true })])).toEqual([expect.objectContaining({ machineId: 'qa', count: 1, needs: true })]);
    expect(farBadges(layout, [])).toEqual([]);
  });
});

describe('where a ticket in hand is shown', () => {
  it('in the middle of the machine it goes in, or of the tile touched', () => {
    expect(dropPoint(MACHINES.find((m) => m.id === 'build')!, 9.2, 4.9)).toEqual({ x: 10.5, y: 6.5 });
    expect(dropPoint(MACHINES.find((m) => m.id === 'belt')!, 5.3, 6.8)).toEqual({ x: 5.5, y: 6.5 });
    expect(dropPoint(null, 20.9, 15.1)).toEqual({ x: 20.5, y: 15.5 });
  });
});

describe('what putting a ticket down does, in the line that can be undone', () => {
  const m = (id: string) => MACHINES.find((x) => x.id === id)!;
  it('names the machine, and says what a belt, an exit and the bare floor do with it', () => {
    expect(putLine(m('build'))).toBe('put in Build');
    expect(putLine(m('inbound'))).toBe('put in Inbound');
    expect(putLine(m('belt'))).toBe('put on a belt');
    expect(putLine(m('exit'))).toBe('leaves by Shipped: it is done');
    expect(putLine(null)).toBe('put on the floor, where it will not move by itself');
  });
});
