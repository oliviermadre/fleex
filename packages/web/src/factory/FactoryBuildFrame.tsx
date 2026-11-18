import { cn } from '../lib/cn';
import { tintClasses } from '../lib/tints';

const YELLOW = tintClasses('yellow');
/** How wide the tape is, and its stripes: yellow and black on the diagonal, as on the bay of what is set aside. */
const TAPE = 9, STRIPES = 'repeating-linear-gradient(45deg, var(--theme-warning) 0 10px, #18181b 10px 20px)';

/**
 * Build mode, said by the page itself: hazard tape all round the view, as round a work site, and a plate in its
 * corner. Going from the floor to build mode otherwise changes little to the eye. Nothing here takes the pointer:
 * the floor under it is worked on as before, edges included.
 */
export function FactoryBuildFrame({ halted }: { halted: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" role="status" aria-label="Build mode">
      <div className="absolute inset-0" style={{ border: `${TAPE}px solid transparent`, borderImage: `${STRIPES} ${TAPE}` }} />
      <div className={cn('absolute flex items-center gap-2 rounded px-2 py-1 text-[11px] shadow-lg', YELLOW.solid, YELLOW.onSolid)} style={{ left: TAPE + 8, top: TAPE + 8 }}>
        <b className="font-mono tracking-wider">BUILD MODE</b>
        <span className="font-medium opacity-80">{halted ? 'the floor is stopped' : 'the floor keeps running'}</span>
      </div>
    </div>
  );
}
