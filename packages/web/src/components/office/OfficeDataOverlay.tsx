import { memo, useRef, useEffect, useCallback, useState } from 'react';
import type { DataOverlayTarget } from './types';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import type { RepositoryDashboardData } from '@asm/shared';
import { OFFICE } from './officeTheme';

interface OfficeDataOverlayProps {
  target: NonNullable<DataOverlayTarget>;
  onClose: () => void;
}

const MIN_WIDTH = 380;
const MIN_HEIGHT = 260;
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 420;

const OVERLAY_TITLES: Record<string, string> = {
  'pr-library': 'Pull Requests',
  'merged': 'Recently Merged',
  'assigned': 'Assigned Work',
};

const OVERLAY_EMOJIS: Record<string, string> = {
  'pr-library': '📚',
  'merged': '📦',
  'assigned': '📋',
};

export const OfficeDataOverlay = memo(function OfficeDataOverlay({
  target,
  onClose,
}: OfficeDataOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dashboardData = useRepositoryDashboardStore((s) => s.dashboardData);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  // Fetch dashboard data for this repo
  useEffect(() => {
    const [org, name] = target.repoKey.split('/');
    if (org && name) {
      fetchDashboard(org, name);
    }
  }, [target.repoKey, fetchDashboard]);

  // Escape closes overlay
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const resizeRef = useRef({ resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 });

  // Center on first render
  useEffect(() => {
    if (position !== null) return;
    setPosition({
      x: Math.max(0, (window.innerWidth - size.width) / 2),
      y: Math.max(0, (window.innerHeight - size.height) / 2 - 40),
    });
  }, [position, size]);

  const effectivePos = position ?? { x: 0, y: 0 };

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: effectivePos.x,
      startPosY: effectivePos.y,
    };
    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      setPosition({
        x: dragRef.current.startPosX + (me.clientX - dragRef.current.startX),
        y: dragRef.current.startPosY + (me.clientY - dragRef.current.startY),
      });
    };
    const handleUp = () => {
      dragRef.current.dragging = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [effectivePos]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      resizing: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    };
    const handleMove = (me: MouseEvent) => {
      if (!resizeRef.current.resizing) return;
      setSize({
        width: Math.max(MIN_WIDTH, resizeRef.current.startW + (me.clientX - resizeRef.current.startX)),
        height: Math.max(MIN_HEIGHT, resizeRef.current.startH + (me.clientY - resizeRef.current.startY)),
      });
    };
    const handleUp = () => {
      resizeRef.current.resizing = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [size]);

  const title = OVERLAY_TITLES[target.type] ?? 'Data';
  const emoji = OVERLAY_EMOJIS[target.type] ?? '';
  const repoName = target.repoKey.split('/')[1] ?? target.repoKey;

  // Match dashboard data to the requested repo
  const data: RepositoryDashboardData | null =
    dashboardData &&
    `${dashboardData.org}/${dashboardData.name}` === target.repoKey
      ? dashboardData
      : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(18, 20, 26, 0.5)',
          pointerEvents: 'auto',
        }}
        onClick={onClose}
      />

      {/* Floating panel */}
      <div
        ref={panelRef}
        style={{
          position: 'absolute',
          left: effectivePos.x,
          top: effectivePos.y,
          width: size.width,
          height: size.height,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          overflow: 'hidden',
          pointerEvents: 'auto',
          border: `1px solid ${OFFICE.panelBorder}`,
          boxShadow: `
            0 0 0 1px ${OFFICE.panelBorderDim},
            0 24px 80px rgba(0, 0, 0, 0.6),
            0 0 40px rgba(59, 130, 246, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.05)
          `,
          background: OFFICE.panelBg,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            cursor: 'grab',
            borderBottom: `1px solid ${OFFICE.panelBorderDim}`,
            background: 'linear-gradient(180deg, rgba(55, 65, 81, 0.6) 0%, rgba(26, 29, 35, 0.8) 100%)',
            flexShrink: 0,
            userSelect: 'none',
          }}
          onMouseDown={handleTitleMouseDown}
        >
          <span style={{ fontSize: 14 }}>{emoji}</span>
          <span
            style={{
              color: OFFICE.textPrimary,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {title}
          </span>
          <span style={{ color: OFFICE.textMuted, fontSize: 10 }}>
            {repoName}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: OFFICE.textMuted,
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 14,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = OFFICE.errorRed;
              (e.currentTarget as HTMLElement).style.background = `${OFFICE.errorRed}22`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = OFFICE.textMuted;
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
            title="Close (Esc)"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {!data ? (
            <div style={{ padding: 16, color: OFFICE.textMuted, fontSize: 11, textAlign: 'center' }}>
              Loading...
            </div>
          ) : (
            <OverlayContent target={target} data={data} />
          )}
        </div>

        {/* Resize handle */}
        <div
          style={{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, cursor: 'se-resize' }}
          onMouseDown={handleResizeMouseDown}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{ position: 'absolute', bottom: 3, right: 3 }}
          >
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke={OFFICE.panelBorderDim} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
});

function OverlayContent({ target, data }: { target: NonNullable<DataOverlayTarget>; data: RepositoryDashboardData }) {
  switch (target.type) {
    case 'pr-library':
      return <PRLibrary data={data} />;
    case 'merged':
      return <MergedPRs data={data} />;
    case 'assigned':
      return <AssignedWork data={data} />;
  }
}

