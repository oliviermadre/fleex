import { memo } from 'react';
import type { Session, PullRequest, RepositorySummary } from '@asm/shared';
import type { RtsSelection } from '../../stores/uiStore';
import type { RtsBaseModel, RtsMapModel } from './useRtsMapLayout';
import { ZERG, getBuildingType } from './rtsTheme';

interface SelectedPanelProps {
  rtsSelection: RtsSelection;
  sessions: Session[];
  mapModel: RtsMapModel;
  pullsByRepo: Record<string, Record<string, PullRequest>>;
  summaries: Record<string, RepositorySummary>;
  displayNames: Record<string, string>;
}

export const SelectedPanel = memo(function SelectedPanel({
  rtsSelection,
  sessions,
  mapModel,
  pullsByRepo,
  summaries,
  displayNames,
}: SelectedPanelProps) {
  if (!rtsSelection) {
    return <EmptySelection />;
  }

  switch (rtsSelection.type) {
    case 'session': {
      const session = sessions.find((s) => s.id === rtsSelection.sessionId);
      if (!session) return <EmptySelection />;
      return <SessionDetail session={session} displayName={displayNames[session.id]} />;
    }
    case 'worktree': {
      const base = mapModel.bases.find((b) => b.repoKey === rtsSelection.repoKey);
      const wt = base?.worktrees.find((w) => w.branch === rtsSelection.branch);
      if (!wt) return <EmptySelection />;
      const pr = pullsByRepo[rtsSelection.repoKey]?.[rtsSelection.branch] ?? null;
      return (
        <WorktreeDetail
          branch={wt.branch}
          repoKey={rtsSelection.repoKey}
          sessionCount={wt.sessions.length}
          isMain={wt.isMain}
          pr={pr}
        />
      );
    }
    case 'hatchery': {
      const base = mapModel.bases.find((b) => b.repoKey === rtsSelection.repoKey);
      const summary = summaries[rtsSelection.repoKey];
      if (!base) return <EmptySelection />;
      return <HatcheryDetail base={base} summary={summary} />;
    }
    case 'nydus': {
      const nydus = mapModel.nydus;
      if (!nydus) return <EmptySelection />;
      return <NydusDetail sessionCount={nydus.sessions.length} />;
    }
  }
});

function EmptySelection() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.4">
        <circle cx="16" cy="16" r="12" stroke={ZERG.creepLight} strokeWidth="2" />
        <circle cx="16" cy="16" r="6" stroke={ZERG.creepLight} strokeWidth="1.5" />
        <circle cx="16" cy="16" r="2" fill={ZERG.creepLight} />
      </svg>
      <span style={{ color: ZERG.textMuted, fontSize: 11 }}>Select a unit or building</span>
    </div>
  );
}

