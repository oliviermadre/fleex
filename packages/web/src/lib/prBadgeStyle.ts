import type { PullRequest } from '@fleex/shared';
import { tint, tintClasses, type TintHue } from './tints';

function prHue(pr: Pick<PullRequest, 'state' | 'isDraft'>): TintHue {
  if (pr.isDraft) return 'gray';
  switch (pr.state) {
    case 'merged':
      return 'purple';
    case 'closed':
      return 'red';
    case 'open':
    default:
      return 'green';
  }
}

export function getPrBadgeClasses(pr: Pick<PullRequest, 'state' | 'isDraft'>): string {
  const hue = prHue(pr);
  // Hover flips to the opaque accent; the paired solid-fg keeps the label
  // readable on it in both palettes (white on light 600s, near-black on dark 400s).
  return `${tint(hue)} ${tintClasses(hue).hoverSolid} ${tintClasses(hue).hoverOnSolid}`;
}
