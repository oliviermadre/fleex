import { cn } from '../../lib/cn';
import { useToastStore, type ToastType } from '../../stores/toastStore';

/**
 * Left-border accent per type (theme-aware tint solids, literal for the
 * Tailwind scanner). The surface itself stays fully opaque
 * (`--theme-bg-overlay`) so the toast message is always 100% readable over the
 * page content — the type is conveyed by the coloured accent, not a translucent
 * tinted background. Mirrors `NotificationCard.levelAccent`.
 */
const typeAccent: Record<ToastType, string> = {
  error: 'border-l-[var(--tint-red-solid)]',
  warning: 'border-l-[var(--tint-yellow-solid)]',
  success: 'border-l-[var(--tint-green-solid)]',
  info: 'border-l-[var(--tint-blue-solid)]',
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
            'flex items-start gap-2 rounded-md border border-[var(--theme-border)] border-l-2',
            'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]',
            'px-3 py-2 text-xs shadow-lg animate-in fade-in slide-in-from-top-2 duration-200',
            typeAccent[toast.type],
          )}
        >
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            onClick={() => removeToast(toast.id)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
