import type { WorkflowEdge, WorkflowStep } from '../../types/workflow.js';

/** A step as written in a document: `position` may be left out (auto-layout). */
export type DocumentStep = Omit<WorkflowStep, 'position'> & { position?: { x: number; y: number } };

/** What `fleex workflow apply` reads, and what `fleex workflow show --json` prints. */
export interface WorkflowDocument {
  slug: string;
  name: string;
  emoji?: string;
  description?: string;
  enabled?: boolean;
  entryStepId: string;
  steps: DocumentStep[];
  edges: WorkflowEdge[];
  /** Read-only: accepted so an export re-applies. */
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ValidationProfile = 'save' | 'apply';
export type InvariantSeverity = 'error' | 'warning' | 'off';

export interface CapabilityRef {
  name: string;
  description?: string;
}

/**
 * What exists in the current workspace, introspected on every call — never
 * hard-coded, it varies from one workspace to another.
 */
export interface WorkflowCapabilities {
  /** `executorRef` of an `agent` step = a persona name. */
  agents: CapabilityRef[];
  /** `executorRef` of a `skill` step = a skill command name. */
  skills: CapabilityRef[];
  /** `executorRef` of a `panel` step = a panel name. */
  panels: CapabilityRef[];
}

export interface ValidationEnv {
  /** `null` = capability checks are skipped (e.g. the editor, which has no store access). */
  caps: WorkflowCapabilities | null;
  /** Id of the template currently holding the document's slug, if any. */
  existingTemplateId?: string | null;
}

export interface Violation {
  /** Registry id, e.g. `edge.endpoints_exist`. */
  invariant: string;
  severity: 'error' | 'warning';
  /** JSONPath-like location: `$.edges[3].target`. */
  path: string;
  stepId?: string;
  edgeId?: string;
  actionId?: string;
  /** Full sentence: what, where, what was received, what was expected. */
  message: string;
}

export interface WorkflowValidationResult {
  errors: Violation[];
  warnings: Violation[];
  /**
   * Set when graph rules could not run because the document shape is invalid.
   * Said out loud so an agent knows a second round may report more.
   */
  skipped?: string;
}
