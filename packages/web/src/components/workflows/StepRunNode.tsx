import { Handle, Position } from '@xyflow/react';
import type { WorkflowStep, StepRunStatus } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';

export interface StepRunNodeData {
  step: WorkflowStep;
  status: StepRunStatus | 'pending';
  summary?: string;
  isCurrent: boolean;
  onSelect: (stepId: string) => void;
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────

interface IconProps { className?: string }

function BotIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M12 2v9" />
      <circle cx="12" cy="2" r="1" />
      <path d="M7 16h.01M17 16h.01" />
    </svg>
  );
}

function UsersIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BookOpenIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function UserCheckIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  );
}

function CheckCircle2Icon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M7 12l4 4 6-6" />
    </svg>
  );
}

function XCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ClockIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function Loader2Icon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CircleDotIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function SkipForwardIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

// ── Color maps ────────────────────────────────────────────────────────────────

const executorIcon = {
  agent: BotIcon,
  panel: UsersIcon,
  skill: BookOpenIcon,
  human_gate: UserCheckIcon,
} as const;

const executorColor = {
  agent: `${tintClasses('purple').text} ${tintClasses('purple').borderColor}`,
  panel: `${tintClasses('blue').text} ${tintClasses('blue').borderColor}`,
  skill: `${tintClasses('green').text} ${tintClasses('green').borderColor}`,
  human_gate: `${tintClasses('yellow').text} ${tintClasses('yellow').borderColor} border-dashed`,
};

function StatusIcon({ status }: { status: StepRunStatus | 'pending' }) {
  switch (status) {
    case 'completed': return <CheckCircle2Icon className={`w-4 h-4 ${tintClasses('teal').text}`} />;
    case 'running': return <Loader2Icon className={`w-4 h-4 ${tintClasses('blue').text} animate-spin`} />;
    case 'failed': return <XCircleIcon className={`w-4 h-4 ${tintClasses('red').text}`} />;
    case 'needs_review': return <AlertTriangleIcon className={`w-4 h-4 ${tintClasses('yellow').text}`} />;
    case 'queued': return <ClockIcon className={`w-4 h-4 ${tintClasses('green').text}`} />;
    case 'cancelled':
    case 'skipped': return <SkipForwardIcon className="w-4 h-4 opacity-40" />;
    default: return <CircleDotIcon className="w-4 h-4 opacity-30" />;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StepRunNode({ data }: { data: StepRunNodeData }) {
  const Icon = executorIcon[data.step.executorType];
  return (
    // Explicit 180x80 matches the Node config + static handles y:40 — keeps the
    // JSX Handles' top:50% aligned with where React Flow positions the edges.
    <div className="relative" style={{ width: 180, height: 80, boxSizing: 'border-box' }}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !border-2" />
      <div
        onClick={() => data.onSelect(data.step.id)}
        // Solid theme surface (the old `bg-card` token is undefined → rendered
        // transparent, leaving the node unreadable on light themes). The
        // executor-type border/icon color stays the identity cue.
        style={{ background: 'var(--theme-bg-overlay)' }}
        className={cn(
          'w-full h-full rounded-lg border-2 p-3 cursor-pointer transition-all hover:shadow-lg flex flex-col justify-center overflow-hidden',
          executorColor[data.step.executorType],
          data.isCurrent && `ring-2 ${tintClasses('green').ring} ring-offset-2 ring-offset-[var(--theme-bg-base)]`,
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="text-xs font-medium truncate flex-1 text-[var(--theme-text-primary)]">{data.step.name}</span>
          <StatusIcon status={data.status} />
        </div>
        <div className="text-[10px] truncate text-[var(--theme-text-muted)]">{data.step.executorRef || '—'}</div>
        {data.summary && (
          <div className="mt-1 text-[10px] line-clamp-2 text-[var(--theme-text-muted)]">{data.summary}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2" />
    </div>
  );
}
