import { TICKET_STATUSES, TICKET_PRIORITIES, TICKET_TYPES } from '../constants.js';

/**
 * Native operations — the open/closed catalogue of deterministic ticket
 * mutations a workflow can run without spawning an agent.
 *
 * This module holds *metadata only*, so both the web editor and the server can
 * import it. The server-side behaviour of each operation lives in
 * `packages/server/src/application/services/native-operations/`, keyed by the
 * same `id`. A registry test asserts the two key sets stay identical, so a
 * descriptor can never ship without an implementation (or vice versa).
 *
 * Adding an operation = append a descriptor here + register its planner on the
 * server. No engine change, no React change: the config form is generated from
 * `params`.
 */

export type NativeParamType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'string[]'
  | 'date';

export interface NativeOperationParam {
  name: string;
  label: string;
  type: NativeParamType;
  /** Allowed values when `type === 'enum'`. */
  enum?: readonly string[];
  required: boolean;
  /** When true an explicit `null` clears the field. */
  nullable?: boolean;
  description?: string;
  /** Whether `{{ … }}` references are accepted here. Defaults to true. */
  allowReference?: boolean;
  /** Pre-filled when the action is added in the editor. */
  defaultValue?: unknown;
}

export interface NativeOperationDescriptor {
  id: string;
  label: string;
  category: 'ticket' | 'workflow';
  description: string;
  /**
   * Whether the operation needs the run's subject ticket to exist. Defaults to
   * true — every ticket mutation reads or writes a ticket. A routine run has no
   * ticket, so an operation that does not opt out is rejected there with a
   * named error instead of null-dereferencing deep inside its planner.
   */
  requiresSubjectTicket?: boolean;
  params: readonly NativeOperationParam[];
  /**
   * Ticket fields this operation writes. Two actions in the same step declaring
   * the same field are rejected at template save time — that is what makes the
   * order of actions irrelevant, and therefore the step deterministic.
   */
  conflictsOn?: readonly string[];
}

/** The only native step kind shipped in this lot. */
export const NATIVE_STEP_KIND_TICKET_ACTIONS = 'ticket.actions';

