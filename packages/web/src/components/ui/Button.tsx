import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-active)]',
  secondary: 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-border-input)] active:bg-[var(--theme-bg-overlay)] border border-[var(--theme-border-input)]',
  danger: cn('bg-[var(--theme-danger)] text-[var(--theme-danger-fg)]', tintClasses('red').hoverSolid, tintClasses('red').hoverOnSolid, 'active:bg-[var(--theme-danger)]'),
  ghost: 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)] active:bg-[var(--theme-border-input)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled}
      {...props}
    />
  );
}
