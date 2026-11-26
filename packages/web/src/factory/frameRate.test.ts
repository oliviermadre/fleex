import { describe, expect, it } from 'vitest';
import { AWAKE_MS, MAX_STEP_S, frameGap } from './frameRate';

const hz = (gap: number) => Math.round(1000 / gap);

describe('frameGap', () => {
  it('draws at 60 a second while someone is at it', () => {
    expect(hz(frameGap({ sinceWake: 0, focused: true, moving: false }))).toBeGreaterThanOrEqual(60);
    expect(hz(frameGap({ sinceWake: AWAKE_MS - 1, focused: true, moving: true }))).toBeGreaterThanOrEqual(60);
  });

  it('never waits more than a 60 Hz frame at full rate, so a 60 Hz screen loses none', () => {
    expect(frameGap({ sinceWake: 0, focused: true, moving: true })).toBeLessThan(1000 / 60);
  });

  it('skips every other frame of a 120 Hz screen at full rate', () => {
    expect(frameGap({ sinceWake: 0, focused: true, moving: true })).toBeGreaterThan(1000 / 120);
  });

  it('settles at 30 a second when the floor runs on its own', () => {
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, moving: true }))).toBe(32);
  });

  it('draws ten times a second when nothing moves but something pulses or walks', () => {
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, moving: false, ambient: true }))).toBe(10);
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, moving: true, ambient: true }))).toBe(32);
    expect(hz(frameGap({ sinceWake: 0, focused: false, moving: false, ambient: true }))).toBe(5);
  });

  it('never waits longer than the floor\'s clock may step, while something is animated', () => {
    expect(frameGap({ sinceWake: 0, focused: false, moving: false, ambient: true })).toBeLessThan(MAX_STEP_S * 1000);
  });

  it('draws twice a second when nothing moves on the floor, at rest or stopped', () => {
    expect(frameGap({ sinceWake: AWAKE_MS, focused: true, moving: false })).toBeGreaterThan(400);
  });

  it('slows down when the window is not in front, whatever happens', () => {
    expect(hz(frameGap({ sinceWake: 0, focused: false, moving: true }))).toBe(15);
    expect(frameGap({ sinceWake: 0, focused: false, moving: false })).toBeGreaterThan(400);
  });
});
