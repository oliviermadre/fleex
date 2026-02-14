import { memo } from 'react';
import type { Session, PullRequest, RepositorySummary } from '@asm/shared';
import type { OfficeSelection, OfficeMapModel } from './types';
import { OFFICE, getStatusColor, getStatusLabel } from './officeTheme';

interface OfficeSelectedPanelProps {
  selection: OfficeSelection;
  sessions: Session[];
  mapModel: OfficeMapModel;
  pullsByRepo: Record<string, Record<string, PullRequest>>;
  summaries: Record<string, RepositorySummary>;
  displayNames: Record<string, string>;
}

export const OfficeSelectedPanel = memo(function OfficeSelectedPanel({
  selection,
  sessions,
  mapModel,
  pullsByRepo,
  summaries,
  displayNames,
}: OfficeSelectedPanelProps) {
  if (!selection) return <EmptySelection />;

  switch (selection.type) {
    case 'session': {
      const session = sessions.find((s) => s.id === selection.sessionId);
      if (!session) return <EmptySelection />;
      return <SessionDetail session={session} displayName={displayNames[session.id]} />;
    }
    case 'worktree': {
      const room = mapModel.rooms.find((r) => r.repoKey === selection.repoKey);
      const desks = mapModel.objects.filter(
        (o) => o.type === 'desk' && o.binding?.type === 'worktree' &&
          o.binding.repoKey === selection.repoKey && o.binding.branch === selection.branch,
      );
      const robots = mapModel.objects.filter(
        (o) => o.type === 'robot' && o.roomId === room?.id,
      );
      const pr = pullsByRepo[selection.repoKey]?.[selection.branch] ?? null;
      const sessionCount = robots.filter((r) => {
        const b = r.binding;
        return b?.type === 'session' &&
          sessions.find((s) => s.id === b.sessionId && s.worktreeBranch === selection.branch);
      }).length;
      return (
        <WorktreeDetail
          branch={selection.branch}
          repoKey={selection.repoKey}
          sessionCount={sessionCount || desks.length}
          pr={pr}
        />
      );
    }
    case 'repo': {
      const room = mapModel.rooms.find((r) => r.repoKey === selection.repoKey);
      const summary = summaries[selection.repoKey];
      if (!room) return <EmptySelection />;
      const robotCount = mapModel.objects.filter(
        (o) => o.type === 'robot' && o.roomId === room.id,
      ).length;
      const deskCount = mapModel.objects.filter(
        (o) => o.type === 'desk' && o.roomId === room.id,
      ).length;
      return (
        <RepoDetail
          repoKey={selection.repoKey}
          label={room.label}
          deskCount={deskCount}
          robotCount={robotCount}
          summary={summary}
        />
      );
    }
    case 'room': {
      const room = mapModel.rooms.find((r) => r.id === selection.roomId);
      if (!room) return <EmptySelection />;
      return <RoomDetail room={room} />;
    }
    case 'lobby': {
      const lobbyRobots = mapModel.objects.filter(
        (o) => o.type === 'robot' && o.roomId === 'lobby',
      );
      return <LobbyDetail sessionCount={lobbyRobots.length} />;
    }
  }
});

function EmptySelection() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
      <span style={{ fontSize: 24, opacity: 0.3 }}>🏢</span>
      <span style={{ color: OFFICE.textMuted, fontSize: 11 }}>Select an object</span>
    </div>
  );
}

