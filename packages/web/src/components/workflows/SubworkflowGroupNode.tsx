import { tintClasses, type TintHue } from '../../lib/tints';
import type { SubworkflowGroup, GroupStatus } from './subworkflowLayout';

const STATUS: Record<GroupStatus, { label: string; hue: TintHue | null }> = {
  pending: { label: 'pending', hue: null },
  running: { label: 'running', hue: 'blue' },
  needs_you: { label: 'needs you', hue: 'yellow' },
  failed: { label: 'failed', hue: 'red' },
  completed: { label: 'completed', hue: 'green' },
};

/**
 * Frame drawn behind the steps of one expanded sub-workflow in the run graph.
 * Purely visual: the engine sees a flat DAG, this is what lets a reader still
 * see "Spec", "Build" and "QA" as units.
 */
export function SubworkflowGroupNode({ data }: { data: SubworkflowGroup }) {
  const { label, hue } = STATUS[data.status];
  const tinted = hue ? tintClasses(hue) : null;
  return (
    <div
      className={`rounded-xl border-2 border-dashed ${tinted ? tinted.borderColor : 'border-[var(--theme-border)]'}`}
      style={{ width: data.width, height: data.height, pointerEvents: 'none', boxSizing: 'border-box' }}
    >
      <div className="flex items-center gap-2 px-3 pt-1 text-xs font-medium text-[var(--theme-text-primary)]">
        <span className="truncate">{data.label}</span>
        <span className={`text-[10px] ${tinted ? tinted.text : 'text-[var(--theme-text-muted)]'}`}>{label}</span>
      </div>
    </div>
  );
}
