import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../components/ui/Tooltip';
import { cn } from '../lib/cn';
import { HAZARD, HAZARD_INK } from './FactoryBuildFrame';

/**
 * What the Factory's top bar held, as overlays on the floor (picked on `docs/factory/hud-overlay.html`): the counters
 * top right, with no plate behind them, and the strip over the command card that holds the emergency stop and the
 * switch that puts the console away.
 */

export interface Counts { tickets: number; items: number; running: number; maxRunning: number; runsHour: number; maxRunsHour: number; waiting: number }

const ICON = {
  ticket: <path d="M3 8a2 2 0 0 0 0 8v3h18v-3a2 2 0 0 1 0-8V5H3zM14 6v12" />,
  item: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  running: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" fill="currentColor" /></>,
  runs: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  waiting: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
} as const;
/* each counter its own ink, as resources are told apart in a game; the one that waits for you in the warning colour */
const INK: Record<keyof typeof ICON, string> = { ticket: '#c4b5fd', item: '#7dd3fc', running: '#86efac', runs: '#fdba74', waiting: 'var(--theme-warning)' };

function Counter({ icon, label, value, of, hot }: { icon: keyof typeof ICON; label: string; value: number; of?: number; hot?: boolean }) {
  return (
    <Tooltip label={label} placement="bottom">
      <span tabIndex={0} aria-label={label} className={cn('flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]', hot ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-primary)]')}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK[icon]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" style={{ color: INK[icon] }} aria-hidden="true">{ICON[icon]}</svg>
        {value}{of !== undefined && <small className="text-[11px] font-medium text-[var(--theme-text-secondary)]">/{of}</small>}
      </span>
    </Tooltip>
  );
}

/** The floor's counters, top right over the floor, the way a game shows its resources. */
export function FactoryCounters({ c }: { c: Counts }) {
  return (
    <div className="pointer-events-auto absolute right-4 top-2.5 z-[5] flex items-center gap-4" aria-label="Floor counters">
      <Counter icon="ticket" value={c.tickets} label={`${c.tickets} ticket${c.tickets === 1 ? '' : 's'} on the floor`} />
      <Counter icon="item" value={c.items} label={`${c.items} item${c.items === 1 ? '' : 's'} on the floor (mail, messages, notifications)`} />
      <Counter icon="running" value={c.running} of={c.maxRunning} label={`${c.running} run${c.running === 1 ? '' : 's'} in progress, ${c.maxRunning} at most at once`} />
      <Counter icon="runs" value={c.runsHour} of={c.maxRunsHour} label={`${c.runsHour} run${c.runsHour === 1 ? '' : 's'} started this hour, ${c.maxRunsHour} at most per hour`} />
      <Counter icon="waiting" value={c.waiting} hot={c.waiting > 0} label={c.waiting ? `${c.waiting} wait${c.waiting === 1 ? 's' : ''} for you: the list top left, N goes through them` : 'Nothing waits for you'} />
    </div>
  );
}

/** How long the stop is held before the floor stops: a stray click does nothing. */
export const HOLD_MS = 1000;

const chip = 'relative flex h-[26px] items-center gap-1.5 overflow-hidden rounded-md border px-2.5 font-mono text-[11px] font-semibold';
const plainChip = 'border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]';

/**
 * The emergency stop, as a button of the strip: a red power sign and a hazard edge. Held for a second, it stops the
 * floor (a red fill runs across it meanwhile; let go before, nothing happens). Stopped, it is a plain click to restart.
 * Space or Enter held do the same as the pointer.
 */
export function StopChip({ halted, onHalt }: { halted: boolean; onHalt: (on: boolean) => void }) {
  const [held, setHeld] = useState(0);
  const timer = useRef<{ raf: number; t0: number } | null>(null);
  const stop = () => { if (timer.current) cancelAnimationFrame(timer.current.raf); timer.current = null; setHeld(0); };
  useEffect(() => stop, []);
  const start = () => {
    if (halted || timer.current) return;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setHeld(p);
      if (p >= 1) { stop(); onHalt(true); return; }
      timer.current = { raf: requestAnimationFrame(step), t0 };
    };
    timer.current = { raf: requestAnimationFrame(step), t0 };
  };
  if (halted) {
    return (
      <button type="button" className={cn(chip, 'border-[var(--theme-danger)] bg-[color-mix(in_srgb,var(--theme-danger)_22%,var(--theme-bg-surface))] text-[var(--theme-text-primary)]')}
        onClick={() => onHalt(false)} title="The floor is stopped. Restart it: belts, arms and stations carry on from where they stood; the runs that were cut start again">
        Stopped
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" fill="var(--theme-success)" /></svg>
        <span className="text-[var(--theme-success)]">Restart</span>
      </button>
    );
  }
  return (
    <button type="button" className={cn(chip, plainChip, 'pl-3.5')} aria-label="Emergency stop: hold to stop the floor"
      title="Emergency stop: hold for a second. Every belt, arm and station stops at once, and the runs in progress are cut; they start again when the floor is restarted"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); start(); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop(); }}
      onClick={(e) => e.preventDefault()}>
      <span className="absolute inset-y-0 left-0 w-[5px]" style={{ background: `repeating-linear-gradient(-45deg, ${HAZARD} 0 3px, ${HAZARD_INK} 3px 6px)` }} aria-hidden="true" />
      <span className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)]" style={{ width: `${held * 100}%` }} data-testid="stop-fill" aria-hidden="true" />
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--theme-danger)" strokeWidth="2.6" strokeLinecap="round" className="relative" aria-hidden="true"><path d="M12 3v8" /><path d="M6.3 7.5a8 8 0 1 0 11.4 0" /></svg>
      <span className="relative text-[var(--theme-danger)]">Stop</span>
      <span className="relative font-medium text-[var(--theme-text-muted)]">hold</span>
    </button>
  );
}

/** The strip over the command card: the stop, and the switch that puts the console away (U). */
export function ConsoleStrip({ halted, onHalt, hidden, onHide, className }: { halted: boolean; onHalt: (on: boolean) => void; hidden: boolean; onHide: () => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded-tl-lg border border-b-0 border-r-0 border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1.5', className)} role="toolbar" aria-label="Floor controls">
      <StopChip halted={halted} onHalt={onHalt} />
      <button type="button" onClick={onHide} aria-expanded={!hidden} aria-label={hidden ? 'Show the console' : 'Hide the console'} className={cn(chip, plainChip)}
        title={hidden ? 'Bring the console back (U)' : 'Hide the console and give the floor the whole page (U). The keys of the command card still work.'}>
        <kbd className="font-mono">U</kbd>{hidden ? 'show' : 'hide'}
      </button>
    </div>
  );
}
