import { useToastStore, type ToastType } from '../../stores/toastStore';
import { cn } from '../../lib/cn';

const typeStyles: Record<ToastType, string> = {
  error: 'border-red-500/30 bg-red-950 text-red-400',
  warning: 'border-amber-500/30 bg-amber-950 text-amber-400',
  success: 'border-emerald-500/30 bg-emerald-950 text-emerald-400',
  info: 'border-blue-500/30 bg-blue-950 text-blue-400',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg animate-in fade-in slide-in-from-top-2 duration-200',
            typeStyles[toast.type],
          )}
        >
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            onClick={() => removeToast(toast.id)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
