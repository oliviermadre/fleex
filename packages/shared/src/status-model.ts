import type { TicketStatus } from './types/ticket.js';

/**
 * Semantic status model.
 *
 * Ticket statuses are NOT just kanban columns: their string keys historically
 * carried hardcoded meaning across the whole codebase (`if status === 'done'`).
 * This module is the single source of that meaning. Behaviour must branch on a
 * *role*, never on a literal key, so that columns can later be renamed, added,
 * removed or recoloured without touching logic.
 *
 * Two families of roles:
 *  - Predicate roles (any number of columns): `startable`, `active`, `terminal`.
 *  - Anchor roles (exactly one column each): `defaultNew`, `workStart`,
 *    `agentQueue`, `mergeLanding` — used when an automation needs a *target*
 *    column, not just a classification (e.g. "move the ticket to <workStart>").
 *
 * The role vocabulary is closed and defined here in code; columns merely
 * reference it. NB: the term "workflow" is reserved by the agentic workflow
 * engine (workflow_templates/runs/steps) and is intentionally avoided here.
 */

/** Outcome of a terminal column — distinguishes success from abandonment. */
export type StatusOutcome = 'completed' | 'abandoned';

/** Anchor roles. Exactly one column fills each across a valid model. */
export type StatusAnchor = 'defaultNew' | 'workStart' | 'agentQueue' | 'mergeLanding';

export interface StatusColumn {
  /** Stable identity. Written to ticket.status; never re-derived from the label. */
  readonly key: TicketStatus;
  readonly label: string;
  /** Column order on the board (ascending). */
  readonly order: number;
  // ── Predicate roles ──
  /** Eligible to be auto-started (→ moved to the workStart column) on session/agent launch. */
  readonly startable: boolean;
  /** Work in progress — surfaced in the session sidebar. */
  readonly active: boolean;
  /** Closed column — triggers close-time automations (summary, mention resolution, hiding). */
  readonly terminal: boolean;
  /** Meaningful only when `terminal`. */
  readonly outcome: StatusOutcome | null;
  // ── Anchor roles filled by this column ──
  readonly anchors: readonly StatusAnchor[];
  // ── Presentation (not a semantic role; kept here for PR4 dynamic rendering) ──
  readonly collapsedByDefault: boolean;
}

export interface StatusModel {
  readonly columns: readonly StatusColumn[];
}

/**
 * The built-in model. Reproduces the six historical statuses with their exact
 * prior behaviour so the role refactor is behaviour-preserving:
 *  - startable: backlog, todo        (auto-moved to doing on session start)
 *  - active:    doing, reviewing     (shown in session sidebar)
 *  - terminal:  done (completed), cancelled (abandoned)
 *  - anchors:   defaultNew=backlog, workStart=doing, agentQueue=todo, mergeLanding=done
 */
export const DEFAULT_STATUS_MODEL: StatusModel = {
  columns: [
    { key: 'backlog',   label: 'Backlog',   order: 0, startable: true,  active: false, terminal: false, outcome: null,         anchors: ['defaultNew'],   collapsedByDefault: false },
    { key: 'todo',      label: 'Todo',      order: 1, startable: true,  active: false, terminal: false, outcome: null,         anchors: ['agentQueue'],   collapsedByDefault: false },
    { key: 'doing',     label: 'Doing',     order: 2, startable: false, active: true,  terminal: false, outcome: null,         anchors: ['workStart'],    collapsedByDefault: false },
    { key: 'reviewing', label: 'Reviewing', order: 3, startable: false, active: true,  terminal: false, outcome: null,         anchors: [],               collapsedByDefault: false },
    { key: 'done',      label: 'Done',      order: 4, startable: false, active: false, terminal: true,  outcome: 'completed',  anchors: ['mergeLanding'], collapsedByDefault: false },
    { key: 'cancelled', label: 'Cancelled', order: 5, startable: false, active: false, terminal: true,  outcome: 'abandoned',  anchors: [],               collapsedByDefault: true  },
  ],
};

// ── Active model registry ──────────────────────────────────────────────────
// PR1 always uses the built-in default. PR2 will populate this at bootstrap
// from persistence; consumers stay unchanged because they read the active model.

let activeModel: StatusModel = DEFAULT_STATUS_MODEL;

/** Replace the active status model (called at bootstrap / on config change). */
export function setActiveStatusModel(model: StatusModel): void {
  activeModel = model;
}

export function getActiveStatusModel(): StatusModel {
  return activeModel;
}

export function findStatusColumn(key: string, model: StatusModel = activeModel): StatusColumn | undefined {
  return model.columns.find((c) => c.key === key);
}

/**
 * Resolve the (single) column key that fills an anchor role. Throws if the
 * model has no column for the anchor — a model validator (PR3) enforces that
 * exactly one column fills each anchor, so this is an invariant violation.
 */
