import { colorForType, labelForType } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { themedTypeColor } from '../../lib/tints';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';

const SIZE_CLASSES = {
  /** Compact list rows (recent deliverables, run chips). */
  xs: 'px-1.5 py-0.5 text-[10px]',
  /** Title bars and detail headers. */
  sm: 'px-2 py-0.5 text-[11px]',
} as const;

/** Fallback when the type carries no configured colour. */
const ACCENT_BADGE = 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]';

/**
 * The ONE deliverable-type badge. Every surface showing a deliverable's type
 * goes through here so the colour configured in Settings → Deliverable types is
 * honoured app-wide, instead of each list inventing its own grey chip.
 *
 * It subscribes to the raw `types` array rather than to the store's memoised
 * `labelFor`/`colorFor` helpers (stable function refs that never notify), so a
 * badge repaints as soon as a type is recoloured, relabelled or reassigned.
 */
export function DeliverableTypeBadge({
  type,
  size = 'xs',
  outlined = false,
  className,
}: {
  type: string;
  size?: keyof typeof SIZE_CLASSES;
  /** Adds a 1px ring in the type's colour — for badges on busy backgrounds. */
  outlined?: boolean;
  className?: string;
}) {
  const types = useDeliverableTypesStore((s) => s.types);
  const label = labelForType(type, types);
  const color = themedTypeColor(colorForType(type, types));

  return (
    <span
      title={label}
      className={cn(
        'inline-block shrink-0 whitespace-nowrap rounded font-bold uppercase tracking-wider',
        SIZE_CLASSES[size],
        !color && ACCENT_BADGE,
        className,
      )}
      style={color ? {
        backgroundColor: color.bg,
        color: color.text,
        ...(outlined ? { boxShadow: `0 0 0 1px ${color.border}` } : {}),
      } : undefined}
    >
      {label}
    </span>
  );
}
