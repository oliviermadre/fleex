import { useSettingsStore } from '../stores/settingsStore';
import { useFactoryStore } from './factoryStore';
import { toast } from '../lib/toast';

/** Settings › General: the switch for the experimental Factory. Saved at once, on its own. */
export function FactorySettingToggle() {
  const on = useSettingsStore((s) => (s.settings as unknown as Record<string, unknown>)['factoryEnabled'] === true);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const supported = useFactoryStore((s) => s.supported);
  const loadStatus = useFactoryStore((s) => s.loadStatus);
  if (!supported) return null;
  return (
    <div className="mt-4 border-t border-[var(--theme-border)] pt-4">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          id="factoryEnabled"
          type="checkbox"
          checked={on}
          onChange={async (e) => {
            const next = e.target.checked;
            await saveSettings({ factoryEnabled: next } as never);
            await loadStatus();
            toast.info(next ? 'Factory switched on' : 'Factory switched off: its machines stop, tickets stay as they are');
          }}
          className="mt-0.5 flex-shrink-0 accent-[var(--theme-accent)]"
        />
        <span className="min-w-0">
          <span className="text-sm font-medium text-[var(--theme-text-primary)]">Factory (experimental)</span>
          <span className="mt-1 block text-xs text-[var(--theme-text-muted)]">
            A floor of machines (belts, arms, stations, zones) that the tickets you hand over to it travel through. Stations
            start real agent runs. When off, the floor does not run, nothing is read or written, and tickets that were on it
            behave like any other ticket. Off by default.
          </span>
        </span>
      </label>
    </div>
  );
}
