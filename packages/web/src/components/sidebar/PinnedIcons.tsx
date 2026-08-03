import { useMemo } from 'react';

import type { ActionDef } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { globalActions, useSettingsStore } from '../../stores/settingsStore';

interface PinnedIconButtonProps {
  icon: ActionDef;
  collapsed?: boolean;
}

export function renderIcon(icon: Pick<ActionDef, 'icon' | 'iconType' | 'label'>, size: number) {
  if (icon.iconType === 'svg') {
    return (
      <span
        className="flex items-center justify-center [&>svg]:h-full [&>svg]:w-full"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: icon.icon }}
      />
    );
  }

  if (icon.iconType === 'base64') {
    return (
      <img
        src={`data:image/png;base64,${icon.icon}`}
        alt={icon.label}
        width={size}
        height={size}
        className="object-contain"
      />
    );
  }

  if (icon.iconType === 'url' || icon.iconType === 'path') {
    return (
      <img src={icon.icon} alt={icon.label} width={size} height={size} className="object-contain" />
    );
  }

  return null;
}

export function PinnedIconButton({ icon, collapsed }: PinnedIconButtonProps) {
  const executeAction = useSettingsStore((s) => s.executeAction);

  return (
    <button
      className={cn(
        'flex items-center justify-center cursor-pointer text-[var(--theme-text-primary)] transition-all bg-[var(--theme-accent-muted)] hover:bg-[var(--theme-accent)] hover:shadow-[0_0_12px_var(--theme-accent-muted)] active:bg-[var(--theme-accent)] active:shadow-[0_0_16px_var(--theme-accent-muted)]',
        collapsed ? 'h-9 px-3 rounded-md' : 'h-10 px-4 rounded-lg',
      )}
      onClick={() => executeAction(icon)}
      title={icon.label}
    >
      {renderIcon(icon, collapsed ? 20 : 22)}
    </button>
  );
}

export function PinnedIconsBar() {
  const actions = useSettingsStore((s) => s.settings.actions);
  const pinnedIcons = useMemo(() => globalActions(actions), [actions]);

  if (pinnedIcons.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--theme-border-subtle)] px-3 py-2.5">
      {pinnedIcons.map((icon) => (
        <PinnedIconButton key={icon.id} icon={icon} />
      ))}
    </div>
  );
}
