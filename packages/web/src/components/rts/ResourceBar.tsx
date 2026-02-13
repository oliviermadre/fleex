import { memo } from 'react';
import type { Session } from '@asm/shared';
import type { RtsBaseModel } from './useRtsMapLayout';
import { ZERG } from './rtsTheme';

interface ResourceBarProps {
  sessions: Session[];
  bases: RtsBaseModel[];
}

export const ResourceBar = memo(function ResourceBar({ sessions, bases }: ResourceBarProps) {
  const claudeSessions = sessions.filter((s) => s.type === 'claude');
  const shellSessions = sessions.filter((s) => s.type === 'shell');
  const activeBases = bases.filter((b) => b.sessions.length > 0);

  return (
    <div
      className="rts-panel flex items-center gap-6 px-4"
      style={{
        height: 44,
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: `1px solid ${ZERG.carapaceBorderDim}`,
        borderRadius: 0,
      }}
    >
      {/* Drones (Claude sessions) */}
      <ResourceItem
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5" fill={ZERG.droneBody} opacity="0.8" />
            <circle cx="7" cy="7" r="3" fill={ZERG.droneBody} />
            <circle cx="7" cy="5" r="1.2" fill={ZERG.activeGreen} opacity="0.7" />
          </svg>
        }
        label="Drones"
        value={`${claudeSessions.length}`}
        subValue={`/ ${sessions.length}`}
      />

      {/* Overlords (Shell sessions) */}
      <ResourceItem
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <ellipse cx="7" cy="7" rx="6" ry="4" fill={ZERG.overlordBody} opacity="0.8" />
            <ellipse cx="7" cy="7" rx="4" ry="2.5" fill={ZERG.overlordBody} />
            <circle cx="5.5" cy="6.5" r="0.8" fill={ZERG.textSecondary} opacity="0.6" />
            <circle cx="8.5" cy="6.5" r="0.8" fill={ZERG.textSecondary} opacity="0.6" />
          </svg>
        }
        label="Overlords"
        value={`${shellSessions.length}`}
      />

      {/* Hatcheries (active repos) */}
      <ResourceItem
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" fill={ZERG.hatcheryIdle} opacity="0.3" />
            <circle cx="7" cy="7" r="4" fill={ZERG.hatcheryIdle} opacity="0.6" />
            <circle cx="7" cy="7" r="2" fill={ZERG.creepLight} />
          </svg>
        }
        label="Hatcheries"
        value={`${activeBases.length}`}
        subValue={`/ ${bases.length}`}
      />

      <div className="flex-1" />

      {/* Server health */}
      <div className="flex items-center gap-2">
        <div
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: ZERG.activeGreen,
            animation: 'rts-health-pulse 2s ease-in-out infinite',
            boxShadow: `0 0 6px ${ZERG.activeGreenGlow}`,
          }}
        />
        <span style={{ color: ZERG.textMuted, fontSize: 11 }}>SWARM ONLINE</span>
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
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      {icon}
      <span style={{ color: ZERG.textPrimary, fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
        {value}
      </span>
      {subValue && (
        <span style={{ color: ZERG.textMuted, fontSize: 11, fontFamily: 'monospace' }}>
          {subValue}
        </span>
      )}
    </div>
  );
}
