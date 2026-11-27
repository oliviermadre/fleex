import { createContext, useContext, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/cn';
import { editable, KBD, type PopupSize } from './FactoryPopup';
import { FIcon } from './icons';
import type { SkinChrome } from './skins';
import type { Lamp, TabId } from './stationConsole';

/** The skin the floor is painted in, for what the Factory opens over it (a portal, out of `.factory-page`). */
/**
 * A status colour made readable as small text on a tint of itself: a quarter of the theme's text colour is mixed
 * in, so warning and danger pills keep their hue and clear 4.5:1 in every skin, light or dark.
 */
export const legible = (tone: string) => `color-mix(in srgb, ${tone} 75%, var(--theme-text-primary))`;

export const FactorySkinContext = createContext<{ id: string; chrome: SkinChrome | null }>({ id: 'fleex', chrome: null });

const HEIGHT: Record<PopupSize, string> = {
  full: 'mt-[var(--header-height)] h-[calc(100vh-var(--header-height)-24px)]',
  large: 'mt-[var(--header-height)] h-[min(860px,calc(100vh-var(--header-height)-24px))]',
  fit: 'max-h-[calc(100vh-2*var(--header-height)-24px)]',
};
/* how each skin frames a popup: Fleex's own is the theme's; neon glows in its accent; pixel is square, with a hard shadow */
const FRAME: Record<string, CSSProperties> = {
  neon: { borderColor: 'var(--theme-accent)', boxShadow: '0 0 0 1px var(--theme-accent), 0 0 28px color-mix(in srgb, var(--theme-accent) 40%, transparent), 0 24px 64px rgba(0, 0, 0, 0.5)' },
  pixel: { borderRadius: 0, borderWidth: 2, boxShadow: '6px 6px 0 rgba(0, 0, 0, 0.45)' },
};
const frameOf = (id: string): CSSProperties | undefined => FRAME[id.startsWith('pixel') ? 'pixel' : id];

/**
 * The Factory's console popup: `FactoryPopup`'s frame (the same Modal, sizes and keys) with an identity plate instead
 * of its bar, in the colours of the floor's skin. The skin's font is kept for what is display (the plate's name, the
 * tabs, headings, labels, figures: `.fx-display`); fields and long text keep Fleex's. The workbench keeps `FactoryPopup`.
 */
export function FactoryConsolePopup({ label, colour, plate, tabs, children, onClose, onKey, size = 'large', maxWidth, zIndexClass = 'z-40', guardEscape = true }: {
  label: string; colour: string; plate: ReactNode; tabs?: ReactNode; children: ReactNode; onClose: () => void;
  onKey?: (e: KeyboardEvent) => void; size?: PopupSize; maxWidth: string; zIndexClass?: string;
  /** Escape typed in a field stays in the field (the default); false: it closes the popup from anywhere. */
  guardEscape?: boolean;
}) {
  const skin = useContext(FactorySkinContext), body = useRef<HTMLElement>(null);
  const backdrop = useMemo<CSSProperties | undefined>(() => (skin.chrome
    ? { ...skin.chrome.vars, colorScheme: skin.chrome.light ? 'light' : 'dark', ...(skin.chrome.font ? { '--fx-font': skin.chrome.font } : {}) } as CSSProperties
    : undefined), [skin.chrome]);
  useEffect(() => {
    if (!onKey) return;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || editable(e.target)) return;
      const tops = document.querySelectorAll('[data-overlay-top]');
      if (tops[tops.length - 1] !== body.current?.closest('[data-overlay-top]') || document.querySelector('[data-floating-ui-portal]')) return;
      onKey(e);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [onKey]);
  return (
    <Modal open onClose={onClose} variant="glass" flush guardEscape={guardEscape} zIndexClass={zIndexClass} maxWidth={maxWidth} className={cn('mx-3 flex flex-col', HEIGHT[size])}
      backdropStyle={backdrop} dialogStyle={frameOf(skin.id)}>
      <section ref={body} aria-label={label} data-skin={skin.id} style={{ '--mc': colour } as CSSProperties}
        className="fx-console @container flex min-h-0 flex-1 flex-col text-[var(--theme-text-primary)]">
        <div className="flex-none border-b border-[var(--theme-border)]" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--mc) 14%, transparent), transparent 62%)' }}>
          {plate}
          {tabs}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    </Modal>
  );
}

/** Its way out, at the end of a plate. */
export const CloseButton = ({ onClose, label = 'Close' }: { onClose: () => void; label?: string }) => (
  <Button size="sm" variant="ghost" className="flex-none" onClick={onClose} aria-label={label}>
    <span className="@max-[700px]:hidden">{label}</span> <kbd className={KBD}>Esc</kbd>
  </Button>
);

const LAMP: Record<Lamp, { text: string; tone: string; title: string; shape: string }> = {
  running: { text: 'Running', tone: 'var(--theme-success)', title: 'It runs on what comes in.', shape: 'rounded-full shadow-[0_0_6px_var(--lamp)]' },
  stopped: { text: 'Stopped', tone: 'var(--theme-danger)', title: 'It takes tickets in and starts nothing on them.', shape: 'rounded-[1px]' },
  unset: { text: 'Unset', tone: 'var(--theme-warning)', title: 'Nothing chosen to run: it takes tickets in and starts nothing on them.', shape: 'rounded-full border-[1.5px] border-[var(--lamp)] !bg-transparent' },
  halted: { text: 'Halted', tone: 'var(--theme-danger)', title: 'The emergency stop is on: nothing runs on the floor.', shape: 'rounded-[1px]' },
};
/** A station's lamp, as on the floor. */
export function LampPill({ lamp }: { lamp: Lamp }) {
  const l = LAMP[lamp];
  return (
    <span className="fx-display inline-flex flex-none items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
      style={{ '--lamp': l.tone, color: l.tone, borderColor: `color-mix(in srgb, ${l.tone} 45%, transparent)` } as CSSProperties} title={l.title} role="status">
      <span aria-hidden className={cn('h-2 w-2 bg-[var(--lamp)]', l.shape)} />{l.text}
    </span>
  );
}

