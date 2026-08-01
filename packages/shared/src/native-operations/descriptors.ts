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
  category: 'ticket';
  description: string;
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
    description:
      'Create a new ticket. Must be the first action of the step; the actions that follow then apply to the ticket just created.',
    params: [
      {
        name: 'boardId',
        label: 'Board',
        type: 'string',
        required: true,
        defaultValue: '{{ ticket.boardId }}',
        description: "Defaults to the board of the run's ticket.",
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
];

const BY_ID = new Map(NATIVE_OPERATIONS.map((op) => [op.id, op]));

export function getNativeOperation(id: string): NativeOperationDescriptor | undefined {
  return BY_ID.get(id);
}

export const NATIVE_OPERATION_IDS: readonly string[] = NATIVE_OPERATIONS.map((op) => op.id);

/** `ticket.create` is special-cased by the executor: it rebinds the step's subject. */
export const NATIVE_OP_CREATE_TICKET = 'ticket.create';
