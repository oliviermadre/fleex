import type { WorkflowExecutorType } from '@fleex/shared';

import { tintClasses } from '../../lib/tints';

// ── Inline SVG icons (mirrored from StepRunNode.tsx) ─────────────────────────

interface IconProps {
  className?: string;
}

// Persona — single person (canonical persona glyph, see lib/primitives.tsx).
function PersonIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="7" r="4" />
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    </svg>
  );
}

function UsersIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// Skill — lightning bolt (canonical skill glyph, see lib/primitives.tsx).
function ZapIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
    </svg>
  );
}

function UserCheckIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  );
}

// ── Palette data ──────────────────────────────────────────────────────────────

type IconComponent = React.ComponentType<IconProps>;

export interface PaletteEntry {
  type: WorkflowExecutorType;
  label: string;
  description: string;
  Icon: IconComponent;
  colorClass: string;
}

export const EXECUTOR_PALETTE: PaletteEntry[] = [
  {
    type: 'agent',
    label: 'Agent',
    description: 'AI agent execution',
    Icon: PersonIcon,
    colorClass: `${tintClasses('purple').text} ${tintClasses('purple').borderColor}`,
  },
  {
    type: 'panel',
    label: 'Panel',
    description: 'Multi-agent committee with synthesis',
    Icon: UsersIcon,
    colorClass: `${tintClasses('blue').text} ${tintClasses('blue').borderColor}`,
  },
  {
    type: 'skill',
    label: 'Skill',
    description: 'Deterministic skill instruction file',
    Icon: ZapIcon,
    colorClass: `${tintClasses('green').text} ${tintClasses('green').borderColor}`,
  },
  {
    type: 'human_gate',
    label: 'Human Gate',
    description: 'Manual approval checkpoint',
    Icon: UserCheckIcon,
    colorClass: `${tintClasses('yellow').text} ${tintClasses('yellow').borderColor}`,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export interface ExecutorPaletteProps {
  onDragStart: (type: WorkflowExecutorType, e: React.DragEvent) => void;
}

export function ExecutorPalette({ onDragStart }: ExecutorPaletteProps) {
  return (
    <div
      className="w-[200px] border-r p-3 space-y-2 overflow-y-auto"
      style={{ borderColor: 'var(--theme-border)' }}
    >
      <h3
        className="text-xs font-medium uppercase mb-2"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        Step types
      </h3>
      {EXECUTOR_PALETTE.map((entry) => {
        const { Icon } = entry;
        return (
          <div
            key={entry.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-fleex-executor', entry.type);
              onDragStart(entry.type, e);
            }}
            className={`p-2 rounded border cursor-grab active:cursor-grabbing flex flex-col gap-1 ${entry.colorClass}`}
            style={{ background: 'var(--theme-bg-surface)' }}
          >
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium">{entry.label}</span>
            </div>
            <span className="text-[10px] opacity-60 leading-tight">{entry.description}</span>
          </div>
        );
      })}
    </div>
  );
}
