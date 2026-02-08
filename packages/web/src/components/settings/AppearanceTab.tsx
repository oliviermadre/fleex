import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  resolveTheme,
  type Theme,
  type ThemeColors,
} from '../../lib/themes';
import { ThemeColorEditor } from './ThemeColorEditor';
import { cn } from '../../lib/cn';

export function AppearanceTab() {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);
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
    </div>
  );
}
