import { cn } from '../../lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700',
  secondary: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 active:bg-zinc-800 border border-zinc-700',
  danger: 'bg-red-600 text-white hover:bg-red-500 active:bg-red-700',
  ghost: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 active:bg-zinc-700',
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
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500',
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
