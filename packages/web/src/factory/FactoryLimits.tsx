import { useFactoryStore } from './factoryStore';
import { CommitInput } from './FactoryMachinePopup';
import { FactoryPopup } from './FactoryPopup';

/**
 * How much the floor may run: runs started per hour, and runs in flight at once. The two fields, with where the floor
 * stands against each. Used alone in its own popup (the command card's "Limits") and at the foot of the floor's
 * figures.
 */
export function RunLimits({ idPrefix }: { idPrefix: string }) {
  const snapshot = useFactoryStore((s) => s.snapshot), setSettings = useFactoryStore((s) => s.setSettings);
  if (!snapshot) return null;
  const s = snapshot.floor.settings;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <CommitInput id={`${idPrefix}-rph`} label="Runs started per hour" value={String(s.maxRunsPerHour)} onCommit={(v) => void setSettings({ maxRunsPerHour: Number(v) })} />
        <CommitInput id={`${idPrefix}-conc`} label="Runs in flight at once" value={String(s.maxConcurrentRuns)} onCommit={(v) => void setSettings({ maxConcurrentRuns: Number(v) })} />
      </div>
      <p className="font-mono text-xs text-[var(--theme-text-secondary)]">{snapshot.runsLastHour} of {s.maxRunsPerHour} started this hour · {snapshot.running} of {s.maxConcurrentRuns} in flight</p>
      <p className="text-xs text-[var(--theme-text-muted)]">On top of the global agent concurrency. Past the hourly limit, tickets wait in their station; past the other, a station starts nothing more until a run ends. 0 runs per hour starts nothing.</p>
    </div>
  );
}

/** The floor's run limits, alone: opened from the command card when nothing is selected. */
export function FactoryLimitsPopup({ onClose }: { onClose: () => void }) {
  return (
    <FactoryPopup label="Run limits" onClose={onClose} size="fit" maxWidth="max-w-md" bar={<b className="min-w-0 flex-1 truncate text-sm text-[var(--theme-text-primary)]">Run limits</b>}>
      <div className="p-4"><RunLimits idPrefix="limits" /></div>
    </FactoryPopup>
  );
}
