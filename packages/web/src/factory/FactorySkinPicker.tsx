/**
 * Settings › Appearance, under the theme: how the Factory floor is painted. One card a skin, each with the made-up
 * floor of `shots/fixture.ts` painted by the real renderer in that skin and the theme in use, as the theme cards
 * above show their colours. Shown only while the Factory is on; it saves by itself (`factorySkin`).
 */
import { useEffect, useRef } from 'react';
import { useActiveTheme } from '../hooks/useActiveTheme';
import { cn } from '../lib/cn';
import { useSettingsStore } from '../stores/settingsStore';
import { useFactoryStore } from './factoryStore';
import { FactoryView } from './renderer';
import { floorState, tickets } from './shots/fixture';
import { DEFAULT_SKIN, SKINS, type SkinInfo } from './skins';

/** A few frames of the made-up floor, in that skin: enough for tickets to settle where they stand. */
function Preview({ skin, theme }: { skin: SkinInfo; theme: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    /* after the frame: a theme just chosen is applied by an effect of the app, which runs after this one */
    const raf = requestAnimationFrame(() => {
      const cv = ref.current;
      if (!cv?.getContext('2d') || !cv.clientWidth) return;
      /* no name tags: at this size they would cover the floor */
      const plain = tickets.map((t) => (t.info?.favorite ? { ...t, info: { ...t.info, favorite: false } } : t));
      const v = new FactoryView(cv, skin.make()), st = floorState({ tickets: plain, selTicket: null, hoverMachine: null, dim: null, found: null, named: null, armTags: false });
      v.resize(); v.cam = { x: 13, y: 8.5, z: 11 };
      for (let i = 0; i < 24; i++) v.draw(st, 1 / 60);
    });
    return () => cancelAnimationFrame(raf);
  }, [skin, theme]);
  return <canvas ref={ref} aria-hidden="true" className="block h-28 w-full rounded" />;
}

export function FactorySkinPicker() {
  const on = useFactoryStore((s) => s.enabled), chosen = useSettingsStore((s) => s.settings.factorySkin) ?? DEFAULT_SKIN, saveSettings = useSettingsStore((s) => s.saveSettings), theme = useActiveTheme();
  if (!on) return null;
  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Factory skin">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-[var(--theme-text-primary)]">Factory skin</h3>
        <p className="text-xs text-[var(--theme-text-muted)]">How the Factory floor is painted. The page around the floor takes its colours; a skin follows the theme where it can.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {SKINS.map((s) => {
          const active = s.id === chosen;
          return (
            <button
              key={s.id} type="button" aria-pressed={active} onClick={() => void saveSettings({ factorySkin: s.id })}
              className={cn('flex flex-col gap-2 rounded-lg border p-2 text-left transition-all', active ? 'border-[var(--theme-accent)] ring-1 ring-[var(--theme-accent)]' : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]')}
            >
              <Preview skin={s} theme={theme.id} />
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-medium text-[var(--theme-text-primary)]">{s.name}</span>
                <span className="min-w-0 truncate text-[11px] text-[var(--theme-text-muted)]">{s.blurb}</span>
                {active && <span className="ml-auto rounded bg-[var(--theme-accent-muted)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--theme-accent)]">active</span>}
              </div>
            </button>
          );
        })}
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--theme-border)] p-2 opacity-60" aria-disabled="true">
          <div className="flex h-28 items-center justify-center rounded bg-[var(--theme-bg-overlay)] font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--theme-text-muted)]">Pixel · coming</div>
          <div className="px-1 text-xs text-[var(--theme-text-muted)]">Pixel</div>
        </div>
      </div>
    </div>
  );
}
