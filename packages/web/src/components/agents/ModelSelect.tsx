import { useMemo, type ReactNode } from 'react';
import type { ModelFamily, ModelOption } from '@fleex/shared';
import { useModels } from '../../hooks/useModels';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { ModelBadge } from './ModelBadge';

// Family display order + section headers. Mirrors FAMILY_ORDER in the server's
// ModelService so the grouped dropdown matches the sorted API list.
const FAMILY_ORDER: ModelFamily[] = ['fable', 'opus', 'sonnet', 'haiku', 'other'];
const FAMILY_LABEL: Record<ModelFamily, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  other: 'Other',
};

interface LeadingOption {
  value: string;
  label: string;
}

interface ModelSelectProps {
  /** Current model id, or the leadingOption's value when nothing is overridden. */
  value: string;
  onChange: (value: string) => void;
  /**
   * A non-model entry rendered above the family sections — e.g.
   * { value: '', label: 'Auto (persona)' } or { value: 'inherited', … }.
   */
  leadingOption?: LeadingOption;
  /** 'field' = full-width form control (default). 'inline' = compact toolbar chip. */
  variant?: 'inline' | 'field';
  /** Optional leading glyph (e.g. 🤖) shown before the value in the trigger. */
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  id?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Model picker with family-grouped, colour-badged options — a custom dropdown
 * replacing the native <select>, which cannot render per-option colours or
 * section separators. Groups by ModelFamily (Fable → Opus → Sonnet → Haiku),
 * each option showing its ModelBadge chip. The current value's id can be one
 * the live list no longer contains (a persona pinned to a removed model): it is
 * surfaced as a standalone row so the selection stays visible.
 */
export function ModelSelect({
  value,
  onChange,
  leadingOption,
  variant = 'field',
  icon,
  disabled,
  title,
  id,
  className,
  ariaLabel,
}: ModelSelectProps) {
  const { models } = useModels();
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
    role: 'listbox',
  });

  const sections = useMemo(() => {
    const byFamily = new Map<ModelFamily, ModelOption[]>();
    for (const m of models) {
      const list = byFamily.get(m.family) ?? [];
      list.push(m);
      byFamily.set(m.family, list);
    }
    return FAMILY_ORDER.map((family) => ({
      family,
      label: FAMILY_LABEL[family],
      models: byFamily.get(family) ?? [],
    })).filter((s) => s.models.length > 0);
  }, [models]);

  const selected = models.find((m) => m.id === value);
  const isLeading = leadingOption != null && value === leadingOption.value;
  // Value is an id the live list doesn't contain (e.g. a pinned, now-removed
  // model) — keep it visible rather than silently blanking the control.
  const unknownId = !isLeading && !selected && value !== '' ? value : null;

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const triggerContent: ReactNode = isLeading ? (
    <span className="truncate">{leadingOption.label}</span>
  ) : selected ? (
    variant === 'inline' ? (
      <ModelBadge modelId={selected.id} />
    ) : (
      <>
        <ModelBadge modelId={selected.id} />
        <span className="truncate">{selected.label}</span>
      </>
    )
  ) : unknownId ? (
    <ModelBadge modelId={unknownId} />
  ) : (
    <span className="truncate text-[var(--theme-text-muted)]">Select model…</span>
  );

  const triggerBase =
    variant === 'inline'
      ? 'flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-secondary)]'
      : 'flex w-full items-center gap-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)]';

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        id={id}
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          triggerBase,
          'cursor-pointer transition-colors hover:border-[var(--theme-accent)]/50 focus:border-[var(--theme-accent)] focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-[var(--theme-accent)]',
          className,
        )}
        {...getReferenceProps()}
      >
        {icon != null && <span className="shrink-0 opacity-60">{icon}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{triggerContent}</span>
        <svg
          className={cn('shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[1000] min-w-[240px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {leadingOption != null && (
              <OptionRow selected={isLeading} onSelect={() => handleSelect(leadingOption.value)}>
                <span className="flex-1 truncate text-[var(--theme-text-primary)]">{leadingOption.label}</span>
              </OptionRow>
            )}
            {unknownId != null && (
              <OptionRow selected onSelect={() => handleSelect(unknownId)}>
                <ModelBadge modelId={unknownId} />
              </OptionRow>
            )}
            {sections.map((section) => (
              <div key={section.family}>
                <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">
                  {section.label}
                </div>
                {section.models.map((m) => (
                  <OptionRow key={m.id} selected={m.id === value} onSelect={() => handleSelect(m.id)}>
                    <ModelBadge modelId={m.id} />
                    <span className="flex-1 truncate text-[var(--theme-text-primary)]">{m.label}</span>
                  </OptionRow>
                ))}
              </div>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function OptionRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
        selected ? 'bg-[var(--theme-accent)]/15' : 'hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      <span className="flex w-3 shrink-0 justify-center text-[var(--theme-accent)]">{selected ? '✓' : ''}</span>
      {children}
    </button>
  );
}
