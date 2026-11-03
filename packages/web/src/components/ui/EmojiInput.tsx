import { cn } from '../../lib/cn';

interface EmojiInputProps extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Compact one-emoji field. Free text on purpose: the OS picker (⌃⌘Space on
 * macOS, Win+. on Windows) or a paste does the choosing — no picker dependency.
 * Callers normalise the value with `normalizeEmoji` when they save it.
 */
export function EmojiInput({ value, onChange, className, ...props }: EmojiInputProps) {
  return (
    <input
      aria-label="Emoji"
      title="Emoji (⌃⌘Espace pour le sélecteur)"
      autoComplete="off"
      spellCheck={false}
      className={cn(
        'w-12 shrink-0 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-1 py-1 text-center text-lg leading-none text-[var(--theme-text-primary)]',
        'focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...props}
    />
  );
}
