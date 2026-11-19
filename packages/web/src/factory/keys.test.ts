import { beforeEach, describe, expect, it } from 'vitest';
import { guessLayout, labelsFromMap, layoutLabels, layoutOfKey, loadForcedLayout, saveForcedLayout, SLOT_CODES, slotOfCode } from './keys';
import { COLS, SLOTS } from './menu';

beforeEach(() => window.localStorage.clear());

describe('the keys of the command card', () => {
  it('are bound to where a key is: three rows of five from the left, one per slot', () => {
    expect(SLOT_CODES).toHaveLength(SLOTS);
    expect(slotOfCode('KeyQ')).toBe(0);              // top left, whatever it types
    expect(slotOfCode('KeyT')).toBe(COLS - 1);
    expect(slotOfCode('KeyA')).toBe(COLS);
    expect(slotOfCode('KeyF')).toBe(8);
    expect(slotOfCode('KeyB')).toBe(SLOTS - 1);
    expect(slotOfCode('KeyN')).toBe(-1);
    expect(slotOfCode('Digit1')).toBe(-1);
  });

  it('are labelled by what they type: the rows of a French keyboard, or of an English one', () => {
    expect(layoutLabels('azerty').join('')).toBe('AZERTQSDFGWXCVB');
    expect(layoutLabels('qwerty').join('')).toBe('QWERTASDFGZXCVB');
    /* F and B are at the same place on both: Fit and the way back keep their letter */
    for (const l of ['azerty', 'qwerty'] as const) expect([layoutLabels(l)[8], layoutLabels(l)[14]]).toEqual(['F', 'B']);
  });

  it('read the labels from the browser when it knows the keyboard, whatever the layout', () => {
    const qwertz: Record<string, string> = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g', KeyZ: 'y', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyB: 'b' };
    expect(labelsFromMap((c) => qwertz[c])!.join('')).toBe('QWERTASDFGYXCVB');
    expect(labelsFromMap(() => undefined)).toBeNull();
    expect(labelsFromMap((c) => (c === 'KeyQ' ? undefined : 'x'))).toBeNull();     // a map with holes is not used
  });

  it('see the layout in a letter typed on a key the two disagree on, and in nothing else', () => {
    expect(layoutOfKey('KeyQ', 'a')).toBe('azerty');
    expect(layoutOfKey('KeyQ', 'Q')).toBe('qwerty');
    expect(layoutOfKey('KeyA', 'q')).toBe('azerty');
    expect(layoutOfKey('KeyZ', 'w')).toBe('azerty');
    expect(layoutOfKey('KeyW', 'w')).toBe('qwerty');
    expect(layoutOfKey('KeyE', 'e')).toBeNull();
    expect(layoutOfKey('KeyQ', 'x')).toBeNull();
  });

  it('guess from the language until something better is known', () => {
    expect(guessLayout('fr-FR')).toBe('azerty');
    expect(guessLayout('fr')).toBe('azerty');
    expect(guessLayout('nl-BE')).toBe('azerty');
    expect(guessLayout('fr-CA')).toBe('qwerty');
    expect(guessLayout('en-US')).toBe('qwerty');
  });

  it('remember a layout that was forced, and forget it when it is given back', () => {
    expect(loadForcedLayout()).toBeNull();
    saveForcedLayout('qwerty'); expect(loadForcedLayout()).toBe('qwerty');
    saveForcedLayout(null); expect(loadForcedLayout()).toBeNull();
    window.localStorage.setItem('fleex.factory.keys', 'dvorak'); expect(loadForcedLayout()).toBeNull();
  });
});
