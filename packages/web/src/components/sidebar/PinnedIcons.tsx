import { useId, useMemo } from 'react';
import type { PinnedIcon } from '../../stores/settingsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

interface PinnedIconButtonProps {
  icon: PinnedIcon;
  collapsed?: boolean;
}

export function renderIcon(icon: Pick<PinnedIcon, 'icon' | 'iconType' | 'label' | 'iconColors'>, size: number) {
  if (icon.iconType === 'svg') {
    return <InlineSvgIcon svg={icon.icon} size={size} mono={icon.iconColors !== 'original'} />;
  }

  if (icon.iconType === 'base64') {
    return <img src={`data:image/png;base64,${icon.icon}`} alt={icon.label} width={size} height={size} className="object-contain" />;
  }

  if (icon.iconType === 'url' || icon.iconType === 'path') {
    return <img src={icon.icon} alt={icon.label} width={size} height={size} className="object-contain" />;
  }

  return null;
}

/**
 * Gives every `id` of the SVG (gradients, clip paths) and the `#id` references
 * to them a prefix unique to this instance. Inline SVGs share the document's id
 * space: two icons both defining `id="a"` would paint each other's gradient, and
 * a hidden copy would blank the visible one.
 */
export function scopeSvgIds(svg: string, prefix: string): string {
  if (!svg.includes('id="')) return svg;
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}${id})`)
    .replace(/\bhref="#([^"]+)"/g, (_, id: string) => `href="#${prefix}${id}"`);
}

function InlineSvgIcon({ svg, size, mono }: { svg: string; size: number; mono: boolean }) {
  const prefix = `i${useId().replace(/[^\w-]/g, '')}-`;
  const html = useMemo(() => scopeSvgIds(svg, prefix), [svg, prefix]);
  return (
    <span
      className={cn('flex items-center justify-center [&>svg]:h-full [&>svg]:w-full', mono && 'action-icon-mono')}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
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
