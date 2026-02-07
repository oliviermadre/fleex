import { cn } from '../../lib/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-zinc-400">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100',
          'placeholder:text-zinc-500',
          'focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]',
          className
        )}
        {...props}
      />
    </div>
  );
}
