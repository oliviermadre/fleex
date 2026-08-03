import { cn } from '../../lib/cn';
import { useUIStore } from '../../stores/uiStore';

interface HotkeyBadgeProps {
  hotkey: string;
  visible?: boolean;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'inline';
  className?: string;
}

const positionClasses: Record<string, string> = {
  'top-right': 'absolute -top-1.5 -right-1.5',
  'top-left': 'absolute -top-1.5 -left-1.5',
  'bottom-right': 'absolute -bottom-1.5 -right-1.5',
  inline: 'relative ml-1.5',
};

export function HotkeyBadge({
  hotkey,
  visible,
  position = 'top-right',
  className,
}: HotkeyBadgeProps) {
  const altHeld = useUIStore((s) => s.altHeld);
  const isVisible = visible !== undefined ? visible : altHeld;

  if (!isVisible) return null;

  return (
    <kbd
      className={cn(
        'pointer-events-none z-50 inline-flex items-center justify-center',
        'rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)]',
        'px-1 py-0.5 text-[10px] font-mono font-semibold leading-none text-[var(--theme-text-primary)]',
        'shadow-sm',
        positionClasses[position],
        className,
      )}
    >
      {hotkey}
    </kbd>
  );
}
