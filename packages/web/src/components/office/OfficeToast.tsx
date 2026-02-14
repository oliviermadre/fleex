import { memo, useEffect } from 'react';
import { OFFICE } from './officeTheme';

export interface ToastItem {
  id: number;
  message: string;
}

interface OfficeToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export const OfficeToastStack = memo(function OfficeToastStack({
  toasts,
  onDismiss,
}: OfficeToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 200,
        right: 16,
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
});

const ToastCard = memo(function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      style={{
        padding: '8px 14px',
        background: OFFICE.panelBg,
        border: `1px solid ${OFFICE.errorRed}44`,
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        color: OFFICE.textPrimary,
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'auto',
        animation: 'office-toast-in 0.2s ease-out',
      }}
    >
      <span style={{ color: OFFICE.errorRed, fontSize: 14 }}>!</span>
      <span>{toast.message}</span>
    </div>
  );
});
