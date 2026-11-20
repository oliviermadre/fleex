import { describe, expect, it } from 'vitest';
import { AWAKE_MS, frameGap } from './frameRate';

const hz = (gap: number) => Math.round(1000 / gap);

describe('frameGap', () => {
  it('draws at 60 a second while someone is at it', () => {
    expect(hz(frameGap({ sinceWake: 0, focused: true, running: false }))).toBeGreaterThanOrEqual(60);
    expect(hz(frameGap({ sinceWake: AWAKE_MS - 1, focused: true, running: true }))).toBeGreaterThanOrEqual(60);
  });

  it('never waits more than a 60 Hz frame at full rate, so a 60 Hz screen loses none', () => {
    expect(frameGap({ sinceWake: 0, focused: true, running: true })).toBeLessThan(1000 / 60);
  });

  it('skips every other frame of a 120 Hz screen at full rate', () => {
    expect(frameGap({ sinceWake: 0, focused: true, running: true })).toBeGreaterThan(1000 / 120);
  });

  it('settles at 30 a second when the floor runs on its own', () => {
    expect(hz(frameGap({ sinceWake: AWAKE_MS, focused: true, running: true }))).toBe(32);
  });

  it('draws twice a second when the floor is stopped and nothing happens', () => {
    expect(frameGap({ sinceWake: AWAKE_MS, focused: true, running: false })).toBeGreaterThan(400);
  });

  it('slows down when the window is not in front, whatever happens', () => {
    expect(hz(frameGap({ sinceWake: 0, focused: false, running: true }))).toBe(15);
    expect(frameGap({ sinceWake: 0, focused: false, running: false })).toBeGreaterThan(400);
  });
});
