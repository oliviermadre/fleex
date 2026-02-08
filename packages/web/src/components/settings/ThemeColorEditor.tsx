import { useState } from 'react';
import type { Theme, ThemeColors } from '../../lib/themes';
import { applyTheme } from '../../lib/themes';

interface Props {
  theme: Theme;
  onSave: (update: { colors: ThemeColors; name: string }) => void;
  onCancel: () => void;
}

const COLOR_GROUPS: { label: string; keys: (keyof ThemeColors)[] }[] = [
  {
    label: 'Accent',
    keys: ['accent', 'accentHover', 'accentActive', 'accentMuted'],
  },
  {
    label: 'Backgrounds',
    keys: ['bgBase', 'bgSurface', 'bgOverlay', 'bgHover'],
  },
  {
    label: 'Borders',
    keys: ['border', 'borderSubtle', 'borderInput'],
  },
  {
    label: 'Text',
    keys: ['textPrimary', 'textSecondary', 'textMuted', 'textFaint'],
  },
  {
    label: 'Semantic',
    keys: ['success', 'warning', 'danger'],
  },
];

const LABELS: Record<keyof ThemeColors, string> = {
  accent: 'Accent',
  accentHover: 'Accent Hover',
  accentActive: 'Accent Active',
  accentMuted: 'Accent Muted',
  bgBase: 'Base',
  bgSurface: 'Surface',
  bgOverlay: 'Overlay',
  bgHover: 'Hover',
  border: 'Border',
  borderSubtle: 'Subtle',
  borderInput: 'Input',
  textPrimary: 'Primary',
  textSecondary: 'Secondary',
  textMuted: 'Muted',
  textFaint: 'Faint',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
};

function toHex6(color: string): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    return color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
  }
  // For rgba values, return a fallback
  return '#000000';
}

function isRgba(color: string): boolean {
  return color.startsWith('rgba') || color.startsWith('rgb');
}

export function ThemeColorEditor({ theme, onSave, onCancel }: Props) {
  const [colors, setColors] = useState<ThemeColors>({ ...theme.colors });
  const [name, setName] = useState(theme.name);

  const updateColor = (key: keyof ThemeColors, value: string) => {
    const next = { ...colors, [key]: value };
    setColors(next);
    // Live preview
    applyTheme({ ...theme, colors: next });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Editing:</span>
          <input
            type="text"
            className="rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-0.5 text-sm font-semibold text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md bg-[var(--theme-bg-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-border-input)]"
            onClick={() => {
              // Restore original
              applyTheme(theme);
              onCancel();
            }}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--theme-accent-hover)]"
            onClick={() => onSave({ colors, name: name.trim() || theme.name })}
          >
            Save
          </button>
        </div>
      </div>

      {COLOR_GROUPS.map((group) => (
        <div key={group.label}>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
            {group.label}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {group.keys.map((key) => {
              const val = colors[key];
              const rgba = isRgba(val);
              return (
                <div key={key} className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-7 w-7 cursor-pointer rounded border border-[var(--theme-border-input)] bg-transparent p-0"
                      value={rgba ? '#000000' : toHex6(val)}
                      onChange={(e) => updateColor(key, e.target.value)}
                    />
                  </label>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[11px] text-[var(--theme-text-secondary)]">
                      {LABELS[key]}
                    </span>
                    <input
                      type="text"
                      className="w-full rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--theme-text-secondary)] focus:border-[var(--theme-accent)] focus:outline-none"
                      value={val}
                      onChange={(e) => updateColor(key, e.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
