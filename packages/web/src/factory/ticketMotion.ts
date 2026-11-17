/**
 * How a ticket is drawn on belts between two snapshots of the floor. The server only says, a couple of times a
 * second, which tile a ticket is on and how far across it; drawn as told, the ticket would stand still, jump most of
 * a tile, and stand still again. Here what is drawn follows what was last said along the belts themselves, at the
 * belts' own pace: it trails the server by a fraction of a second and never stops between two reports.
 *
 * Pure: the renderer says what the track is (which tile follows which, and how fast each carries).
 */

/** A place on the track: a belt or bridge tile, how far across it (0 to 1), and the way the ticket travels across it. */
export interface TrackPos { id: string; p: number; fx: number; fy: number }

export interface Track {
  /** The tile a ticket goes to when it leaves `at`, with the way it then travels; null when the track ends there. */
  next(at: TrackPos): { id: string; fx: number; fy: number } | null;
  /** How fast `at`'s tile carries a ticket that crosses it that way, in tiles per second. */
  pace(at: TrackPos): number;
}

/** How far ahead on the track something is looked for, in tiles: past that, it is somewhere else, not further along. */
export const REACH = 8;
/** How far behind the server's place a ticket is drawn, in seconds of travel: about what one report brings at once. */
export const TRAIL_S = 0.45;

/** The distance along the track from `from` to `to`, in tiles; null when `to` is not ahead of `from` within reach. */
export function ahead(track: Track, from: TrackPos, to: TrackPos, reach = REACH): number | null {
  if (from.id === to.id) return to.p >= from.p - 1e-6 ? Math.max(0, to.p - from.p) : null;
  let at: TrackPos = from, d = 1 - from.p;
  for (let k = 0; k < reach; k++) {
    const n = track.next(at);
    if (!n) return null;
    if (n.id === to.id) return d + to.p;
    at = { ...n, p: 0 }; d += 1;
  }
  return null;
}

/**
 * The speed to draw at for a ticket that is `lag` tiles behind where the server has it, on a tile that carries at
 * `pace`: the pace itself at the usual lag, a little faster when it has fallen behind, slower as it closes in (so it
 * glides to where a ticket stopped instead of stopping short and waiting).
 */
export function paceFor(lag: number, pace: number): number {
  const usual = pace * TRAIL_S;
  if (usual <= 0) return 0;
  return pace * Math.max(0.3, Math.min(2.5, 1 + 0.6 * (lag - usual) / usual));
}

/** `from` moved `dist` tiles along the track towards `to`, and never past it. */
export function advance(track: Track, from: TrackPos, to: TrackPos, dist: number): TrackPos {
  let at = from, left = Math.max(0, dist);
  for (let guard = 0; guard <= REACH + 1; guard++) {
    if (at.id === to.id) return { ...at, p: Math.min(to.p, at.p + left) };
    const room = 1 - at.p;
    if (left < room) return { ...at, p: at.p + left };
    const n = track.next(at);
    if (!n) return { ...at, p: 1 };
    left -= room; at = { ...n, p: 0 };
  }
  return to;
}

/**
 * Where to draw a ticket this frame: `shown` is where it was drawn last (undefined the first time), `told` where the
 * server has it, `dt` the seconds since. Along the track when `told` is ahead of `shown`; at `told` at once when it
 * is not (the ticket was moved by hand, or went round a way this cannot follow).
 */
export function follow(track: Track, shown: TrackPos | undefined, told: TrackPos, dt: number): TrackPos {
  if (!shown) return told;
  const lag = ahead(track, shown, told);
  if (lag === null) return told;
  return advance(track, shown, told, paceFor(lag, track.pace(shown)) * Math.max(0, dt));
}