export interface Counter { value: ReactNode; label: string; title?: string; loading?: boolean }
/**
 * The identity plate: the machine in a medallion of its colour, its name and kind, its lamp, what needs you, its
 * figures, its actions. On a narrow popup, figures and actions go on lines of their own.
 */
export function Plate({ icon, name, kind, lamp, needs, counters, actions, small }: {
  icon: string; name: string; kind: ReactNode; lamp?: Lamp | null; needs?: number; counters?: Counter[]; actions: ReactNode; small?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className={cn('flex flex-none items-center justify-center rounded-xl border-2 text-[var(--mc)]', small ? 'h-10 w-10' : 'h-14 w-14 @max-[700px]:h-[42px] @max-[700px]:w-[42px]')}
        style={{ borderColor: 'color-mix(in srgb, var(--mc) 60%, transparent)', background: 'color-mix(in srgb, var(--mc) 16%, var(--theme-bg-surface))' }} aria-hidden>
        <FIcon name={icon} size={small ? 22 : 32} />
      </div>
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <h2 className={cn('fx-display truncate font-semibold leading-tight', small ? 'text-base' : 'text-xl @max-[700px]:text-[17px]')} title={name}>{name}</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
          <span className="min-w-0 truncate">{kind}</span>
          {lamp && <LampPill lamp={lamp} />}
          {!!needs && (
            <span className="fx-display inline-flex flex-none items-center rounded-full bg-[color-mix(in_srgb,var(--theme-warning)_22%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: legible('var(--theme-warning)') }}>
              {needs} need{needs === 1 ? 's' : ''} you
            </span>
          )}
        </div>
      </div>
      {counters && counters.length > 0 && (
        <dl className="flex flex-none divide-x divide-[var(--theme-border)] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)]/60 @max-[700px]:w-full">
          {counters.map((c) => (
            <div key={c.label} className="flex min-w-16 flex-1 flex-col items-center px-3 py-1" title={c.title}>
              <dd className="font-mono text-[17px] tabular-nums leading-tight">{c.loading ? <Skeleton className="my-1 h-4 w-10" /> : c.value}</dd>
              <dt className="fx-display text-[9.5px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{c.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-none items-center gap-1 @max-[700px]:w-full @max-[700px]:justify-end">{actions}</div>
    </div>
  );
}

export interface TabSpec { id: TabId; label: string; icon: string; badge?: string }
/**
 * The tabs of a popup (WAI-ARIA tablist): arrows go to the previous or next one and open it, Home and End the first and
 * last. `onChange` is called before the panel changes: a field being typed in is left first, so what it holds is saved.
 */
export function ConsoleTabs({ tabs, active, onChange, idBase }: { tabs: TabSpec[]; active: TabId; onChange: (id: TabId) => void; idBase: string }) {
  const list = useRef<HTMLDivElement>(null);
  const go = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length]!;
    onChange(t.id);
    window.setTimeout(() => list.current?.querySelector<HTMLButtonElement>(`#${idBase}-tab-${t.id}`)?.focus());
  };
  const key = (e: ReactKeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(tabs.length - 1); else return;
    e.preventDefault();
  };
  return (
    <div ref={list} role="tablist" aria-label="Sections" onKeyDown={key} className="flex gap-1 overflow-x-auto px-3 [scrollbar-width:none]">
      {tabs.map((t, i) => {
        const on = t.id === active;
        return (
          <button key={t.id} id={`${idBase}-tab-${t.id}`} type="button" role="tab" aria-selected={on} aria-controls={`${idBase}-panel`} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)} title={`${t.label} (${i + 1})`}
            className={cn('fx-display relative flex flex-none items-center gap-1.5 border-b-2 px-3 pb-2 pt-1.5 text-xs font-semibold uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
              on ? 'border-[var(--mc)] text-[var(--theme-text-primary)]' : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]')}>
            <span className={on ? 'text-[var(--mc)]' : undefined}><FIcon name={t.icon} size={15} /></span>
            {t.label}
            {t.badge && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-warning)] px-1 font-mono text-[10px] text-[var(--theme-bg-base)]" aria-label={t.badge === '!' ? 'needs a look' : `${t.badge} waiting on you`}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A section's heading: an icon, small capitals, and what acts on it to the right. */
export const SectionHead = ({ icon, children, right }: { icon?: string; children: ReactNode; right?: ReactNode }) => (
  <div className="flex min-h-7 items-center justify-between gap-2">
    <h3 className="fx-display flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-text-secondary)]">
      {icon && <FIcon name={icon} size={14} />}<span className="truncate">{children}</span>
    </h3>
    {right}
  </div>
);

/** Nothing to show: a dashed frame, a faded icon, what it means. */
export const EmptyState = ({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--theme-border-input)] px-4 py-8 text-center">
    <span className="text-[var(--theme-text-muted)] opacity-55" aria-hidden><FIcon name={icon} size={40} /></span>
    <div className="text-sm font-medium text-[var(--theme-text-secondary)]">{title}</div>
    {sub && <div className="text-xs text-[var(--theme-text-muted)]">{sub}</div>}
    {action}
  </div>
);

/** What is loading: a bar, no word. */
export const Skeleton = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('block rounded bg-[var(--theme-bg-overlay)] motion-safe:animate-pulse', className)} />
);
