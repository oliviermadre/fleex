import { cn } from '../lib/cn';
import { tintClasses } from '../lib/tints';
import type { HudShape } from './hudShape';

const YELLOW = tintClasses('yellow');
/** How wide the tape is, and its stripes: yellow and black on the diagonal, as on the bay of what is set aside. */
export const TAPE = 9;
const STRIPES = 'repeating-linear-gradient(45deg, var(--theme-warning) 0 10px, #18181b 10px 20px)';

/**
 * The tape as a shape to cut the stripes to: a ring `t` wide just inside the edge of the floor's view. With the
 * console shown, the view's foot is not straight: the console's two side blocks rise over its corners, their inner
 * top corners cut, and the tape follows them (`hudShape.ts`). Lengths are measured from the view's own edges, so
 * nothing has to be measured: the shape holds at any size.
 */
export function tapeShape(hud: HudShape | null, t = TAPE): string {
  const p = (x: string, y: string) => `${x} ${y}`, R = (n: number) => `calc(100% - ${n}px)`, px = (n: number) => `${n}px`;
  if (!hud) {
    const outer = [p('0', '0'), p('100%', '0'), p('100%', '100%'), p('0', '100%')];
    const inner = [p(px(t), px(t)), p(R(t), px(t)), p(R(t), R(t)), p(px(t), R(t))];
    return `polygon(evenodd, ${[...outer, outer[0], inner[0], ...inner.slice(1), inner[0]].join(', ')})`;
  }
  const { left: L, right: W, step: s, cut: c } = hud, k = Math.round(t * (Math.SQRT2 - 1) * 10) / 10;
  /* clockwise from the top left; the foot goes right block, down its cut corner, along the middle, up the left block's */
  const outer = [p('0', '0'), p('100%', '0'), p('100%', R(s)), p(R(W - c), R(s)), p(R(W), R(s - c)), p(R(W), '100%'), p(px(L), '100%'), p(px(L), R(s - c)), p(px(L - c), R(s)), p('0', R(s))];
  /* the same, `t` further in: a cut corner moves in by less along each of its two sides */
  const inner = [p(px(t), px(t)), p(R(t), px(t)), p(R(t), R(s + t)), p(R(W - c + k), R(s + t)), p(R(W + t), R(s - c + k)), p(R(W + t), R(t)), p(px(L + t), R(t)), p(px(L + t), R(s - c + k)), p(px(L - c + k), R(s + t)), p(px(t), R(s + t))];
  return `polygon(evenodd, ${[...outer, outer[0], inner[0], ...inner.slice(1), inner[0]].join(', ')})`;
}

/**
 * Build mode, said by the page itself: hazard tape all round the view, as round a work site, and a plate in its
 * corner. Going from the floor to build mode otherwise changes little to the eye. The tape follows the console's
 * contour while the console is shown (`hud`), and is a plain frame when it is put away. Nothing here takes the
 * pointer: the floor under it is worked on as before, edges included.
 */
export function FactoryBuildFrame({ halted, hud = null }: { halted: boolean; hud?: HudShape | null }) {
  return (
    <div className="pointer-events-none absolute inset-0" role="status" aria-label="Build mode">
      <div className="absolute inset-0" data-tape={hud ? 'contour' : 'frame'} style={{ background: STRIPES, clipPath: tapeShape(hud) }} />
      <div className={cn('absolute flex items-center gap-2 rounded px-2 py-1 text-[11px] shadow-lg', YELLOW.solid, YELLOW.onSolid)} style={{ left: TAPE + 8, top: TAPE + 8 }}>
        <b className="font-mono tracking-wider">BUILD MODE</b>
        <span className="font-medium opacity-80">{halted ? 'the floor is stopped' : 'the floor keeps running'}</span>
      </div>
    </div>
  );
}
