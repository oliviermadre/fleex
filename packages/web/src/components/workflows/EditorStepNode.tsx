import { Handle, Position } from '@xyflow/react';
import { useState } from 'react';
import type { WorkflowStep } from '@fleex/shared';

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

const BORDER_HEX = {
  agent: '#a855f7',       // purple-500
  panel: '#3b82f6',       // blue-500
  skill: '#22c55e',       // green-500
  human_gate: '#f59e0b',  // amber-500
} as const;

const TEXT_HEX = {
  agent: '#c4b5fd',       // purple-300
  panel: '#93c5fd',       // blue-300
  skill: '#86efac',       // green-300
  human_gate: '#fcd34d',  // amber-300
} as const;

export function EditorStepNode({ data }: { data: EditorStepNodeData }) {
  const [hovered, setHovered] = useState(false);

  // Defensive: if React Flow passes weird data, render a visible fallback instead of crashing
  if (!data || !data.step) {
    return (
      <div style={{ padding: '10px', background: '#dc2626', color: 'white', borderRadius: 8, fontSize: 12 }}>
        Missing step data
      </div>
    );
  }

  const { step, isSelected, isEntry, onSelect, onDelete } = data;
  const Icon = executorIcon[step.executorType];
  const showUnconfigured = !step.executorRef && step.executorType !== 'human_gate';
  const borderColor = BORDER_HEX[step.executorType];
  const accentText = TEXT_HEX[step.executorType];

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: '#52525b', border: '2px solid #18181b' }} />

      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
          style={{
            position: 'absolute', top: -8, right: -8, zIndex: 10,
            width: 20, height: 20, borderRadius: '50%',
            background: 'rgba(220,38,38,0.85)', color: 'white', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
          title="Delete step"
        >
          <XIcon />
        </button>
      )}

      <div
        onClick={() => onSelect(step.id)}
        style={{
          width: 180,
          padding: 12,
          borderRadius: 8,
          background: '#27272a', // zinc-800 — hardcoded so it never resolves to transparent
          border: `2px ${step.executorType === 'human_gate' ? 'dashed' : 'solid'} ${borderColor}`,
          color: accentText,
          cursor: 'pointer',
          boxShadow: isSelected ? '0 0 0 2px rgba(255,255,255,0.4)' : 'none',
          transition: 'box-shadow 120ms ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Icon className="w-4 h-4" />
          <span style={{ fontSize: 12, fontWeight: 500, flex: 1, color: '#fafafa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.name || 'Unnamed'}
          </span>
          {isEntry && (
            <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', padding: '2px 4px', borderRadius: 3, background: 'rgba(255,255,255,0.1)', color: '#fafafa' }}>
              entry
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {showUnconfigured ? <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Unconfigured</span> : (step.executorRef || '—')}
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, background: '#52525b', border: '2px solid #18181b' }} />
    </div>
  );
}
