import { memo } from 'react';
import { OFFICE } from './officeTheme';

interface OfficeEmptyStateProps {
  onCreateSession: () => void;
}

export const OfficeEmptyState = memo(function OfficeEmptyState({ onCreateSession }: OfficeEmptyStateProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 25,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'rgba(18, 20, 26, 0.6)',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: 48, opacity: 0.7 }}>🏢</span>
      <span
        style={{
          color: OFFICE.textPrimary,
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        Your office is empty
      </span>
      <span
        style={{
          color: OFFICE.textMuted,
          fontSize: 12,
        }}
      >
        Create a session to get started
      </span>
      <button
        onClick={onCreateSession}
        style={{
          marginTop: 8,
          padding: '8px 20px',
          borderRadius: 6,
          border: `1px solid ${OFFICE.selectionBlue}`,
          background: `linear-gradient(180deg, ${OFFICE.selectionBlue}33 0%, ${OFFICE.selectionBlue}11 100%)`,
          color: OFFICE.selectionBlue,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = `${OFFICE.selectionBlue}44`;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px ${OFFICE.selectionGlow}`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = `linear-gradient(180deg, ${OFFICE.selectionBlue}33 0%, ${OFFICE.selectionBlue}11 100%)`;
          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        }}
      >
        New Session
      </button>
    </div>
  );
});