export function resolveAnchor(anchor: StatusAnchor, model: StatusModel = activeModel): TicketStatus {
  const col = model.columns.find((c) => c.anchors.includes(anchor));
  if (!col) throw new Error(`Status model has no column for anchor '${anchor}'`);
  return col.key;
}

/** Named anchor accessors. Each returns the key of the column filling the role. */
export const statusAnchors = {
  defaultNew: (model?: StatusModel): TicketStatus => resolveAnchor('defaultNew', model),
  workStart: (model?: StatusModel): TicketStatus => resolveAnchor('workStart', model),
  agentQueue: (model?: StatusModel): TicketStatus => resolveAnchor('agentQueue', model),
  mergeLanding: (model?: StatusModel): TicketStatus => resolveAnchor('mergeLanding', model),
} as const;

/**
 * Value-object wrapper around a status key. Carries the semantic role
 * predicates so callers write `Status.of(key).isTerminal()` instead of
 * comparing against a literal. An unknown key resolves to "no roles".
 */
export class Status {
  private constructor(
    readonly key: string,
    private readonly column: StatusColumn | undefined,
  ) {}

  static of(key: string, model: StatusModel = activeModel): Status {
    return new Status(key, findStatusColumn(key, model));
  }

  isStartable(): boolean {
    return this.column?.startable ?? false;
  }

  isActive(): boolean {
    return this.column?.active ?? false;
  }

  isTerminal(): boolean {
    return this.column?.terminal ?? false;
  }

  /** Terminal with a successful outcome (historically `done`). */
  isCompleted(): boolean {
    return this.column?.terminal === true && this.column.outcome === 'completed';
  }

  /** Terminal with an abandoned outcome (historically `cancelled`). */
  isCancelled(): boolean {
    return this.column?.terminal === true && this.column.outcome === 'abandoned';
  }

  get outcome(): StatusOutcome | null {
    return this.column?.outcome ?? null;
  }

  /** Whether this column fills the given anchor role. */
  fills(anchor: StatusAnchor): boolean {
    return this.column?.anchors.includes(anchor) ?? false;
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export type StatusModelValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

const REQUIRED_ANCHORS: readonly StatusAnchor[] = ['defaultNew', 'workStart', 'agentQueue', 'mergeLanding'];

/**
 * Enforce the invariants that replace "the six statuses always exist". A model
 * is only safe to activate when every automation can resolve its target:
 *  - exactly one column fills each anchor role
 *  - the mergeLanding column is a completed terminal
 *  - at least one terminal (and at least one completed terminal)
 *  - at least one startable and one active column
 *  - keys are unique and non-empty; outcome is set iff the column is terminal
 *
 * Shared so the editing UI (PR4) can mirror server-side validation exactly.
 */
export function validateStatusModel(model: StatusModel): StatusModelValidation {
  const errors: string[] = [];
  const { columns } = model;

  if (columns.length === 0) {
    return { ok: false, errors: ['A status model must have at least one column.'] };
  }

  // Keys: present and unique.
  const seen = new Set<string>();
  for (const c of columns) {
    if (!c.key || c.key.trim() === '') errors.push('Every column must have a non-empty key.');
    if (seen.has(c.key)) errors.push(`Duplicate column key: '${c.key}'.`);
    seen.add(c.key);
    if (c.terminal && c.outcome === null) errors.push(`Terminal column '${c.key}' must declare an outcome.`);
    if (!c.terminal && c.outcome !== null) errors.push(`Non-terminal column '${c.key}' must not declare an outcome.`);
  }

  // Anchors: exactly one column each.
  for (const anchor of REQUIRED_ANCHORS) {
    const holders = columns.filter((c) => c.anchors.includes(anchor));
    if (holders.length === 0) errors.push(`No column fills the '${anchor}' anchor.`);
    if (holders.length > 1) {
      errors.push(`The '${anchor}' anchor is filled by more than one column: ${holders.map((c) => c.key).join(', ')}.`);
    }
  }

  // mergeLanding must be a completed terminal.
  const mergeLanding = columns.find((c) => c.anchors.includes('mergeLanding'));
  if (mergeLanding && !(mergeLanding.terminal && mergeLanding.outcome === 'completed')) {
    errors.push(`The mergeLanding column '${mergeLanding.key}' must be a terminal column with outcome 'completed'.`);
  }

  // Coverage of predicate roles.
  if (!columns.some((c) => c.terminal)) errors.push('At least one column must be terminal.');
  if (!columns.some((c) => c.terminal && c.outcome === 'completed')) {
    errors.push("At least one terminal column must have outcome 'completed'.");
  }
  if (!columns.some((c) => c.startable)) errors.push('At least one column must be startable.');
  if (!columns.some((c) => c.active)) errors.push('At least one column must be active.');

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
