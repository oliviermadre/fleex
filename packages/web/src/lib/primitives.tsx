import { cn } from './cn';
import { tintText, type TintHue } from './tints';
import { MENTION_TYPE_META, type MentionTargetType } from '../components/ui/MentionTypeBadge';

/**
 * A "primitive" is one of the four launchable building blocks the product is
 * built around: a Persona (an agent), a Skill, a Panel or a Workflow. This file
 * is the SINGLE SOURCE OF TRUTH for how a primitive looks (glyph + hue + label)
 * everywhere it is surfaced — the Primitives sidebar, the launcher, the logs,
 * the executor palette… Never re-hardcode a per-type icon or colour: import
 * `PRIMITIVE_META` / `<PrimitiveIcon>` instead so the visual language stays
 * coherent app-wide.
 */
export type PrimitiveKind = 'persona' | 'skill' | 'panel' | 'workflow';

export const PRIMITIVE_KINDS: PrimitiveKind[] = ['persona', 'skill', 'panel', 'workflow'];

/**
 * Each primitive maps to a mention target type; the hue is DERIVED from
 * `MENTION_TYPE_META` (the mention badge is the source of truth for per-type
 * hues) so the two can never drift apart:
 *   persona → agent → purple
 *   skill   → skill → green
 *   panel   → panel → blue
 *   workflow→ workflow → orange
 */
const KIND_TO_MENTION_TYPE: Record<PrimitiveKind, MentionTargetType> = {
  persona: 'agent',
  skill: 'skill',
  panel: 'panel',
  workflow: 'workflow',
};

type GlyphProps = { size: number; className?: string };

const glyphBaseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Persona — a single person (lucide `user`). Replaces the old robot glyph. */
function PersonaGlyph({ size, className }: GlyphProps) {
  return (
    <svg width={size} height={size} className={className} {...glyphBaseProps} aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    </svg>
  );
}

/** Skill — a lightning bolt (lucide `zap`). Replaces wrench/terminal/book. */
function SkillGlyph({ size, className }: GlyphProps) {
  return (
    <svg width={size} height={size} className={className} {...glyphBaseProps} aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
    </svg>
  );
}

/** Panel — a group of people (lucide `users`). Already the canonical glyph. */
function PanelGlyph({ size, className }: GlyphProps) {
  return (
    <svg width={size} height={size} className={className} {...glyphBaseProps} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Workflow — a tiny nodes+edges graph. Replaces the emoji / stacked boxes. */
function WorkflowGlyph({ size, className }: GlyphProps) {
  return (
    <svg width={size} height={size} className={className} {...glyphBaseProps} aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7.6 7.4 10.6 16M16.4 7.4 13.4 16" />
    </svg>
  );
}

export interface PrimitiveMeta {
  kind: PrimitiveKind;
  /** Singular label, capitalised for headings ("Persona"). */
  label: string;
  /** Plural label used in filter chips / section headers ("Personas"). */
  pluralLabel: string;
  /** The @mention target type this primitive resolves to server-side. */
  mentionType: MentionTargetType;
  /** Canonical hue — derived from `MENTION_TYPE_META`, never duplicated. */
  hue: TintHue;
  Glyph: (props: GlyphProps) => React.ReactNode;
}

export const PRIMITIVE_META: Record<PrimitiveKind, PrimitiveMeta> = {
  persona: {
    kind: 'persona',
    label: 'Persona',
    pluralLabel: 'Personas',
    mentionType: 'agent',
    hue: MENTION_TYPE_META[KIND_TO_MENTION_TYPE.persona].hue,
    Glyph: PersonaGlyph,
  },
  skill: {
    kind: 'skill',
    label: 'Skill',
    pluralLabel: 'Skills',
    mentionType: 'skill',
    hue: MENTION_TYPE_META[KIND_TO_MENTION_TYPE.skill].hue,
    Glyph: SkillGlyph,
  },
  panel: {
    kind: 'panel',
    label: 'Panel',
    pluralLabel: 'Panels',
    mentionType: 'panel',
    hue: MENTION_TYPE_META[KIND_TO_MENTION_TYPE.panel].hue,
    Glyph: PanelGlyph,
  },
  workflow: {
    kind: 'workflow',
    label: 'Workflow',
    pluralLabel: 'Workflows',
    mentionType: 'workflow',
    hue: MENTION_TYPE_META[KIND_TO_MENTION_TYPE.workflow].hue,
    Glyph: WorkflowGlyph,
  },
};

/**
 * The one icon to render for a primitive, tinted with its canonical hue.
 * Pass `tinted={false}` to inherit the surrounding text colour instead (e.g.
 * inside an already-coloured chip or when the row handles its own colour).
 */
export function PrimitiveIcon({
  kind,
  size = 16,
  className,
  tinted = true,
}: {
  kind: PrimitiveKind;
  size?: number;
  className?: string;
  tinted?: boolean;
}) {
  const meta = PRIMITIVE_META[kind];
  return (
    <meta.Glyph
      size={size}
      className={cn(tinted && tintText(meta.hue), className)}
    />
  );
}
