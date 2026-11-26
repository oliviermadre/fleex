import { describe, expect, it } from 'vitest';
import { AWAKE_MS, MAX_STEP_S, frameGap } from './frameRate';

const hz = (gap: number) => Math.round(1000 / gap);
const rest = { running: true, moving: false };

describe('frameGap', () => {
  it('draws at 60 a second while someone is at it', () => {
    expect(hz(frameGap({ sinceWake: 0, focused: true, running: false, moving: false }))).toBeGreaterThanOrEqual(60);
    expect(hz(frameGap({ sinceWake: AWAKE_MS - 1, focused: true, running: true, moving: true }))).toBeGreaterThanOrEqual(60);
  });

  it('never waits more than a 60 Hz frame at full rate, so a 60 Hz screen loses none', () => {
    expect(frameGap({ sinceWake: 0, focused: true, running: true, moving: true })).toBeLessThan(1000 / 60);
  });

  it('skips every other frame of a 120 Hz screen at full rate', () => {
    expect(frameGap({ sinceWake: 0, focused: true, running: true, moving: true })).toBeGreaterThan(1000 / 120);
  });

  it('settles at 30 a second in front while the floor is not stopped, even with nothing on its belts: they turn', () => {
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, ...rest }))).toBe(32);
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, running: true, moving: true }))).toBe(32);
  });

  it('draws twice a second in front when the floor is stopped and nothing moves on it', () => {
    expect(frameGap({ sinceWake: AWAKE_MS, focused: true, running: false, moving: false, ambient: true })).toBeGreaterThan(400);
    /* what is moved by hand on a stopped floor still slides to its place */
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, running: false, moving: true }))).toBe(32);
  });

  it('slows down when the window is not in front, whatever happens', () => {
    expect(hz(frameGap({ sinceWake: 0, focused: false, running: true, moving: true }))).toBe(15);
    expect(hz(frameGap({ sinceWake: 0, focused: false, ...rest, ambient: true }))).toBe(5);
  });

  it('draws twice a second behind when nothing moves on the floor, though it is not stopped', () => {
    expect(frameGap({ sinceWake: 0, focused: false, ...rest })).toBeGreaterThan(400);
    expect(frameGap({ sinceWake: 0, focused: false, running: false, moving: false })).toBeGreaterThan(400);
  });

  it('never waits longer than the floor\'s clock may step, while something is animated', () => {
    expect(frameGap({ sinceWake: 0, focused: false, ...rest, ambient: true })).toBeLessThan(MAX_STEP_S * 1000);
  });
});