function SessionDetail({ session, displayName }: { session: Session; displayName?: string }) {
  const isRobot = session.type === 'claude';
  const activity = session.claudeActivity ?? 'idle';
  const activityColor = getStatusColor(activity);

  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      {/* Portrait */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: isRobot ? '50%' : 8,
          flexShrink: 0,
          background: isRobot
            ? `radial-gradient(ellipse at 40% 35%, ${OFFICE.robotBody} 0%, ${OFFICE.robotGlow} 100%)`
            : `radial-gradient(ellipse at 40% 35%, ${OFFICE.shellBody} 0%, ${OFFICE.shellGlow} 100%)`,
          border: `2px solid ${OFFICE.panelBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 0 8px ${activityColor}44`,
        }}
      >
        <span style={{ fontSize: 18 }}>{isRobot ? '🤖' : '💻'}</span>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span
            style={{
              color: OFFICE.textPrimary,
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName || (isRobot ? 'Robot' : 'Computer')}
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
            {getStatusLabel(activity)}
          </span>
        </div>
        <div style={{ color: OFFICE.textSecondary, fontSize: 10 }}>
          {session.type === 'claude' ? 'Claude' : 'Shell'} &middot; {session.status}
        </div>
        <div
          style={{
            color: OFFICE.textMuted,
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
          <div style={{ color: OFFICE.textMuted, fontSize: 9 }}>
            {session.repositoryOrg}/{session.repositoryName}
            {session.worktreeBranch && ` \u2192 ${session.worktreeBranch}`}
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
  pr,
}: {
  branch: string;
  repoKey: string;
  sessionCount: number;
  pr: PullRequest | null;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 6,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${OFFICE.woodLight}66 0%, ${OFFICE.woodDark} 100%)`,
          border: `2px solid ${OFFICE.woodDark}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 18 }}>🪑</span>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span style={{ color: OFFICE.textPrimary, fontSize: 12, fontWeight: 600 }}>Desk</span>
          <span style={{ color: OFFICE.workingBlue, fontSize: 9 }}>{branch}</span>
        </div>
        <div style={{ color: OFFICE.textSecondary, fontSize: 10 }}>
          {repoKey} &middot; {sessionCount} robot{sessionCount !== 1 ? 's' : ''}
        </div>
        {pr && (
          <div style={{ color: OFFICE.thinkingAmber, fontSize: 9 }}>
            PR #{pr.number}: {pr.title}
          </div>
        )}
      </div>
    </div>
  );
}

function RepoDetail({
  repoKey,
  label,
  deskCount,
  robotCount,
  summary,
}: {
  repoKey: string;
  label: string;
  deskCount: number;
  robotCount: number;
  summary?: RepositorySummary;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 6,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${OFFICE.floorMain}66 0%, ${OFFICE.wallSide} 100%)`,
          border: `2px solid ${OFFICE.panelBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 18 }}>🏢</span>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span style={{ color: OFFICE.textPrimary, fontSize: 12, fontWeight: 600 }}>
          {label}
        </span>
        <div style={{ color: OFFICE.textSecondary, fontSize: 10 }}>
          {repoKey} &middot; {deskCount} desk{deskCount !== 1 ? 's' : ''} &middot; {robotCount} robot{robotCount !== 1 ? 's' : ''}
        </div>
        {summary && (
          <div style={{ color: OFFICE.textMuted, fontSize: 9 }}>
            {summary.openIssuesCount} issues &middot; {summary.openPRsCount} PRs open &middot; {summary.myPRsCount} my PRs
          </div>
        )}
      </div>
    </div>
  );
}

function RoomDetail({ room }: { room: { id: string; label: string; type: string } }) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      <span style={{ fontSize: 24 }}>🏠</span>
      <div className="flex flex-col gap-0.5">
        <span style={{ color: OFFICE.textPrimary, fontSize: 12, fontWeight: 600 }}>{room.label}</span>
        <span style={{ color: OFFICE.textMuted, fontSize: 10 }}>{room.type}</span>
      </div>
    </div>
  );
}

function LobbyDetail({ sessionCount }: { sessionCount: number }) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4">
      <span style={{ fontSize: 24, opacity: 0.7 }}>🏠</span>
      <div className="flex flex-col gap-0.5">
        <span style={{ color: OFFICE.textPrimary, fontSize: 12, fontWeight: 600 }}>Lobby</span>
        <div style={{ color: OFFICE.textSecondary, fontSize: 10 }}>
          {sessionCount} unassigned robot{sessionCount !== 1 ? 's' : ''}
        </div>
        <div style={{ color: OFFICE.textMuted, fontSize: 9 }}>
          Sessions not attached to any repository
        </div>
      </div>
    </div>
  );
}
