import { cn } from '../../lib/cn';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, options, className, id, ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-zinc-400">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cn(
          'rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100',
          'focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]',
          'appearance-none',
          className
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
