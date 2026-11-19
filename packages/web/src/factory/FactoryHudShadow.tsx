import { useEffect, useState } from 'react';
import { isLight } from './floorLook';
import type { HudShape } from './hudShape';

/** Whether the theme in use is a light one: read from the floor's colour, and read again whenever the theme changes. */
export function useLightTheme(): boolean {
  const read = () => (typeof document === 'undefined' ? false : isLight(getComputedStyle(document.documentElement).getPropertyValue('--theme-bg-surface').trim()));
  const [light, setLight] = useState(read);
  useEffect(() => {
    setLight(read());
    /* a theme is applied by setting its colours on the root element: that is what to watch */
    const seen = new MutationObserver(() => setLight(read()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    return () => seen.disconnect();
  }, []);
  return light;
}

/**
 * Everything under the console's contour, as a shape, in the floor's view: the two side blocks from their tops
 * down, and from the foot of the view down for the middle. It runs past the foot of the view, where the console is.
 */
export function hudShadowShape(hud: HudShape): string {
  const { left: L, right: R, step: s, cut: c } = hud, top = `calc(100% - ${s}px)`, corner = `calc(100% - ${s - c}px)`, far = 'calc(100% + 60px)';
  return `polygon(0 ${top}, ${L - c}px ${top}, ${L}px ${corner}, ${L}px 100%, calc(100% - ${R}px) 100%, calc(100% - ${R}px) ${corner}, calc(100% - ${R - c}px) ${top}, 100% ${top}, 100% ${far}, 0 ${far})`;
}

/**
 * The shadow the console casts on the floor, along its whole contour: without it the console lies flat on the floor,
 * on a dark theme as on a light one. It is one still shape, blurred once, laid on the floor under the console (and
 * under the build tape): nothing in the console is filtered, so what moves in it costs nothing more. Deep on a dark
 * floor, where a shadow hardly shows; light on a light one.
 */
export function FactoryHudShadow({ hud }: { hud: HudShape }) {
  const light = useLightTheme();
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-hud-shadow={light ? 'light' : 'dark'} style={{ filter: `blur(${light ? 12 : 14}px)`, opacity: light ? 0.38 : 0.95, transform: 'translateY(-9px)' }}>
      <div className="absolute inset-0 bg-black" style={{ clipPath: hudShadowShape(hud) }} />
    </div>
  );
}
