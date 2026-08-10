import { Handle, Position } from '@xyflow/react';
import type { WorkflowStep, StepRunStatus, WorkflowExecutorType } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { PrimitiveIcon, type PrimitiveKind } from '../../lib/primitives';
import { ListChecksIcon, SplitIcon, TriggerInIcon } from './executor-palette';
import { nativeStepSummary } from './nativeStepSummary';

export interface StepRunNodeData {
  step: WorkflowStep;
  status: StepRunStatus | 'pending';
  summary?: string;
  isCurrent: boolean;
  onSelect: (stepId: string) => void;
  /**
   * Opens the Claude SDK session of this step. Absent when the step has no
   * session to show (non-agentic step, or not started yet).
   */
  onOpenSession?: () => void;
  /**
   * How many deliverables this step produced across all its attempts. The
   * steps ARE the deliverable producers, so the canvas shows it right on the
   * node; the full list lives in the step sidebar.
   */
  deliverableCount?: number;
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────

interface IconProps { className?: string }

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

function TerminalIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function FileTextIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
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

// Executor types map onto the canonical primitive glyphs (lib/primitives.tsx),
// so a step node on the canvas shows the SAME icon as the sidebar and the
// palette. `human_gate` is not a primitive, so it keeps its dedicated glyph.
const EXECUTOR_TO_PRIMITIVE: Record<Exclude<WorkflowExecutorType, 'human_gate' | 'native' | 'route' | 'trigger'>, PrimitiveKind> = {
  agent: 'persona',
  panel: 'panel',
  skill: 'skill',
};

function StepIcon({ type, className }: { type: WorkflowExecutorType; className?: string }) {
  if (type === 'human_gate') return <UserCheckIcon className={className} />;
  if (type === 'native') return <ListChecksIcon className={className} />;
  if (type === 'route') return <SplitIcon className={className} />;
  if (type === 'trigger') return <TriggerInIcon className={className} />;
  // tinted={false}: the icon inherits the node's executor-type colour (border +
  // icon share one hue) instead of re-applying the tint, keeping each node
  // chromatically coherent.
  return <PrimitiveIcon kind={EXECUTOR_TO_PRIMITIVE[type]} size={16} className={className} tinted={false} />;
}

const executorColor = {
  agent: `${tintClasses('purple').text} ${tintClasses('purple').borderColor}`,
  panel: `${tintClasses('blue').text} ${tintClasses('blue').borderColor}`,
  skill: `${tintClasses('green').text} ${tintClasses('green').borderColor}`,
  human_gate: `${tintClasses('yellow').text} ${tintClasses('yellow').borderColor} border-dashed`,
  native: `${tintClasses('teal').text} ${tintClasses('teal').borderColor}`,
  route: `${tintClasses('orange').text} ${tintClasses('orange').borderColor} border-dashed`,
  trigger: `${tintClasses('pink').text} ${tintClasses('pink').borderColor} border-dashed`,
};

function StatusIcon({ status }: { status: StepRunStatus | 'pending' }) {
  switch (status) {
    case 'completed': return <CheckCircle2Icon className={`w-4 h-4 ${tintClasses('teal').text}`} />;
    case 'running': return <Loader2Icon className={`w-4 h-4 ${tintClasses('blue').text} animate-spin`} />;
    case 'failed': return <XCircleIcon className={`w-4 h-4 ${tintClasses('red').text}`} />;
    case 'needs_review': return <AlertTriangleIcon className={`w-4 h-4 ${tintClasses('yellow').text}`} />;
    // Same "waiting on a human" hue as needs_review, but a fork rather than a
    // warning: the step succeeded, only its exit is undecided.
    case 'awaiting_routing': return <SplitIcon className={`w-4 h-4 ${tintClasses('yellow').text}`} />;
    case 'queued': return <ClockIcon className={`w-4 h-4 ${tintClasses('green').text}`} />;
    case 'cancelled':
    case 'skipped': return <SkipForwardIcon className="w-4 h-4 opacity-40" />;
    default: return <CircleDotIcon className="w-4 h-4 opacity-30" />;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StepRunNode({ data }: { data: StepRunNodeData }) {
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
          <StepIcon type={data.step.executorType} className="w-4 h-4 shrink-0" />
          <span className="text-xs font-medium truncate flex-1 text-[var(--theme-text-primary)]">{data.step.name}</span>
          {data.onOpenSession && (
            // Direct access to the SDK turns from the canvas — one click, no
            // detour through the sidebar. stopPropagation so it doesn't also
            // select the node behind the popup.
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onOpenSession?.();
              }}
              title="View SDK session"
              aria-label="View SDK session"
              className="shrink-0 rounded p-0.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            >
              <TerminalIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {(data.deliverableCount ?? 0) > 0 && (
            // The node stays the deliverable producer's identity: an icon (+
            // count) marks it on the canvas; clicking anywhere on the node
            // opens the sidebar where the actual list lives.
            <span
              title={`${data.deliverableCount} deliverable${data.deliverableCount! > 1 ? 's' : ''} — click the step for details`}
              className={cn('flex shrink-0 items-center gap-0.5', tintClasses('green').text)}
            >
              <FileTextIcon className="w-3.5 h-3.5" />
              {data.deliverableCount! > 1 && (
                <span className="text-[9px] font-semibold leading-none">{data.deliverableCount}</span>
              )}
            </span>
          )}
          <StatusIcon status={data.status} />
        </div>
        <div className="text-[10px] truncate text-[var(--theme-text-muted)]">
          {data.step.executorType === 'route'
            ? 'routing only'
            : data.step.executorType === 'trigger'
              ? 'run payload & metadata'
              : nativeStepSummary(data.step) ?? (data.step.executorRef || '—')}
        </div>
        {data.summary && (
          <div className="mt-1 text-[10px] line-clamp-2 text-[var(--theme-text-muted)]">{data.summary}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2" />
    </div>
  );
}
