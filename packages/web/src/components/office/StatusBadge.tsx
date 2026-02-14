import { memo } from 'react';
import { getStatusColor, getStatusLabel } from './officeTheme';

interface StatusBadgeProps {
  activity: string;
}

const STATUS_EMOJI: Record<string, string> = {
  idle: '💤',
  working: '⌨️',
  executing: '⚡',
  thinking: '🤔',
  error: '❌',
};

function getEmoji(activity: string): string {
  if (activity.startsWith('waiting_')) return '🤔';
  return STATUS_EMOJI[activity] ?? '💤';
}

/** Robot activity badge shown above robots */
export const StatusBadge = memo(function StatusBadge({ activity }: StatusBadgeProps) {
  const color = getStatusColor(activity);
  const emoji = getEmoji(activity);
  const label = getStatusLabel(activity);

  return (
    <div
      style={{
        position: 'absolute',
        top: -8,
        right: -4,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '1px 4px',
        borderRadius: 6,
        backgroundColor: '#ffffff',
        border: `1.5px solid ${color}`,
        boxShadow: `0 1px 4px rgba(0,0,0,0.18)`,
        fontSize: 8,
        color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 15,
      }}
      title={label}
    >
      <span style={{ fontSize: 10 }}>{emoji}</span>
    </div>
  );
});
