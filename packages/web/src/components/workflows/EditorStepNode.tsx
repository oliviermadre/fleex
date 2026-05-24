import { Handle, Position } from '@xyflow/react';
import { useState } from 'react';
import type { WorkflowStep } from '@fleex/shared';
import { cn } from '../../lib/cn';

// ── Inline SVG icons (mirrored from StepRunNode.tsx) ─────────────────────────

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

function XIcon({ className }: IconProps) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ── Color / icon maps ─────────────────────────────────────────────────────────

const executorIcon = {
  agent: BotIcon,
  panel: UsersIcon,
  skill: BookOpenIcon,
  human_gate: UserCheckIcon,
} as const;

const executorColor = {
  agent: 'text-purple-400 border-purple-400/40',
  panel: 'text-blue-400 border-blue-400/40',
  skill: 'text-green-400 border-green-400/40',
  human_gate: 'text-amber-400 border-amber-400/40 border-dashed',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditorStepNodeData {
  step: WorkflowStep;
  isSelected: boolean;
  isEntry: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditorStepNode({ data }: { data: EditorStepNodeData }) {
  const [hovered, setHovered] = useState(false);
  const { step, isSelected, isEntry, onSelect, onDelete } = data;
  const Icon = executorIcon[step.executorType];

  const showUnconfigured = !step.executorRef && step.executorType !== 'human_gate';

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !border-2" />

      {/* Delete button — visible on hover */}
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(step.id);
          }}
          className="absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white transition-colors"
          title="Delete step"
        >
          <XIcon />
        </button>
      )}

      <div
        onClick={() => onSelect(step.id)}
        className={cn(
          'w-[180px] rounded-lg border-2 p-3 cursor-pointer transition-all hover:shadow-lg',
          executorColor[step.executorType],
          isSelected && 'ring-2 ring-white/40 ring-offset-1',
        )}
        style={{ background: 'var(--theme-bg-surface)' }}
      >
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="text-xs font-medium truncate flex-1">{step.name}</span>
          {isEntry && (
            <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-white/10 shrink-0">
              entry
            </span>
          )}
        </div>

        {/* Executor ref or unconfigured hint */}
        <div className="text-[10px] opacity-60 truncate">
          {showUnconfigured ? (
            <span className="italic opacity-50">Unconfigured</span>
          ) : (
            step.executorRef || '—'
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2" />
    </div>
  );
}
