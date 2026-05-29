import type { ModelFamily, ModelOption } from '@fleex/shared';
import { useModels } from '../../hooks/useModels';
import { cn } from '../../lib/cn';

interface ModelBadgeProps {
  /** Raw model id, e.g. 'claude-opus-4-8' */
  modelId: string;
  /**
   * 'compact' = sidebar-style tiny tag (default).
   * 'normal'  = header-style slightly larger.
   */
  size?: 'compact' | 'normal';
  className?: string;
}

function familyOf(id: string): ModelFamily {
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  return 'other';
}

/**
 * Family palette. Chosen for legibility on the dark sidebar (Tailwind 400/500
 * range on a translucent tinted background — same hue, never washed out).
 * - opus   → red    (heavyweight, premium)
 * - sonnet → orange (mid-tier daily driver)
 * - haiku  → green  (fast, cheap)
 * - other  → gray   (unknown / unscored)
 */
const FAMILY_STYLES: Record<ModelFamily, string> = {
  opus: 'bg-red-500/15 text-red-300',
  sonnet: 'bg-orange-500/15 text-orange-300',
  haiku: 'bg-green-500/15 text-green-300',
  other: 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)]',
};

/**
 * Render the bare model identifier, dropping the marketing-only 'claude-' prefix.
 * e.g. 'claude-opus-4-8' → 'opus-4-8'.
 * We keep the full version (4-8, not '4.8' or '') so the user can tell apart
 * sonnet-4-6 vs sonnet-4-5 at a glance — per spec.
 */
function shortId(id: string): string {
  return id.replace(/^claude-/, '');
}

export function ModelBadge({ modelId, size = 'compact', className }: ModelBadgeProps) {
  const { models, isLoading } = useModels();
  const family = familyOf(modelId);
  const knownIds = new Set(models.map((m: ModelOption) => m.id));

  // Outdated = the persona's model is not in the live dynamic list.
  // We only flag it once the list is loaded (avoid false-positives during the
  // initial /api/models fetch).
  const isOutdated = !isLoading && knownIds.size > 0 && !knownIds.has(modelId);

  const sizeClasses =
    size === 'compact'
      ? 'px-1.5 py-0.5 text-[9px]'
      : 'px-1.5 py-0.5 text-[10px]';

  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 rounded font-medium font-mono',
        sizeClasses,
        FAMILY_STYLES[family],
        className,
      )}
      title={
        isOutdated
          ? `${modelId} — not in the current Anthropic model list`
          : modelId
      }
    >
      {isOutdated && <span aria-label="outdated model">⚠️</span>}
      {shortId(modelId)}
    </span>
  );
}