function SessionDetail({ session, displayName }: { session: Session; displayName?: string }) {
  const isDrone = session.type === 'claude';
  const activity = session.claudeActivity ?? 'idle';

  const activityColor =
    activity === 'working' || activity === 'executing'
      ? ZERG.activeGreen
      : activity.startsWith('waiting_')
        ? ZERG.waitingAmber
        : ZERG.textMuted;

  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      {/* Portrait */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          flexShrink: 0,
          background: `radial-gradient(ellipse at 40% 35%, ${ZERG.creepLight} 0%, ${isDrone ? ZERG.droneBody : ZERG.overlordBody} 80%)`,
          border: `2px solid ${ZERG.carapaceBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 0 8px ${activityColor}44`,
        }}
      >
        <span style={{ fontSize: 18 }}>{isDrone ? '🐝' : '🎈'}</span>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span
            style={{
              color: ZERG.textPrimary,
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName || (isDrone ? 'Drone' : 'Overlord')}
          </span>
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 3,
              backgroundColor: `${activityColor}22`,
              color: activityColor,
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {activity.replace(/_/g, ' ')}
          </span>
        </div>
        <div style={{ color: ZERG.textSecondary, fontSize: 10 }}>
          {session.type === 'claude' ? 'Claude' : 'Shell'} &middot; {session.status}
        </div>
        <div
          style={{
            color: ZERG.textMuted,
            fontSize: 9,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={session.cwd}
        >
          {session.cwd}
        </div>
        {session.repositoryName && (
          <div style={{ color: ZERG.textMuted, fontSize: 9 }}>
            {session.repositoryOrg}/{session.repositoryName}
            {session.worktreeBranch && ` → ${session.worktreeBranch}`}
          </div>
        )}
      </div>
    </div>
  );
}

function WorktreeDetail({
  branch,
  repoKey,
  sessionCount,
  isMain,
  pr,
}: {
  branch: string;
  repoKey: string;
  sessionCount: number;
  isMain: boolean;
  pr: PullRequest | null;
}) {
  const building = getBuildingType({ isMain, hasOpenPR: !!pr, sessionCount });

  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      {/* Portrait */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 6,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${building.color}33 0%, ${ZERG.creepDark} 100%)`,
          border: `2px solid ${building.color}66`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            backgroundColor: building.color,
            opacity: 0.7,
            boxShadow: `0 0 8px ${building.color}`,
          }}
        />
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span style={{ color: ZERG.textPrimary, fontSize: 12, fontWeight: 600 }}>{building.label}</span>
          <span style={{ color: building.color, fontSize: 9 }}>{branch}</span>
        </div>
        <div style={{ color: ZERG.textSecondary, fontSize: 10 }}>
          {repoKey} &middot; {sessionCount} unit{sessionCount !== 1 ? 's' : ''}
        </div>
        {pr && (
          <div style={{ color: ZERG.evolutionChamber, fontSize: 9 }}>
            PR #{pr.number}: {pr.title}
          </div>
        )}
      </div>
    </div>
  );
}

function HatcheryDetail({
  base,
  summary,
}: {
  base: RtsBaseModel;
  summary?: RepositorySummary;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      {/* Portrait */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          flexShrink: 0,
          background: `radial-gradient(ellipse at 40% 35%, ${ZERG.creepLight} 0%, ${ZERG.creepMid} 50%, ${ZERG.creepDark} 100%)`,
          border: `2px solid ${ZERG.carapaceBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            backgroundColor: ZERG.hatcheryIdle,
            boxShadow: `0 0 8px ${ZERG.hatcheryIdle}`,
          }}
        />
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span style={{ color: ZERG.textPrimary, fontSize: 12, fontWeight: 600 }}>
          Hatchery — {base.name}
        </span>
        <div style={{ color: ZERG.textSecondary, fontSize: 10 }}>
          {base.org}/{base.name} &middot; {base.worktrees.length} building{base.worktrees.length !== 1 ? 's' : ''} &middot; {base.sessions.length} unit{base.sessions.length !== 1 ? 's' : ''}
        </div>
        {summary && (
          <div style={{ color: ZERG.textMuted, fontSize: 9 }}>
            {summary.openIssuesCount} issues &middot; {summary.openPRsCount} PRs open &middot; {summary.myPRsCount} my PRs
          </div>
        )}
      </div>
    </div>
  );
}

function NydusDetail({ sessionCount }: { sessionCount: number }) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      {/* Portrait */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          flexShrink: 0,
          background: `radial-gradient(ellipse at center, ${ZERG.creepDark} 0%, ${ZERG.nydusBg} 100%)`,
          border: `2px solid ${ZERG.nydusRing}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 0 8px ${ZERG.nydusGlow}`,
        }}
      >
        <span style={{ fontSize: 16 }}>🕳️</span>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5">
        <span style={{ color: ZERG.textPrimary, fontSize: 12, fontWeight: 600 }}>Nydus Network</span>
        <div style={{ color: ZERG.textSecondary, fontSize: 10 }}>
          {sessionCount} orphaned unit{sessionCount !== 1 ? 's' : ''}
        </div>
        <div style={{ color: ZERG.textMuted, fontSize: 9 }}>
          Sessions not attached to any repository
        </div>
      </div>
    </div>
  );
}
