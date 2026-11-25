import { useNavigate } from 'react-router-dom';
import { useToastStore, type ToastItem, type ToastTone } from '../../../stores/toastStore';
import { cn } from '../../../lib/cn';
import './toast.css';

/**
 * Fleex's ONE toast surface, mounted once in App.tsx (desktop and mobile).
 * Feed it with `toast.*()` from lib/toast.ts — never render another toast.
 *
 * Position is decided here and by layout hooks only (`useToastOffset`,
 * `useToastAnchor`): bottom-centre, lifted by the last pushed offset, or
 * top-centre while a layout anchors it there.
 */

/** Literal classes per tone (the Tailwind v4 scanner needs them verbatim). */
const toneDot: Record<ToastTone, string> = {
  info: 'bg-[var(--tint-blue-solid)]',
  success: 'bg-[var(--tint-green-solid)]',
  warning: 'bg-[var(--tint-yellow-solid)]',
  error: 'bg-[var(--tint-red-solid)]',
  action: 'bg-[var(--tint-purple-solid)]',
};

/** Gap kept between the stack and the bottom edge (or the pushed offset). */
const BOTTOM_GAP = '1.5rem';
const TOP_GAP = 'calc(env(safe-area-inset-top) + 40px)';

export function Toaster({ linksEnabled = true }: {
  /** `false` where in-app routes don't apply (mobile shell): `link` is ignored. */
  linksEnabled?: boolean;
}) {
  const toasts = useToastStore((s) => s.toasts);
  const offset = useToastStore((s) => s.offsets.at(-1)?.value ?? 0);
  const anchoredTop = useToastStore((s) => s.anchors.length > 0);
  const skin = useToastStore((s) => s.skins.at(-1)?.value ?? null), skinStyle = useToastStore((s) => s.skinStyle);

  if (skin === 'quiet') return null;
  /* the floor skin: lines over the page, the latest at the bottom; only the lines take the pointer */
  if (skin === 'floor') {
    return (
      <div aria-live="polite" data-skin="floor" className="fleex-toaster pointer-events-none fixed left-1/2 z-[60] flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-start gap-[3px]"
        style={{ ...skinStyle, bottom: `calc(${offset}px + 0.5rem)` }}>
        {toasts.map((t) => <FloorLine key={`${t.id}:${t.version}`} toast={t} linksEnabled={linksEnabled} live />)}
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      data-anchor={anchoredTop ? 'top' : 'bottom'}
      className={cn(
        'fleex-toaster pointer-events-none fixed z-[9999] flex gap-1.5',
        'inset-x-3 md:inset-x-auto md:left-1/2 md:w-[min(28rem,calc(100vw-2rem))] md:-translate-x-1/2',
        anchoredTop ? 'flex-col' : 'flex-col-reverse',
      )}
      style={anchoredTop ? { top: TOP_GAP } : { bottom: `calc(${offset}px + ${BOTTOM_GAP})` }}
    >
      {[...toasts].reverse().map((t) => (
        <ToastCard key={`${t.id}:${t.version}`} toast={t} linksEnabled={linksEnabled} />
      ))}
    </div>
  );
}

/** The sign at the head of a floor line, by tone: what a card says with its coloured dot. */
const floorSign: Record<ToastTone, string> = { info: '·', success: '✓', warning: '!', error: '✕', action: '●' };
const floorInk: Record<ToastTone, string> = {
  info: 'text-[var(--tint-blue-solid)]', success: 'text-[var(--tint-green-solid)]', warning: 'text-[var(--tint-yellow-solid)]',
  error: 'text-[var(--tint-red-solid)]', action: 'text-[var(--tint-purple-solid)]',
};
const clock = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * One toast as a line of text, for the floor skin and for a page that shows the toasts again (the Factory's log):
 * the time, the tone's sign (or the toast's icon), the title and the message, the action as a link. `live`: it fades
 * over its duration and pauses under the pointer, as the card's countdown does; otherwise it stays.
 */
export function FloorLine({ toast: t, linksEnabled = true, live = false }: { toast: ToastItem; linksEnabled?: boolean; live?: boolean }) {
  const navigate = useNavigate();
  const { dismiss, pause, resume } = useToastStore.getState();
  const link = linksEnabled ? t.link : undefined;
  const open = link ? () => { navigate(link); if (live) dismiss(t.id, 'click'); } : undefined;
  return (
    <div role={t.tone === 'error' ? 'alert' : 'status'} data-paused={live ? t.paused : undefined} data-keep={!live || t.durationMs === null}
      className="fleex-floor-line flex max-w-full items-baseline gap-1.5 text-[12.5px] leading-[1.35] text-[var(--theme-text-primary)]"
      style={live && t.durationMs !== null ? { animationDuration: `200ms, ${t.durationMs}ms` } : undefined}>
      <span className="pointer-events-auto flex min-w-0 items-baseline gap-1.5" onMouseEnter={live ? () => pause(t.id) : undefined} onMouseLeave={live ? () => resume(t.id) : undefined}>
        <span className="flex-none font-mono text-[10.5px] text-[var(--theme-text-muted)]">{clock(t.createdAt)}</span>
        <span className={cn('flex-none font-bold', floorInk[t.tone])} aria-hidden>{t.icon ?? floorSign[t.tone]}</span>
        {/* over the floor a long message (an assistant's answer) keeps to a few lines; the log shows it whole, its lines kept */}
        <span className={cn('min-w-0 whitespace-pre-line', live && 'line-clamp-4', open && 'cursor-pointer hover:underline')} onClick={open} title={live && t.message.length > 280 ? 'Enter shows it whole, in the log' : undefined}>
          {t.title && <b className="font-semibold">{t.title} </b>}{t.message}
          {t.detail && <span className="ml-1 font-mono text-[10.5px] text-[var(--theme-text-muted)]">{t.detail}</span>}
        </span>
        {t.choices?.map((c) => (
          <button key={c.label} type="button" className="flex-none rounded-full border border-[var(--tint-blue-solid)] px-2 font-mono text-[11px] font-semibold text-[var(--tint-blue-solid)] hover:bg-[color-mix(in_srgb,var(--tint-blue-solid)_18%,transparent)]"
            onClick={() => { c.onClick(); dismiss(t.id, 'action'); }}>{c.label}</button>
        ))}
        {t.action && (
          <button type="button" className="flex-none font-mono text-[11px] font-semibold text-[var(--tint-blue-solid)] underline"
            onClick={() => { t.action!.onClick(); dismiss(t.id, 'action'); }}>{t.action.label}</button>
        )}
      </span>
    </div>
  );
}

function ToastCard({ toast: t, linksEnabled }: { toast: ToastItem; linksEnabled: boolean }) {
  const navigate = useNavigate();
  const { dismiss, pause, resume } = useToastStore.getState();
  const link = linksEnabled ? t.link : undefined;

  const open = link
    ? () => {
        navigate(link);
        dismiss(t.id, 'click');
      }
    : undefined;

  return (
    <div
      role={t.tone === 'error' ? 'alert' : open ? 'button' : 'status'}
      tabIndex={open ? 0 : undefined}
      data-paused={t.paused}
      onMouseEnter={() => pause(t.id)}
      onMouseLeave={() => resume(t.id)}
      onFocus={() => pause(t.id)}
      onBlur={() => resume(t.id)}
      onClick={open}
      onKeyDown={
        open
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            }
          : undefined
      }
      className={cn(
        'fleex-toast pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-xl',
        'border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] py-2 pl-3.5 pr-1.5',
        'text-[12.5px] text-[var(--theme-text-primary)] shadow-xl',
        open && 'cursor-pointer hover:bg-[var(--theme-bg-overlay-hover)]',
      )}
    >
      <span className="flex h-[18px] w-4 shrink-0 items-center justify-center" aria-hidden>
        {t.icon ? (
          <span className="text-[13px] leading-none">{t.icon}</span>
        ) : (
          <span className={cn('h-1.5 w-1.5 rounded-full', toneDot[t.tone])} />
        )}
      </span>

      <div className="min-w-0 flex-1 pt-px">
        {t.title && <div className="truncate font-semibold">{t.title}</div>}
        <div className={cn('line-clamp-2 break-words', t.title && 'text-[var(--theme-text-secondary)]')}>{t.message}</div>
        {t.detail && (
          <div className="mt-px truncate font-mono text-[10.5px] text-[var(--theme-text-muted)]">{t.detail}</div>
        )}
      </div>

      {t.choices?.map((c) => (
        <button key={c.label} type="button" onClick={(e) => { e.stopPropagation(); c.onClick(); dismiss(t.id, 'action'); }}
          className="shrink-0 rounded-full border border-[var(--theme-border-input)] px-2 py-0.5 text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]">{c.label}</button>
      ))}
      {t.action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            t.action!.onClick();
            dismiss(t.id, 'action');
          }}
          className="shrink-0 rounded-full bg-[var(--theme-bg-surface)] px-2.5 py-0.5 text-xs font-semibold text-[var(--theme-accent)] hover:bg-[var(--theme-bg-hover)]"
        >
          {t.action.label}
        </button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          dismiss(t.id, 'close');
        }}
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md opacity-60 transition-opacity hover:bg-[var(--theme-bg-hover)] hover:opacity-100"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>

      {t.durationMs !== null && (
        <span
          aria-hidden
          data-testid="toast-progress"
          className={cn('fleex-toast-progress absolute bottom-0 left-0 h-[2px] w-full', toneDot[t.tone])}
          style={{ animationDuration: `${t.durationMs}ms` }}
        />
      )}
    </div>
  );
}
