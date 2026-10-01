import { ACTION_STATUSES, CLICK_MAIN, CLICK_MENU, clickChoiceFor, legacyClickByStatus } from '@fleex/shared';
import type { ActionStatus, ClickChoice, PinnedIcon } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { STATUS_LABEL, statusDotClass, truncate } from '../../actions/actionStatus';
import { Select } from '../../ui/Select';

/** The left click of every status, as the editor shows it (a legacy config is read as it behaves today). */
export function effectiveClickByStatus(draft: PinnedIcon): Record<ActionStatus, ClickChoice> {
  const source = { ...draft, clickByStatus: draft.clickByStatus ?? legacyClickByStatus(draft) };
  return Object.fromEntries(ACTION_STATUSES.map((s) => [s, clickChoiceFor(source, s)])) as Record<ActionStatus, ClickChoice>;
}

/**
 * "Left click": one line per status, each picking one of the action's commands
 * (or "open the menu"). Independent from the right-click menu filters.
 */
export function ClickByStatus({ draft, onChange }: { draft: PinnedIcon; onChange: (next: Record<ActionStatus, ClickChoice>) => void }) {
  const current = effectiveClickByStatus(draft);
  const options = [
    { value: CLICK_MAIN, label: `${draft.label || 'Main command'} (main)` },
    ...(draft.conditionalActions ?? []).map((r, i) => ({ value: r.id, label: r.label || truncate(r.actionValue, 40) || `Command ${i + 2}` })),
    { value: CLICK_MENU, label: 'Open the menu' },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {ACTION_STATUSES.map((s) => (
        <div key={s} className="grid grid-cols-[110px_14px_minmax(0,1fr)] items-center gap-2.5">
          <span className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(s))} /> {STATUS_LABEL[s]}
          </span>
          <span className="text-[var(--theme-text-faint)]">→</span>
          <Select
            aria-label={`Left click when ${STATUS_LABEL[s]}`}
            className="h-7 py-0 text-xs"
            options={options}
            value={current[s]}
            onChange={(e) => onChange({ ...current, [s]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}
