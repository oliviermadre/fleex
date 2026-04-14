import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  resolveTheme,
  type Theme,
  type ThemeColors,
} from '../../lib/themes';
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from '../../lib/constants';
import { ThemeColorEditor } from './ThemeColorEditor';
import { cn } from '../../lib/cn';

const FONT_OPTIONS = [
  { label: 'Default', value: TERMINAL_FONT_FAMILY },
  { label: 'Berkeley Mono', value: '"Berkeley Mono", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'SF Mono', value: '"SF Mono", monospace' },
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'IBM Plex Mono', value: '"IBM Plex Mono", monospace' },
];

export function AppearanceTab() {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);
  const terminalFontFamily = useSettingsStore((s) => s.settings.terminalFontFamily);
  const terminalFontSize = useSettingsStore((s) => s.settings.terminalFontSize);
  const terminalFontThicken = useSettingsStore((s) => s.settings.terminalFontThicken);
  const saveSettings = useSettingsStore((s) => s.saveSettings);

  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  const selectTheme = (id: string) => {
    saveSettings({ activeThemeId: id });
  };

  const duplicateTheme = (source: Theme) => {
    const newTheme: Theme = {
      id: crypto.randomUUID(),
      name: `${source.name} (Copy)`,
      builtIn: false,
      colors: { ...source.colors },
      syntax: { ...source.syntax },
      terminal: { ...source.terminal },
    };
    const updated = [...customThemes, newTheme];
    saveSettings({ customThemes: updated, activeThemeId: newTheme.id });
  };

  const editTheme = (theme: Theme) => {
    if (theme.builtIn) {
      // Fork to custom copy first
      const forked: Theme = {
        id: crypto.randomUUID(),
        name: `${theme.name} (Custom)`,
        builtIn: false,
        colors: { ...theme.colors },
        syntax: { ...theme.syntax },
        terminal: { ...theme.terminal },
      };
      const updated = [...customThemes, forked];
      saveSettings({ customThemes: updated, activeThemeId: forked.id });
      setEditingTheme(forked);
    } else {
      setEditingTheme(theme);
    }
  };

  const handleSaveEdit = ({ colors, name }: { colors: ThemeColors; name: string }) => {
    if (!editingTheme) return;
    const updated = customThemes.map((t) =>
      t.id === editingTheme.id ? { ...t, colors, name } : t
    );
    saveSettings({ customThemes: updated });
    setEditingTheme(null);
  };

  const deleteTheme = (theme: Theme) => {
    if (theme.builtIn) return;
    const updated = customThemes.filter((t) => t.id !== theme.id);
    const newActiveId =
      activeThemeId === theme.id ? DEFAULT_THEME_ID : activeThemeId;
    saveSettings({ customThemes: updated, activeThemeId: newActiveId });
  };

  if (editingTheme) {
    // Resolve current version (may have been updated)
    const current = resolveTheme(editingTheme.id, customThemes);
    return (
      <ThemeColorEditor
        theme={current.id === editingTheme.id ? current : editingTheme}
        onSave={handleSaveEdit}
        onCancel={() => setEditingTheme(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-[var(--theme-text-primary)]">Theme</h3>
        <p className="text-xs text-[var(--theme-text-muted)]">
          Choose a theme or create your own.
        </p>
      </div>

      {/* Theme grid */}
      <div className="grid grid-cols-3 gap-3">
        {allThemes.map((theme) => {
          const isActive = theme.id === activeThemeId;
          return (
            <button
              key={theme.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 text-left transition-all',
                isActive
                  ? 'border-[var(--theme-accent)] ring-1 ring-[var(--theme-accent)]'
                  : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]'
              )}
              onClick={() => selectTheme(theme.id)}
            >
              {/* Color swatches */}
              <div className="flex gap-1">
                <div
                  className="h-6 w-6 rounded"
                  style={{ backgroundColor: theme.colors.accent }}
                />
                <div
                  className="h-6 w-6 rounded"
                  style={{ backgroundColor: theme.colors.bgBase }}
                />
                <div
                  className="h-6 w-6 rounded"
                  style={{ backgroundColor: theme.colors.bgSurface }}
                />
                <div
                  className="h-6 w-6 rounded"
                  style={{ backgroundColor: theme.colors.bgOverlay }}
                />
              </div>
              {/* Name + badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--theme-text-primary)]">
                  {theme.name}
                </span>
                {theme.builtIn && (
                  <span className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[9px] uppercase text-[var(--theme-text-muted)]">
                    built-in
                  </span>
                )}
                {isActive && (
                  <span className="ml-auto rounded bg-[var(--theme-accent-muted)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--theme-accent)]">
                    active
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Actions for active theme */}
      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-[var(--theme-bg-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-border-input)]"
          onClick={() => {
            const theme = resolveTheme(activeThemeId, customThemes);
            editTheme(theme);
          }}
        >
          Edit Theme
        </button>
        <button
          className="rounded-md bg-[var(--theme-bg-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-border-input)]"
          onClick={() => {
            const theme = resolveTheme(activeThemeId, customThemes);
            duplicateTheme(theme);
          }}
        >
          Duplicate
        </button>
        {(() => {
          const theme = resolveTheme(activeThemeId, customThemes);
          if (theme.builtIn) return null;
          return (
            <button
              className="rounded-md bg-[var(--theme-bg-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--theme-danger)] transition-colors hover:bg-[var(--theme-border-input)]"
              onClick={() => deleteTheme(theme)}
            >
              Delete
            </button>
          );
        })()}
      </div>

      {/* Terminal font settings */}
      <div className="border-t border-[var(--theme-border)] pt-6">
        <h3 className="mb-1 text-sm font-semibold text-[var(--theme-text-primary)]">Terminal Font</h3>
        <p className="text-xs text-[var(--theme-text-muted)]">
          Customize the terminal font family and size.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Font family */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
            Font Family
          </label>
          <select
            className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-xs text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            value={FONT_OPTIONS.find((o) => o.value === terminalFontFamily) ? terminalFontFamily : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                saveSettings({ terminalFontFamily: '' });
              } else {
                saveSettings({ terminalFontFamily: e.target.value });
              }
            }}
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
          {/* Custom font input */}
          {!FONT_OPTIONS.find((o) => o.value === terminalFontFamily) && (
            <input
              type="text"
              className="mt-1.5 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-xs text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
              value={terminalFontFamily}
              onChange={(e) => saveSettings({ terminalFontFamily: e.target.value })}
              placeholder={'"My Custom Font", monospace'}
              autoFocus
            />
          )}
        </div>

        {/* Font size */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
            Font Size: {terminalFontSize}px
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={8}
              max={24}
              step={1}
              value={terminalFontSize}
              onChange={(e) => saveSettings({ terminalFontSize: Number(e.target.value) })}
              className="flex-1 accent-[var(--theme-accent)]"
            />
            <input
              type="number"
              min={8}
              max={24}
              value={terminalFontSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 8 && v <= 24) saveSettings({ terminalFontSize: v });
              }}
              className="w-14 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-center text-xs text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>
        </div>

        {/* Font thicken */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <button
            role="switch"
            aria-checked={terminalFontThicken}
            onClick={() => saveSettings({ terminalFontThicken: !terminalFontThicken })}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full transition-colors',
              terminalFontThicken ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border)]'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                terminalFontThicken && 'translate-x-4'
              )}
            />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Font Thicken</span>
            <span className="text-[10px] text-[var(--theme-text-muted)]">Make glyphs thicker, similar to Ghostty's font-thicken</span>
          </div>
        </label>

        {/* Reset button */}
        {(terminalFontFamily !== TERMINAL_FONT_FAMILY || terminalFontSize !== TERMINAL_FONT_SIZE || terminalFontThicken) && (
          <button
            className="self-start rounded-md bg-[var(--theme-bg-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-border-input)]"
            onClick={() => saveSettings({ terminalFontFamily: TERMINAL_FONT_FAMILY, terminalFontSize: TERMINAL_FONT_SIZE, terminalFontThicken: false })}
          >
            Reset to Defaults
          </button>
        )}
      </div>
    </div>
  );
}