function PRLibrary({ data }: { data: RepositoryDashboardData }) {
  const prs = data.openPullRequests;
  if (prs.length === 0) {
    return <EmptyMessage text="No open pull requests" />;
  }
  return (
    <div>
      {prs.map((pr) => (
        <ItemRow
          key={pr.number}
          onClick={() => window.open(`https://github.com/${data.org}/${data.name}/pull/${pr.number}`, '_blank')}
        >
          <span style={{ color: OFFICE.workingBlue, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
            #{pr.number}
          </span>
          <span style={{ color: OFFICE.textPrimary, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pr.title}
          </span>
          <span style={{ color: OFFICE.textMuted, fontSize: 10, flexShrink: 0 }}>
            {pr.author}
          </span>
          <span style={{ color: OFFICE.textFaint, fontSize: 9, flexShrink: 0 }}>
            {formatDate(pr.createdAt)}
          </span>
        </ItemRow>
      ))}
    </div>
  );
}

function MergedPRs({ data }: { data: RepositoryDashboardData }) {
  const prs = data.recentlyMergedPullRequests;
  if (prs.length === 0) {
    return <EmptyMessage text="No recently merged pull requests" />;
  }
  return (
    <div>
      {prs.map((pr) => (
        <ItemRow
          key={pr.number}
          onClick={() => window.open(`https://github.com/${data.org}/${data.name}/pull/${pr.number}`, '_blank')}
        >
          <span style={{ color: '#a855f7', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
            #{pr.number}
          </span>
          <span style={{ color: OFFICE.textPrimary, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pr.title}
          </span>
          <span style={{ color: OFFICE.textMuted, fontSize: 10, flexShrink: 0 }}>
            {pr.author}
          </span>
          <span style={{ color: OFFICE.activeGreen, fontSize: 9, flexShrink: 0 }}>
            merged {pr.mergedAt ? formatDate(pr.mergedAt) : ''}
          </span>
        </ItemRow>
      ))}
    </div>
  );
}

function AssignedWork({ data }: { data: RepositoryDashboardData }) {
  // My PRs: PRs where the author matches the github user
  const myPRs = data.githubUser
    ? data.openPullRequests.filter((pr) => pr.author === data.githubUser)
    : [];
  // Assigned PRs: PRs where I'm in the assignees
  const assignedPRs = data.githubUser
    ? data.openPullRequests.filter(
        (pr) => pr.author !== data.githubUser && pr.assignees.includes(data.githubUser),
      )
    : [];
  const issues = data.openIssues;

  const hasContent = myPRs.length > 0 || assignedPRs.length > 0 || issues.length > 0;
  if (!hasContent) {
    return <EmptyMessage text="No assigned work" />;
  }

  return (
    <div>
      {myPRs.length > 0 && (
        <>
          <SectionHeader label="My Pull Requests" count={myPRs.length} />
          {myPRs.map((pr) => (
            <ItemRow
              key={pr.number}
              onClick={() => window.open(`https://github.com/${data.org}/${data.name}/pull/${pr.number}`, '_blank')}
            >
              <span style={{ color: OFFICE.workingBlue, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                #{pr.number}
              </span>
              <span style={{ color: OFFICE.textPrimary, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pr.title}
              </span>
              <span style={{ color: OFFICE.textFaint, fontSize: 9, flexShrink: 0 }}>
                {formatDate(pr.createdAt)}
              </span>
            </ItemRow>
          ))}
        </>
      )}
      {assignedPRs.length > 0 && (
        <>
          <SectionHeader label="Assigned PRs" count={assignedPRs.length} />
          {assignedPRs.map((pr) => (
            <ItemRow
              key={pr.number}
              onClick={() => window.open(`https://github.com/${data.org}/${data.name}/pull/${pr.number}`, '_blank')}
            >
              <span style={{ color: OFFICE.thinkingAmber, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                #{pr.number}
              </span>
              <span style={{ color: OFFICE.textPrimary, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pr.title}
              </span>
              <span style={{ color: OFFICE.textMuted, fontSize: 10, flexShrink: 0 }}>
                {pr.author}
              </span>
            </ItemRow>
          ))}
        </>
      )}
      {issues.length > 0 && (
        <>
          <SectionHeader label="Open Issues" count={issues.length} />
          {issues.map((issue) => (
            <ItemRow
              key={issue.number}
              onClick={() => window.open(`https://github.com/${data.org}/${data.name}/issues/${issue.number}`, '_blank')}
            >
              <span style={{ color: OFFICE.activeGreen, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                #{issue.number}
              </span>
              <span style={{ color: OFFICE.textPrimary, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {issue.title}
              </span>
              <span style={{ color: OFFICE.textFaint, fontSize: 9, flexShrink: 0 }}>
                {formatDate(issue.createdAt)}
              </span>
            </ItemRow>
          ))}
        </>
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        padding: '6px 14px 4px',
        fontSize: 10,
        fontWeight: 700,
        color: OFFICE.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        borderBottom: `1px solid ${OFFICE.panelBorderDim}`,
        marginTop: 4,
      }}
    >
      {label} ({count})
    </div>
  );
}

function ItemRow({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = OFFICE.panelHighlight;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {children}
    </div>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <div style={{ padding: 24, color: OFFICE.textMuted, fontSize: 11, textAlign: 'center' }}>
      {text}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return '1d ago';
    if (diffDays < 30) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
