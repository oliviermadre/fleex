import type { PinnedIcon } from '../../stores/settingsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

interface PinnedIconButtonProps {
  icon: PinnedIcon;
  collapsed?: boolean;
}

export function renderIcon(icon: Pick<PinnedIcon, 'icon' | 'iconType' | 'label'>, size: number) {
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
    return <img src={`data:image/png;base64,${icon.icon}`} alt={icon.label} width={size} height={size} className="object-contain" />;
  }

  if (icon.iconType === 'url' || icon.iconType === 'path') {
    return <img src={icon.icon} alt={icon.label} width={size} height={size} className="object-contain" />;
  }

  return null;
}

export function PinnedIconButton({ icon, collapsed }: PinnedIconButtonProps) {
  const executePinnedAction = useSettingsStore((s) => s.executePinnedAction);

  return (
    <button
      className={cn(
        'flex items-center justify-center cursor-pointer text-[var(--theme-text-primary)] transition-all bg-[var(--theme-accent-muted)] hover:bg-[var(--theme-accent)] hover:shadow-[0_0_12px_var(--theme-accent-muted)] active:bg-[var(--theme-accent)] active:shadow-[0_0_16px_var(--theme-accent-muted)]',
        collapsed ? 'h-9 px-3 rounded-md' : 'h-10 px-4 rounded-lg'
      )}
      onClick={() => executePinnedAction(icon)}
      title={icon.label}
    >
      {renderIcon(icon, collapsed ? 20 : 22)}
    </button>
  );
}

export function PinnedIconsBar() {
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);

  if (pinnedIcons.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--theme-border-subtle)] px-3 py-2.5">
      {pinnedIcons.map((icon) => (
        <PinnedIconButton key={icon.id} icon={icon} />
      ))}
    </div>
  );
}
