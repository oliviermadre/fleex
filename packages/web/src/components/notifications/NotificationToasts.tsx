import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../stores/notificationStore';
import { NotificationCard } from './NotificationCard';

/**
 * Fleex Pulse toast surface — ephemeral, auto-dismissed cards anchored
 * bottom-right (kept clear of the top-right system error toasts). Clicking a
 * toast deep-links to the relevant ticket; the entry remains in the bell.
 */
export function NotificationToasts() {
  const navigate = useNavigate();
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex w-80 max-w-[calc(100vw-2rem)] flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="animate-in fade-in slide-in-from-bottom-2 duration-200">
          <NotificationCard
            notification={toast}
            onClick={() => {
              navigate(toast.link);
              dismissToast(toast.id);
            }}
            onClose={() => dismissToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
}
