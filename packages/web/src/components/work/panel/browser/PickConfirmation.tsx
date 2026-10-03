/**
 * "Added to your comment" — shown right on the picked element, over the webview,
 * so it can't be missed (the composer and its chips may be hidden behind the
 * expanded browser). The element's outline flashes, a bubble sits under it (or
 * above near the bottom edge), then everything fades away on its own unless hovered.
 */
import { useEffect, useRef, useState } from 'react';
import type { ElementContext } from '../../../shared/elementContext';

export const BUBBLE_W = 300;
export const BUBBLE_H = 64;
const GAP = 8;
const EDGE = 8;
const DISMISS_MS = 2500;

interface Box { left: number; top: number; width: number; height: number }

export interface Placement {
  highlight: Box;
  bubble: { left: number; top: number };
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Element rect (guest CSS px) → highlight box and bubble position in panel px. */
export function bubblePlacement(rect: ElementContext['rect'], zoom: number, panel: { w: number; h: number }): Placement {
  const highlight = { left: rect.x * zoom, top: rect.y * zoom, width: rect.w * zoom, height: rect.h * zoom };
  const below = highlight.top + highlight.height + GAP;
  const above = highlight.top - GAP - BUBBLE_H;
  const top = below + BUBBLE_H + EDGE <= panel.h ? below : above >= EDGE ? above : clamp(below, EDGE, panel.h - BUBBLE_H - EDGE);
  const left = clamp(highlight.left + highlight.width / 2 - BUBBLE_W / 2, EDGE, panel.w - BUBBLE_W - EDGE);
  return { highlight, bubble: { left, top } };
}

export interface PickNotice {
  /** Changes on every pick, so a new pick restarts the animation. */
  key: number;
  name: string;
  screenshotUrl?: string;
  placement: Placement;
}

export function PickConfirmation({ pick, onShow, onDone }: { pick: PickNotice; onShow: () => void; onDone: () => void }) {
  const [entered, setEntered] = useState(false);
  const [hovered, setHovered] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (hovered) return;
    const id = setTimeout(() => done.current(), DISMISS_MS);
    return () => clearTimeout(id);
  }, [hovered]);

  const { highlight, bubble } = pick.placement;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {/* The picked element, flashed in the accent color then faded. */}
      <div
        className="absolute rounded-[3px] border-2 border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] transition-opacity duration-[1200ms] ease-out"
        style={{ ...highlight, opacity: entered ? 0 : 1 }}
      />
      <div
        role="status"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="pointer-events-auto absolute flex items-center gap-3 rounded-full border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] py-2 pl-2 pr-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition-[opacity,transform] duration-200 ease-out"
        style={{
          left: bubble.left,
          top: bubble.top,
          width: BUBBLE_W,
          height: BUBBLE_H,
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)',
        }}
      >
        {pick.screenshotUrl ? (
          <img src={pick.screenshotUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] object-cover" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 text-[var(--theme-accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            <span className="truncate font-mono text-xs font-semibold">{pick.name}</span>
          </div>
          <div className="text-xs text-[var(--theme-text-secondary)]">added to your comment</div>
        </div>
        <button
          type="button"
          onClick={onShow}
          className="shrink-0 rounded-full bg-[var(--theme-accent)] px-3 py-1 text-xs font-medium text-[var(--theme-accent-fg)] hover:opacity-90"
        >
          Show
        </button>
      </div>
    </div>
  );
}
