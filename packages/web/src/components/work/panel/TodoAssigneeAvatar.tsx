/**
 * Who a todo item is for, as a 20px round avatar — and, when editable, the
 * picker to change it.
 *
 *   ◌ dashed circle   anyone
 *   human head        the human
 *   robot head        any agent
 *   initials (tint)   one persona
 *
 * Same look as the initials pucks of the execution log (ExecutionRow). The
 * picker lists: Moi · N'importe quel agent · N'importe qui, then the personas
 * — those already seen on the ticket first, a search field past 8.
 */
import { useMemo, useState } from 'react';
import type { AgentPersona, TodoAssignee } from '@fleex/shared';
import { FloatingPortal, usePopover } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { TINT_HUES, tintClasses, type TintHue } from '../../../lib/tints';
import { Input } from '../../ui/Input';
import { Tooltip } from '../../ui/Tooltip';

/** Picker shows a search field past this many personas. */
const SEARCH_FROM = 8;

/** A stable hue per persona, so Builder always reads the same colour. Gray is kept for "nobody". */
export function personaHue(slug: string): TintHue {
  const hues = TINT_HUES.filter((h) => h !== 'gray');
  let hash = 0;
  for (const ch of slug.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[hash % hues.length]!;
}

/** Two letters of the display name: "Builder" → "BU", "Spec Writer" → "SW". */
export function personaInitials(label: string): string {
  const words = label.trim().split(/[\s_-]+/).filter(Boolean);
  const raw = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : label.trim().slice(0, 2);
  return raw.toUpperCase();
}

function displayOf(slug: string, personas: readonly AgentPersona[]): string {
  return personas.find((p) => p.name.toLowerCase() === slug.toLowerCase())?.displayName || slug;
}

/** "Assigné à Builder" / "Pour n'importe qui" — the tooltip and the aria-label. */
export function assigneeLabel(a: TodoAssignee | null, personas: readonly AgentPersona[]): string {
  if (!a) return "Pour n'importe qui";
  if (a.type === 'user') return `Assigné à ${a.name ?? 'vous'}`;
  if (!a.name) return "Pour n'importe quel agent";
  return `Assigné à ${displayOf(a.name, personas)}`;
}

const HumanIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <circle cx="8" cy="5.5" r="2.75" />
    <path d="M2.75 14c.6-2.7 2.7-4.25 5.25-4.25S12.65 11.3 13.25 14" />
  </svg>
);

const RobotIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="10" height="8" rx="2" />
    <line x1="8" y1="2.5" x2="8" y2="5" />
    <circle cx="6" cy="9" r=".6" fill="currentColor" />
    <circle cx="10" cy="9" r=".6" fill="currentColor" />
  </svg>
);

function Face({ value, personas }: { value: TodoAssignee | null; personas: readonly AgentPersona[] }) {
  if (!value) return null;
  if (value.type === 'user') return <HumanIcon />;
  if (!value.name) return <RobotIcon />;
  return <span className="text-[8.5px] font-semibold leading-none">{personaInitials(displayOf(value.name, personas))}</span>;
}

function faceClasses(value: TodoAssignee | null): string {
  if (!value) return 'border border-dashed border-[var(--theme-border-input)] text-[var(--theme-text-faint)]';
  if (value.type === 'user') return cn(tintClasses('blue').bg, tintClasses('blue').text, 'border', tintClasses('blue').borderColor);
  if (!value.name) return cn(tintClasses('gray').bg, tintClasses('gray').text, 'border', tintClasses('gray').borderColor);
  const t = tintClasses(personaHue(value.name));
  return cn(t.bg, t.text, 'border', t.borderColor);
}

interface Props {
  value: TodoAssignee | null;
  personas: readonly AgentPersona[];
  /** Persona slugs already seen on the ticket: listed first. */
  seen?: readonly string[];
  /**
   * Absent = read-only (closed items). `{ type: 'user', name: null }` is "me"
   * (the server fills in the human's name); null is anyone.
   */
  onChange?: (next: TodoAssignee | null, label: string) => void;
  /** Accessible name prefix, e.g. "#3". */
  subject?: string;
}

export function TodoAssigneeAvatar({ value, personas, seen = [], onChange, subject }: Props) {
  const label = assigneeLabel(value, personas);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-end', maxHeight: 320 });
  const [query, setQuery] = useState('');

  const ordered = useMemo(() => {
    const seenSet = new Set(seen.map((s) => s.toLowerCase()));
    const rank = (p: AgentPersona) => (seenSet.has(p.name.toLowerCase()) ? 0 : 1);
    return [...personas].sort((a, b) => rank(a) - rank(b) || (a.displayName || a.name).localeCompare(b.displayName || b.name));
  }, [personas, seen]);
  const q = query.trim().toLowerCase();
  const shown = q ? ordered.filter((p) => `${p.name} ${p.displayName}`.toLowerCase().includes(q)) : ordered;

  const face = (
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', faceClasses(value))}>
      <Face value={value} personas={personas} />
    </span>
  );

  if (!onChange) {
    return (
      <Tooltip label={label} placement="top">
        <span role="img" aria-label={subject ? `${subject} — ${label}` : label} className="inline-flex">{face}</span>
      </Tooltip>
    );
  }

  const pick = (next: TodoAssignee | null) => {
    setOpen(false);
    setQuery('');
    onChange(next, assigneeLabel(next, personas));
  };
  const option = (key: string, text: string, preview: TodoAssignee | null) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        pick(preview);
      }}
      className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
    >
      <span aria-hidden className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full', faceClasses(preview))}>
        <Face value={preview} personas={personas} />
      </span>
      <span className="truncate">{text}</span>
    </button>
  );

  return (
    <>
      <Tooltip label={label} placement="top">
        <button
          ref={refs.setReference}
          {...getReferenceProps()}
          type="button"
          aria-label={subject ? `${subject} — ${label} (changer)` : `${label} (changer)`}
          className="inline-flex rounded-full transition-transform hover:scale-110"
        >
          {face}
        </button>
      </Tooltip>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[200px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {option('me', 'Moi', { type: 'user', name: null })}
            {option('agent', "N'importe quel agent", { type: 'agent', name: null })}
            {option('none', "N'importe qui", null)}
            {personas.length > 0 && <div className="my-1 h-px bg-[var(--theme-border)]" />}
            {personas.length > SEARCH_FROM && (
              <div className="mx-2 mb-1">
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Chercher un agent…"
                  aria-label="Chercher un agent"
                  className="w-full px-1.5 py-0.5 text-[11.5px]"
                />
              </div>
            )}
            {shown.map((p) => option(p.id, p.displayName || p.name, { type: 'agent', name: p.name.toLowerCase() }))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
