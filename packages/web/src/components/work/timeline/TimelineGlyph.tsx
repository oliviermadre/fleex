/**
 * Maps a timeline glyph to the EXISTING iconography and hues: primitive icons
 * (lib/primitives), workflow executor icons (EXECUTOR_PALETTE), Claude / terminal
 * icons (sidebar), deliverable / comment glyphs, the PR octicon. No new icon is
 * drawn here except the priority flag, which has no existing counterpart.
 */
import { colorForType } from '@fleex/shared';
import { PRIMITIVE_META, PrimitiveIcon } from '../../../lib/primitives';
import { STATUS_HUES } from '../../../lib/statusColors';
import { themedTypeColor, type TintHue } from '../../../lib/tints';
import { EXECUTOR_PALETTE } from '../../workflows/executor-palette';
import { ClaudeIcon, TerminalIcon } from '../../sidebar/icons';
import { CommentIcon, DeliverableIcon } from '../../ui/icons/ActivityIcons';
import { useDeliverableTypesStore } from '../../../stores/deliverableTypesStore';
import type { TimelineGlyph as Glyph } from './buildTimeline';

const PR_HUE = { open: 'green', draft: 'gray', merged: 'purple', closed: 'red' } as const;

function executorEntry(type: string) {
  return EXECUTOR_PALETTE.find((e) => e.type === type) ?? EXECUTOR_PALETTE.find((e) => e.type === 'native')!;
}

/** The glyph's hue (strokes, rings, connectors). Deliverables use their type colour instead. */
export function glyphHue(g: Glyph): TintHue {
  switch (g.type) {
    case 'human': return 'yellow';
    case 'primitive': return PRIMITIVE_META[g.kind].hue;
    case 'executor': return executorEntry(g.executor).hue;
    case 'cli': return 'green';
    case 'deliverable': return 'gray';
    case 'comment': return g.human ? 'yellow' : 'purple';
    case 'pr': return PR_HUE[g.state ?? 'open'];
    case 'priority': return 'orange';
    case 'status': return STATUS_HUES[g.status] ?? 'gray';
  }
}

/** Theme-aware colours of a deliverable type (as configured in Settings), or null. */
export function useDeliverableColor(type: string | null) {
  const types = useDeliverableTypesStore((s) => s.types);
  return type ? themedTypeColor(colorForType(type, types)) : null;
}

function FlagIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

/** The icon itself, inheriting `currentColor`. */
export function GlyphIcon({ glyph, size = 16 }: { glyph: Glyph; size?: number }) {
  switch (glyph.type) {
    case 'human': {
      const Icon = executorEntry('human_gate').Icon;
      return <Icon className="shrink-0" />;
    }
    case 'primitive':
      return <PrimitiveIcon kind={glyph.kind} size={size} tinted={false} />;
    case 'executor': {
      const Icon = executorEntry(glyph.executor).Icon;
      return <Icon className="shrink-0" />;
    }
    case 'cli':
      return glyph.session === 'claude' ? <ClaudeIcon size={size - 2} /> : <TerminalIcon size={size - 2} />;
    case 'deliverable':
      return <DeliverableIcon size={size - 2} />;
    case 'comment':
      return <CommentIcon size={size - 2} />;
    case 'priority':
      return <FlagIcon size={size - 2} />;
    default:
      return null;
  }
}
