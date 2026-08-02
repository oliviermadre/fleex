import { cn } from '../../lib/cn';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, options, className, id, ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-[var(--theme-text-secondary)]">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cn(
          'rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)]',
          'focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
          'appearance-none',
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
