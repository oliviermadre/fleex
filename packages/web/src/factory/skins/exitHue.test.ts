import { describe, expect, it } from 'vitest';
import type { MachineSpec } from '../types';
import { exitHue, type Palette } from './fleex';

const pal = { ok: 'green', text3: 'grey' } as Palette;
const exit = (status?: 'done' | 'cancelled') => ({ id: 'x', kind: 'exit', name: 'Exit', x: 0, y: 0, w: 3, h: 2, ...(status ? { status } : {}) }) as unknown as MachineSpec;

describe('the hue of an exit, and of what leaves by it', () => {
  it('is the success green for an exit that ships, old exits without the setting included', () => {
    expect(exitHue(exit(), pal)).toBe('green');
    expect(exitHue(exit('done'), pal)).toBe('green');
  });

  it('is neutral for an exit that cancels: an abandoned ticket must not read as shipped on the floor', () => {
    expect(exitHue(exit('cancelled'), pal)).toBe('grey');
  });
});