export const NATIVE_OPERATIONS: readonly NativeOperationDescriptor[] = [
  {
    id: 'ticket.create',
    label: 'Create ticket',
    category: 'ticket',
    // It *makes* the subject rather than reading one, so it is the one ticket
    // operation a routine run can execute.
    requiresSubjectTicket: false,
    description:
      'Create a new ticket. Must be the first action of the step; the actions that follow then apply to the ticket just created.',
    params: [
      {
        // Not `required`: a routine run has no ticket, so the default below
        // resolves to nothing and the board falls back to the routine subject's.
        // Marking it required would make that legal case unsaveable.
        name: 'boardId',
        label: 'Board',
        type: 'string',
        required: false,
        defaultValue: '{{ ticket.boardId }}',
        description: "Defaults to the board of the run's ticket, then to the routine subject's board.",
      },
      { name: 'title', label: 'Title', type: 'string', required: true },
      { name: 'description', label: 'Description', type: 'text', required: false },
      { name: 'status', label: 'Status', type: 'enum', enum: TICKET_STATUSES, required: false },
      { name: 'priority', label: 'Priority', type: 'enum', enum: TICKET_PRIORITIES, required: false },
      { name: 'type', label: 'Type', type: 'enum', enum: TICKET_TYPES, required: false, nullable: true },
      { name: 'tags', label: 'Tags', type: 'string[]', required: false },
      { name: 'dueDate', label: 'Due date', type: 'date', required: false, nullable: true },
    ],
  },
  {
    id: 'ticket.upsert',
    label: 'Upsert ticket',
    category: 'ticket',
    // Like `ticket.create` it makes (or finds) the subject rather than reading
    // one, so it is legal in a routine run.
    requiresSubjectTicket: false,
    description:
      'Create a ticket keyed on an external reference, or find the one already imported — '
      + 're-running with the same External ref never creates a duplicate. Must be the first '
      + 'action of the step. When the ticket already exists and "If it already exists" is '
      + '"skip", the step\'s remaining actions are not applied for it.',
    params: [
      {
        name: 'externalRef',
        label: 'External ref',
        type: 'string',
        required: true,
        description:
          'Stable id in the source system, namespaced by convention — e.g. "linear:ABC-42" '
          + 'or "github-project:PVTI_xxx". This is the dedup key.',
      },
      {
        name: 'url',
        label: 'URL',
        type: 'string',
        required: false,
        description: 'Link back to the item in the source system.',
      },
      {
        name: 'onExisting',
        label: 'If it already exists',
        type: 'enum',
        enum: ['skip', 'update'],
        required: false,
        defaultValue: 'skip',
        allowReference: false,
        description:
          'skip: leave the existing ticket untouched and stop the remaining actions for it. '
          + 'update: apply the fields below (tags are added, not replaced) and continue.',
      },
      {
        // Same shape and same rationale as `ticket.create` — see its comment.
        name: 'boardId',
        label: 'Board',
        type: 'string',
        required: false,
        defaultValue: '{{ ticket.boardId }}',
        description: "Defaults to the board of the run's ticket, then to the routine subject's board.",
      },
      { name: 'title', label: 'Title', type: 'string', required: true },
      { name: 'description', label: 'Description', type: 'text', required: false },
      { name: 'status', label: 'Status', type: 'enum', enum: TICKET_STATUSES, required: false },
      { name: 'priority', label: 'Priority', type: 'enum', enum: TICKET_PRIORITIES, required: false },
      { name: 'type', label: 'Type', type: 'enum', enum: TICKET_TYPES, required: false, nullable: true },
      { name: 'tags', label: 'Tags', type: 'string[]', required: false },
      { name: 'dueDate', label: 'Due date', type: 'date', required: false, nullable: true },
    ],
  },
  {
    id: 'ticket.set_status',
    label: 'Set status',
    category: 'ticket',
    description: 'Move the ticket to another status.',
    params: [
      { name: 'status', label: 'Status', type: 'enum', enum: TICKET_STATUSES, required: true },
    ],
    conflictsOn: ['status'],
  },
  {
    id: 'ticket.set_priority',
    label: 'Set priority',
    category: 'ticket',
    description: 'Set the ticket priority.',
    params: [
      { name: 'priority', label: 'Priority', type: 'enum', enum: TICKET_PRIORITIES, required: true },
    ],
    conflictsOn: ['priority'],
  },
  {
    id: 'ticket.set_type',
    label: 'Set type',
    category: 'ticket',
    description: 'Set the ticket type.',
    params: [
      { name: 'type', label: 'Type', type: 'enum', enum: TICKET_TYPES, required: true, nullable: true },
    ],
    conflictsOn: ['type'],
  },
  {
    id: 'ticket.set_title',
    label: 'Set title',
    category: 'ticket',
    description: 'Replace the ticket title.',
    params: [{ name: 'title', label: 'Title', type: 'string', required: true }],
    conflictsOn: ['title'],
  },
  {
    id: 'ticket.set_description',
    label: 'Set description',
    category: 'ticket',
    description: 'Replace, append to, or prepend to the ticket description.',
    params: [
      { name: 'description', label: 'Description', type: 'text', required: true },
      {
        name: 'mode',
        label: 'Mode',
        type: 'enum',
        enum: ['replace', 'append', 'prepend'],
        required: false,
        defaultValue: 'replace',
        allowReference: false,
      },
    ],
    conflictsOn: ['description'],
  },
  {
    id: 'ticket.add_tags',
    label: 'Add tags',
    category: 'ticket',
    description: 'Add tags to the ticket (existing tags are kept).',
    params: [{ name: 'tags', label: 'Tags', type: 'string[]', required: true }],
    conflictsOn: ['tags'],
  },
  {
    id: 'ticket.remove_tags',
    label: 'Remove tags',
    category: 'ticket',
    description: 'Remove tags from the ticket.',
    params: [{ name: 'tags', label: 'Tags', type: 'string[]', required: true }],
    conflictsOn: ['tags'],
  },
  {
    id: 'ticket.set_blocked',
    label: 'Set blocked',
    category: 'ticket',
    description: 'Mark the ticket blocked or unblocked.',
    params: [
      { name: 'blocked', label: 'Blocked', type: 'boolean', required: true, defaultValue: true },
    ],
    conflictsOn: ['blocked'],
  },
  {
    id: 'ticket.set_due_date',
    label: 'Set due date',
    category: 'ticket',
    description: 'Set or clear the due date (leave empty to clear).',
    params: [{ name: 'dueDate', label: 'Due date', type: 'date', required: false, nullable: true }],
    conflictsOn: ['dueDate'],
  },
  {
    id: 'ticket.set_assignee',
    label: 'Set assignee',
    category: 'ticket',
    description: 'Assign the ticket (leave empty to unassign).',
    params: [{ name: 'assignee', label: 'Assignee', type: 'string', required: false, nullable: true }],
    conflictsOn: ['assignee'],
  },
  {
    id: 'ticket.post_comment',
    label: 'Post comment',
    category: 'ticket',
    description: 'Post a comment on the ticket. Supports {{ … }} references.',
    params: [{ name: 'body', label: 'Body', type: 'text', required: true }],
  },
  {
    id: 'workflow.trigger',
    label: 'Trigger workflow',
    category: 'workflow',
    // The whole point: a routine run with no ticket can still spawn work.
    requiresSubjectTicket: false,
    description:
      'Start another workflow run. Runs after this step\'s write, so combined with "Create ticket" it launches a workflow on the ticket just created.',
    params: [
      {
        // Slug, not id: a template id is a uuid nobody can read in a diff, and
        // the slug is what the CLI and the mention syntax already use. The
        // server resolves it through `WorkflowTemplateStorePort.getBySlug`,
        // which every adapter already implements.
        name: 'templateSlug',
        label: 'Workflow',
        type: 'string',
        required: true,
        description: 'Slug of the workflow template to start.',
      },
      {
        name: 'ticketId',
        label: 'Ticket',
        type: 'string',
        required: false,
        description:
          "Defaults to the step's subject — the ticket just created when the step starts with Create ticket.",
      },
    ],
  },
];

