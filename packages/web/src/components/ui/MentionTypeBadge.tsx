import { cn } from '../../lib/cn';
import { tint, type TintHue } from '../../lib/tints';

/**
 * Every @mention target type the server understands (ticket-comment.entity.ts):
 * @agent:name, @panel:name, @skill:commandName, @workflow:slug, plus human and
 * ticket references — plus `scratchpad`, a client-only reference to a note
 * (global or per-ticket) that never reaches the server as an executable mention, and
 * `routine`, a client-only reference to a routine.
 */
export type MentionTargetType = 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket' | 'scratchpad' | 'routine';

/**
 * The ONE letter + hue per mention target type, shared by every surface that
 * needs a per-type visual (mention autocompletes, launcher favourites…). Keep
 * this the single source of truth so the mnemonic stays coherent app-wide.
 */
export const MENTION_TYPE_META: Record<MentionTargetType, { letter: string; hue: TintHue }> = {
  agent: { letter: 'A', hue: 'purple' },
  panel: { letter: 'P', hue: 'blue' },
  skill: { letter: 'S', hue: 'green' },
  workflow: { letter: 'W', hue: 'orange' },
  ticket: { letter: 'T', hue: 'gray' },
  human: { letter: 'H', hue: 'yellow' },
  scratchpad: { letter: 'N', hue: 'teal' },
  routine: { letter: 'R', hue: 'indigo' },
};

const SIZE_CLASSES = {
  /** Compact rows (launcher lists). */
  sm: 'h-4 w-4 rounded-sm text-[8px]',
  /** Desktop autocompletes. */
  md: 'h-5 w-5 rounded text-[10px]',
  /** Touch targets (mobile autocomplete). */
  lg: 'h-6 w-6 rounded text-[11px]',
} as const;

/**
 * Square letter badge identifying a mention target type at a glance
 * (S=skill, W=workflow, P=panel, A=agent…), tinted with the type's hue.
 * Hovering reveals the full type name (title attribute).
 */
export function MentionTypeBadge({
  type,
  size = 'md',
  className,
}: {
  type: MentionTargetType;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const { letter, hue } = MENTION_TYPE_META[type];
  return (
    <span
      title={type}
      className={cn(
        'flex shrink-0 items-center justify-center font-bold',
        SIZE_CLASSES[size],
        tint(hue),
        className,
      )}
    >
      {letter}
    </span>
  );
}
