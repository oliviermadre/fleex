import { memo } from 'react';
import type { Session } from '@asm/shared';
import type { OfficeMapModel } from './types';
import { OFFICE } from './officeTheme';

interface OfficeResourceBarProps {
  sessions: Session[];
  mapModel: OfficeMapModel;
}

export const OfficeResourceBar = memo(function OfficeResourceBar({
  sessions,
  mapModel,
}: OfficeResourceBarProps) {
  const claudeSessions = sessions.filter((s) => s.type === 'claude');
  const shellSessions = sessions.filter((s) => s.type === 'shell');
  const openSpaces = mapModel.rooms.filter((r) => r.type === 'open-space');
  const desks = mapModel.objects.filter((o) => o.type === 'desk');
  const robots = mapModel.objects.filter((o) => o.type === 'robot');

  return (
    <div
      className="office-panel flex items-center gap-6 px-4"
      style={{
        height: 44,
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: `1px solid ${OFFICE.panelBorderDim}`,
        borderRadius: 0,
      }}
    >
      {/* Robots (Claude sessions) */}
      <ResourceItem
        icon="🤖"
        label="Robots"
        value={`${claudeSessions.length}`}
        subValue={`/ ${robots.length}`}
      />

      {/* Computers (Shell sessions) */}
      <ResourceItem
        icon="💻"
        label="Computers"
        value={`${shellSessions.length}`}
      />

      {/* Desks (worktrees) */}
      <ResourceItem
        icon="🪑"
        label="Desks"
        value={`${desks.length}`}
      />

      {/* Rooms (repos) */}
      <ResourceItem
        icon="🏢"
        label="Rooms"
        value={`${openSpaces.length}`}
      />

      <div className="flex-1" />

      {/* Office status */}
      <div className="flex items-center gap-2">
        <div
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: OFFICE.activeGreen,
            animation: 'office-health-pulse 2s ease-in-out infinite',
            boxShadow: `0 0 6px ${OFFICE.activeGreenGlow}`,
          }}
        />
        <span style={{ color: OFFICE.textMuted, fontSize: 11 }}>OFFICE ONLINE</span>
      </div>
    </div>
  );
});

function ResourceItem({
  icon,
  label,
  value,
  subValue,
}: {
  icon: string;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ color: OFFICE.textPrimary, fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
        {value}
      </span>
      {subValue && (
        <span style={{ color: OFFICE.textMuted, fontSize: 11, fontFamily: 'monospace' }}>
          {subValue}
        </span>
      )}
    </div>
  );
}
