import type { PinnedIcon } from '../../stores/settingsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

interface PinnedIconButtonProps {
  icon: PinnedIcon;
  collapsed?: boolean;
}

function renderIcon(icon: PinnedIcon, size: number) {
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
        'flex items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200',
        collapsed ? 'h-8 w-8' : 'h-7 w-7'
      )}
      onClick={() => executePinnedAction(icon)}
      title={icon.label}
    >
      {renderIcon(icon, collapsed ? 18 : 16)}
    </button>
  );
}

export function PinnedIconsBar() {
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);

  if (pinnedIcons.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-800/50 px-2 py-1.5">
      {pinnedIcons.map((icon) => (
        <PinnedIconButton key={icon.id} icon={icon} />
      ))}
    </div>
  );
}
