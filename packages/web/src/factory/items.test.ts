import { describe, expect, it } from 'vitest';
import { ITEM_SOURCES, refOf, SOURCE_PARTS, SOURCE_TYPE_COLORS, sourceOfType, sourceType } from './items';
import { shapeOf } from './ticketToken';
import { TYPE_COLORS } from './renderer';
import { dispatch } from './quays';
import type { ArmSpec, FactoryTicket, MachineSpec } from './types';

describe('items', () => {
  it('an item is drawn in relief from its source\'s mark, in its source\'s colour, as a ticket is from its type', () => {
    for (const s of ITEM_SOURCES) {
      expect(sourceOfType(sourceType(s))).toBe(s);
      expect(shapeOf(sourceType(s))).toEqual({ parts: SOURCE_PARTS[s], solid: false });
      expect(TYPE_COLORS[sourceType(s)]).toBe(SOURCE_TYPE_COLORS[sourceType(s)]);
    }
    /* a ticket's type, or anything else, is not a source */
    expect(sourceOfType('build')).toBeNull();
    expect(sourceOfType('src:teams')).toBeNull();
  });

  it('an item is named by its source, a ticket by its number', () => {
    expect(refOf({ displayId: 12, type: 'fix' })).toBe('#12');
    expect(refOf({ displayId: 0, type: 'src:gmail' })).toBe('Gmail');
    expect(refOf(null)).toBe('#?');
  });

  it('an intake lets out to its arm only what its conversation has left quiet', () => {
    const intake: MachineSpec = { id: 'in', kind: 'intake', x: 0, y: 0, w: 3, h: 2, source: 'slack' };
    const arm: ArmSpec = { id: 'a', kind: 'arm', x: 3, y: 0, w: 1, h: 1, dir: 0, when: [] };
    const t = (id: string, released: boolean): FactoryTicket => ({ ticketId: id, machineId: 'in', info: null, x: 0, y: 0, phase: 'zone', p: 0, fx: 1, fy: 0, outcome: '', released, since: '', runId: null, note: '', handedAt: '' });
    expect([...dispatch(intake, [arm], [t('moving', false), t('quiet', true)]).quay]).toEqual([['quiet', 'a']]);
  });
});
