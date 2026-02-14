import { memo } from 'react';
import { OFFICE } from './officeTheme';

interface OfficeToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}

export const OfficeToolbar = memo(function OfficeToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
}: OfficeToolbarProps) {
  const percentage = Math.round(zoom * 100);

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: OFFICE.panelBg,
        border: `1px solid ${OFFICE.panelBorderDim}`,
        borderRadius: 6,
        padding: '2px 4px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
      }}
    >
      <ToolbarButton label="-" title="Zoom out" onClick={onZoomOut} />
      <span
        style={{
          color: OFFICE.textSecondary,
          fontSize: 10,
          fontFamily: 'monospace',
          minWidth: 36,
          textAlign: 'center',
          userSelect: 'none',
        }}
      >
        {percentage}%
      </span>
      <ToolbarButton label="+" title="Zoom in" onClick={onZoomIn} />
      <div style={{ width: 1, height: 16, background: OFFICE.panelBorderDim, margin: '0 2px' }} />
      <ToolbarButton label="&#8962;" title="Reset view" onClick={onResetView} />
    </div>
  );
});

function ToolbarButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        border: 'none',
        background: 'transparent',
        color: OFFICE.textSecondary,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = OFFICE.panelHighlight;
        (e.currentTarget as HTMLElement).style.color = OFFICE.textPrimary;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = OFFICE.textSecondary;
      }}
    >
      {label}
    </button>
  );
}