const BY_ID = new Map(NATIVE_OPERATIONS.map((op) => [op.id, op]));

export function getNativeOperation(id: string): NativeOperationDescriptor | undefined {
  return BY_ID.get(id);
}

export const NATIVE_OPERATION_IDS: readonly string[] = NATIVE_OPERATIONS.map((op) => op.id);

/** `ticket.create` is special-cased by the executor: it rebinds the step's subject. */
export const NATIVE_OP_CREATE_TICKET = 'ticket.create';

/** Idempotent sibling of `ticket.create`, keyed on an external reference. */
export const NATIVE_OP_UPSERT_TICKET = 'ticket.upsert';

/**
 * The operations that make (or find) the step's subject instead of reading one.
 * Every "must be the first action / at most one per step / rebinds the subject /
 * enables `{{ created.* }}`" rule keys on this list, so a future member inherits
 * the whole contract by being added here.
 */
export const NATIVE_CREATE_FAMILY: readonly string[] = [
  NATIVE_OP_CREATE_TICKET,
  NATIVE_OP_UPSERT_TICKET,
];

/** Spawns a child workflow run. Special-cased only in that it needs no ticket. */
export const NATIVE_OP_TRIGGER_WORKFLOW = 'workflow.trigger';

/**
 * Hard cap on a `forEach` fan-out.
 *
 * An upstream agent step decides the length of the array, so without a ceiling
 * a hallucinated 900-element list would create 900 tickets before anyone
 * noticed. Exceeding it fails the step rather than truncating: silently doing
 * "the first 50" is the one outcome no author could have meant.
 */
export const NATIVE_FOR_EACH_MAX_ITEMS = 50;
