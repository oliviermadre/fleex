import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';

type DotColor = 'green' | 'orange' | 'gray';

const DOT_COLORS: Record<DotColor, string> = {
  green: '#34d399',
  orange: '#fbbf24',
  gray: '#71717a',
};

const FAVICON_SIZE = 32;
const DOT_RADIUS = 6;
const DOT_BORDER = 1.5;

function computeAggregateStatus(
  sessionGroups: ReturnType<typeof useSessionStore.getState>['sessionGroups'],
): DotColor {
  let hasActive = false;

  for (const group of sessionGroups) {
    for (const wt of group.worktrees) {
      for (const session of wt.sessions) {
        if (session.type !== 'claude' || session.status !== 'running' || !session.claudeActivity) {
          continue;
        }
        const activity = session.claudeActivity;

        if (
          activity === 'waiting_tool_approval' ||
          activity === 'waiting_user_choice' ||
          activity === 'waiting_plan_approval'
        ) {
          return 'orange'; // highest priority — return immediately
        }

        if (activity === 'working' || activity === 'executing') {
          hasActive = true;
        }
      }
    }
  }

  return hasActive ? 'green' : 'gray';
}

function drawFavicon(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  color: DotColor,
) {
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;

  // Draw the favicon image
  ctx.drawImage(image, 0, 0, FAVICON_SIZE, FAVICON_SIZE);

  // Draw dot border (dark circle behind)
  const cx = FAVICON_SIZE - DOT_RADIUS - DOT_BORDER;
  const cy = FAVICON_SIZE - DOT_RADIUS - DOT_BORDER;

  ctx.beginPath();
  ctx.arc(cx, cy, DOT_RADIUS + DOT_BORDER, 0, Math.PI * 2);
  ctx.fillStyle = '#18181b'; // zinc-900
  ctx.fill();

  // Draw colored dot
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = DOT_COLORS[color];
  ctx.fill();

  // Update the link element
  const link = document.getElementById('dynamic-favicon') as HTMLLinkElement | null;
  if (link) {
    link.href = canvas.toDataURL('image/png');
  }
}

export function useFaviconStatus() {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastColorRef = useRef<DotColor | null>(null);

  // Load image once
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/favicon.jpg';
    img.onload = () => {
      imageRef.current = img;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvasRef.current = canvas;
      ctxRef.current = ctx;

      // Draw initial state
      const groups = useSessionStore.getState().sessionGroups;
      const color = computeAggregateStatus(groups);
      lastColorRef.current = color;
      drawFavicon(canvas, ctx, img, color);
    };
  }, []);

  // Subscribe to session store changes
  useEffect(() => {
    const unsub = useSessionStore.subscribe((state) => {
      const img = imageRef.current;
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!img || !canvas || !ctx) return;

      const color = computeAggregateStatus(state.sessionGroups);
      // Only redraw when color actually changes
      if (color === lastColorRef.current) return;
      lastColorRef.current = color;

      drawFavicon(canvas, ctx, img, color);
    });

    return unsub;
  }, []);
}
