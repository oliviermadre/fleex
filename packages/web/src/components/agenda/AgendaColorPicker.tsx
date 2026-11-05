import { useState } from 'react';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { CheckIcon } from '../ui/icons/AgendaIcons';
import { BASE_SWATCHES, colorToken, type AgendaColor } from './agendaLabels';

/** The hue wheel of the custom-colour button. */
const WHEEL = 'conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)';

function Palette({ hue, custom, onPick }: { hue: AgendaColor; custom: boolean; onPick: (hue: AgendaColor | null, close?: boolean) => void }) {
  const isCustom = !BASE_SWATCHES.includes(hue);
  return (
    <>
      <div className="grid grid-cols-5 gap-1.5">
        {BASE_SWATCHES.map((h) => (
          <button
            key={h}
            type="button"
            aria-label={h}
            title={h}
            aria-pressed={h === hue}
            onClick={() => onPick(h)}
            className="grid h-6 w-6 place-items-center rounded-full hover:ring-2 hover:ring-[var(--theme-border)]"
            style={{ background: colorToken(h, 'solid') }}
          >
            {h === hue && <CheckIcon size={12} className="text-white [stroke-width:3]" />}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-[var(--theme-border)] pt-2">
        {/* The native colour input brings the full picker (and the eyedropper where the browser has one). */}
        <label
          title="Custom colour"
          className={cn('relative grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full hover:ring-2 hover:ring-[var(--theme-border)]', isCustom && 'ring-2 ring-[var(--theme-text-primary)]')}
          style={{ background: WHEEL }}
        >
          <input
            type="color"
            aria-label="Custom colour"
            value={hue.startsWith('#') ? hue : '#3b82f6'}
            onChange={(e) => onPick(e.target.value as AgendaColor, false)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          {isCustom && <span className="h-3 w-3 rounded-full border border-white" style={{ background: hue }} />}
        </label>
        <span>{isCustom ? hue : 'Custom colour'}</span>
      </div>
      {custom && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-2 w-full rounded px-1 py-0.5 text-left text-[var(--theme-accent)] hover:bg-[var(--theme-bg-hover)]"
        >
          Default colour
        </button>
      )}
    </>
  );
}

const swatchClass = (visible: boolean) => cn(
  'grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-[var(--theme-bg-overlay)]',
  visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
);

interface PickerProps {
  /** What is being coloured, for the button's accessible name. */
  name: string;
  /** The current hue (picked or default). */
  hue: AgendaColor;
  /** Whether `hue` is a user pick (vs the default). */
  custom: boolean;
  /** `null` = back to the default. */
  onPick: (hue: AgendaColor | null) => void;
}

/**
 * Same picker, unfolding under its row instead of in a popover — for rows
 * that already sit in a popover (the routine menu), where a second floating
 * layer would close the first one. The row must be `flex-wrap`.
 */
export function AgendaInlineColorPicker({ name, hue, custom, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={`Colour of ${name}`} aria-expanded={open} title={`Colour of ${name}`} onClick={() => setOpen((o) => !o)} className={swatchClass(custom || open)}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorToken(hue, 'solid') }} />
      </button>
      {open && (
        <div className="basis-full py-1.5 pl-6" data-testid="agenda-color-picker">
          <Palette hue={hue} custom={custom} onPick={(h, close = true) => { onPick(h); if (close) setOpen(false); }} />
        </div>
      )}
    </>
  );
}

/**
 * A colour swatch at the right of a sidebar row (a label). It opens the tint
 * palette (15 base colours and a custom one); "Default colour" drops the pick. Shown on row hover, and always
 * once a colour has been picked.
 */
export function AgendaColorPicker({ name, hue, custom, onPick }: PickerProps) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'right-start', role: 'dialog' });
  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        aria-label={`Colour of ${name}`}
        title={`Colour of ${name}`}
        className={swatchClass(custom || open)}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorToken(hue, 'solid') }} />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            data-testid="agenda-color-picker"
            className="z-50 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2 text-xs text-[var(--theme-text-secondary)] shadow-xl"
          >
            <Palette hue={hue} custom={custom} onPick={(h, close = true) => { onPick(h); if (close) setOpen(false); }} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
