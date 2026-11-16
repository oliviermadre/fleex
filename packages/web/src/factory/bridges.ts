/**
 * Which way each lane of a bridge flows. A bridge has no direction of its own:
 * a ticket crosses it the way it arrives, on the east-west lane (the deck) or on
 * the north-south lane (underneath). So the way a lane flows is read from what
 * feeds it: the belt, or the arm, at either end of the run of bridges it is
 * part of.
 */
import { DX, DY, type Dir, type MachineSpec } from './types';

/** `east`/`south`… the way tickets cross; `none`: nothing feeds it yet; `clash`: fed from both ends, tickets would meet head-on. */
export type LaneFlow = Dir | 'none' | 'clash';

type At = (x: number, y: number) => MachineSpec | null;

/** The first tile that is not a bridge, walking from a bridge along a direction. */
function endOf(at: At, b: MachineSpec, dir: Dir): MachineSpec | null {
  let x = b.x + DX[dir], y = b.y + DY[dir];
  for (let guard = 0; guard < 2000; guard++) {
    const m = at(x, y);
    if (!m || m.kind !== 'bridge') return m;
    x += DX[dir]; y += DY[dir];
  }
  return null;
}

/** Whether a tile sends tickets on in a direction: a belt that points that way, or an arm that drops that way. */
const sends = (m: MachineSpec | null, dir: Dir): boolean => !!m && (m.kind === 'belt' || m.kind === 'arm') && m.dir === dir;

function lane(at: At, b: MachineSpec, forward: Dir, backward: Dir): LaneFlow {
  /* what stands before the run on each side: the one at the `backward` end can push tickets `forward`, and the other way round */
  const before = endOf(at, b, backward), after = endOf(at, b, forward);
  const fwd = sends(before, forward), back = sends(after, backward);
  if (fwd && back) return 'clash';
  if (fwd) return forward;
  if (back) return backward;
  /* nothing pushes in yet: a belt that leads away at one end still says which way the lane is meant to go */
  const out = sends(after, forward), outBack = sends(before, backward);
  if (out && !outBack) return forward;
  if (outBack && !out) return backward;
  return 'none';
}

/** The flow of the two lanes of a bridge: `over` is the east-west deck, `under` the north-south lane below it. */
export function bridgeFlow(at: At, b: MachineSpec): { over: LaneFlow; under: LaneFlow } {
  return { over: lane(at, b, 0, 2), under: lane(at, b, 1, 3) };
}

const NAME = ['east', 'south', 'west', 'north'];
/** A lane's flow in words, for the side panel. */
export function flowLabel(f: LaneFlow): string {
  return f === 'none' ? 'no belt feeds it yet' : f === 'clash' ? 'fed from both ends: tickets would meet head-on' : `towards the ${NAME[f]}`;
}
