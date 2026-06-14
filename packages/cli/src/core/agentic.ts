/**
 * Shared helpers for the "agentic zone" CLI commands (agent / skill / panel /
 * workflow) and the `trigger` command.
 *
 * The four primitives are discoverable via existing read-only server endpoints
 * and are *triggered* by posting a comment containing a `@type:name` token —
 * the server already parses those tokens (see the server's
 * ticket-comment.entity.ts) and routes them to the right primitive. This module
 * centralises fetching, the mapping primitive → mention handle, and the
 * validation/"did you mean" logic so each command file stays tiny.
 */
import { apiBase, apiGet } from './api.ts';
import { c, padEndVisible, visibleLength } from './colors.ts';

export type AgenticType = 'agent' | 'skill' | 'panel' | 'workflow';

export interface Persona {
  id: string;
  name: string;
  displayName: string;
  model: string;
  executionMode: string;
  humanMentionName: string | null;
  soulMd?: string;
  identityMd?: string;
  memoryMd?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PersonaStatus {
  running: boolean;
  pendingMentionCount: number;
  activeMentionIds: string[];
}

export interface Skill {
  id: string;
  commandName: string;
  name: string;
  displayName: string;
  markdownContent?: string;
  enabled: boolean;
  personaId?: string;
}

export interface PanelMember {
  order?: number;
  personaId?: string;
  modelOverride?: string;
  [k: string]: unknown;
}

export interface Panel {
  id: string;
  name: string;
  displayName: string;
  description: string;
  executionMode: string;
  members: PanelMember[];
  orchestratorModel?: string;
  orchestratorPrompt?: string;
  enabled: boolean;
}

export interface WorkflowStep {
  id: string;
  name?: string;
  executorRef?: string;
  executorType?: string;
  [k: string]: unknown;
}

export interface Workflow {
  id: string;
  name: string;
  slug: string;
  emoji?: string;
  description: string;
  steps: WorkflowStep[];
  entryStepId?: string;
  enabled: boolean;
}

/** Human-facing label for a primitive type (singular). */
export const TYPE_LABEL: Record<AgenticType, string> = {
  agent: 'agent',
  skill: 'skill',
  panel: 'panel',
  workflow: 'workflow',
};

/** The `@type:name` token the server's mention parser understands. */
export function handle(type: AgenticType, name: string): string {
  return `@${type}:${name}`;
}

// ── Fetchers ──────────────────────────────────────────────────────────────

export function fetchPersonas(): Promise<Persona[]> {
  return apiGet<Persona[]>(`${apiBase()}/api/personas`);
}
export function fetchPersonaStatuses(): Promise<Record<string, PersonaStatus>> {
  return apiGet<Record<string, PersonaStatus>>(`${apiBase()}/api/personas/statuses`);
}
export function fetchSkills(enabledOnly = false): Promise<Skill[]> {
  return apiGet<Skill[]>(`${apiBase()}/api/skills${enabledOnly ? '/enabled' : ''}`);
}
export function fetchPanels(enabledOnly = false): Promise<Panel[]> {
  return apiGet<Panel[]>(`${apiBase()}/api/panels${enabledOnly ? '/enabled' : ''}`);
}
export function fetchWorkflows(enabledOnly = false): Promise<Workflow[]> {
  return apiGet<Workflow[]>(
    `${apiBase()}/api/workflows/templates${enabledOnly ? '/enabled' : ''}`,
  );
}

/** The mention handle name for each primitive (the part after `@type:`). */
export function personaHandleName(p: Persona): string {
  return p.name;
}
export function skillHandleName(s: Skill): string {
  return s.commandName;
}
export function panelHandleName(p: Panel): string {
  return p.name;
}
export function workflowHandleName(w: Workflow): string {
  return w.slug;
}

// ── Generic resolution by id-or-name ────────────────────────────────────────

function looksLikeUuid(s: string): boolean {
  return s.includes('-') && s.length >= 36;
}

/**
 * Resolve a `<id|name>` argument against an already-fetched list. Matches a
 * UUID `id`, else the handle name, else the displayName (case-insensitive).
 * Returns the matched item or undefined.
 */
export function resolveFromList<T extends { id: string }>(
  arg: string,
  list: T[],
  handleNameOf: (item: T) => string,
  displayNameOf?: (item: T) => string,
): T | undefined {
  if (looksLikeUuid(arg)) {
    const byId = list.find((x) => x.id === arg);
    if (byId) return byId;
  }
  const lower = arg.toLowerCase();
  return (
    list.find((x) => handleNameOf(x).toLowerCase() === lower) ??
    (displayNameOf ? list.find((x) => displayNameOf(x).toLowerCase() === lower) : undefined)
  );
}

// ── Handle validation + suggestions (for `trigger`) ─────────────────────────

/** Levenshtein edit distance (small inputs, no need to optimise). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

/** Closest candidate to `input` within a small edit distance, or undefined. */
export function suggest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const cand of candidates) {
    const d = editDistance(input.toLowerCase(), cand.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  // Only suggest when it's actually close (≤ ~40% of the word length).
  if (best && bestDist <= Math.max(2, Math.floor(best.length * 0.4))) return best;
  return undefined;
}

export interface HandleCatalog {
  agent: string[];
  skill: string[];
  panel: string[];
  workflow: string[];
}

/** Fetch the valid handle names for every primitive type in parallel. */
export async function loadHandleCatalog(): Promise<HandleCatalog> {
  const [personas, skills, panels, workflows] = await Promise.all([
    fetchPersonas(),
    fetchSkills(),
    fetchPanels(),
    fetchWorkflows(),
  ]);
  return {
    agent: personas.map(personaHandleName),
    skill: skills.map(skillHandleName),
    panel: panels.map(panelHandleName),
    workflow: workflows.map(workflowHandleName),
  };
}

// ── Table rendering ─────────────────────────────────────────────────────────

/** Truncate a string to `max` chars, adding an ellipsis when cut. */
export function trunc(s: string, max: number): string {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(0, max - 1)) + '…';
}

/**
 * Render a simple aligned table. Column widths are derived from the visible
 * (ANSI-stripped) length of header + cells so chalk colours don't break
 * padding. Headers are bold.
 */
export function renderTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ''))),
  );
  const headerLine = headers.map((h, i) => padEndVisible(c.bold(h), widths[i]!)).join('  ');
  process.stdout.write(`\n  ${headerLine}\n`);
  for (const row of rows) {
    const line = row.map((cell, i) => padEndVisible(cell ?? '', widths[i]!)).join('  ');
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('\n');
}

/** Print a value as pretty JSON and a trailing newline. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
