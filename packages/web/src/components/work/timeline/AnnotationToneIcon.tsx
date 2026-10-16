/**
 * One SVG per annotation tone, tinted with the tone's hue — the same glyph on
 * the card, in the reader, in a stack and on the tone chips, so a tone reads
 * the same everywhere.
 */
import type { AnnotationTone } from '@fleex/shared';
import type { ComponentType } from 'react';
import { AlertIcon, CircleCheckIcon, HighlighterIcon, InfoIcon } from '../../ui/icons/AnnotationIcons';
import { TONE_HUE } from './layoutAnnotations';

const TONE_ICON: Record<AnnotationTone, ComponentType<{ size?: number; className?: string }>> = {
  info: InfoIcon,
  highlight: HighlighterIcon,
  warning: AlertIcon,
  success: CircleCheckIcon,
};

export function AnnotationToneIcon({ tone, size = 13, className, hue }: { tone: AnnotationTone; size?: number; className?: string; hue?: string }) {
  const Glyph = TONE_ICON[tone];
  return (
    <span
      data-tone-icon={tone}
      className={className ? `inline-flex shrink-0 ${className}` : 'inline-flex shrink-0'}
      style={{ color: `var(--tint-${hue ?? TONE_HUE[tone]}-solid)` }}
    >
      <Glyph size={size} />
    </span>
  );
}
