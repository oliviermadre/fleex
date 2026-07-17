import type { CreateTicketRequest, TicketPriority, TicketType, UpdateTicketRequest } from '@fleex/shared';

/**
 * Subset of the active board filters (`ticketStore.filters`) that a ticket can
 * inherit when it is created via the column "+ Add card". A filter set to `null`
 * (i.e. "All") is inactive and inherits nothing.
 */
export interface InheritableFilters {
  readonly priority: TicketPriority | null;
  readonly type: TicketType | null;
  readonly tag: string | null;
  readonly favorite: boolean | null;
}

/**
 * Attributes to stamp on a ticket created while filters are active, so it keeps
 * matching the current filter instead of vanishing from the board.
 *
 * - Scalars (`priority`/`type`/`tags`/`favorite`) live on the ticket itself.
 * - `epicIds` are ticket-group memberships applied via `addTicketToGroup`, not a
 *   ticket field. Always present (possibly empty) so callers can iterate safely.
 */
export interface InheritedTicketAttributes {
  readonly priority?: TicketPriority;
  readonly type?: TicketType;
  readonly tags?: string[];
  readonly favorite?: boolean;
  readonly epicIds: string[];
}

/**
 * Derive the attributes a new ticket should inherit from the active board
 * filters and selected epics. Pure — no side effects, no store access.
 */
export function computeInheritedAttributes(
  filters: InheritableFilters,
  selectedEpicIds: readonly string[],
): InheritedTicketAttributes {
  const attrs: {
    priority?: TicketPriority;
    type?: TicketType;
    tags?: string[];
    favorite?: boolean;
    epicIds: string[];
  } = { epicIds: [...selectedEpicIds] };

  if (filters.priority !== null) attrs.priority = filters.priority;
  if (filters.type !== null) attrs.type = filters.type;
  if (filters.tag !== null) attrs.tags = [filters.tag];
  // Only the "starred" filter (favorite === true) is assignable. favorite === false
  // means "show non-favorites", which a fresh ticket already satisfies by default.
  if (filters.favorite === true) attrs.favorite = true;

  return attrs;
}

/**
 * The inherited scalars that `CreateTicketRequest` supports natively, so they can
 * be applied atomically at creation (no flash). Excludes `favorite` (absent from
 * `CreateTicketRequest`) and `epicIds` (a membership, not a field).
 */
export function toCreateFields(
  attrs: InheritedTicketAttributes,
): Pick<CreateTicketRequest, 'priority' | 'type' | 'tags'> {
  const fields: { priority?: TicketPriority; type?: TicketType; tags?: string[] } = {};
  if (attrs.priority !== undefined) fields.priority = attrs.priority;
  if (attrs.type !== undefined) fields.type = attrs.type;
  if (attrs.tags !== undefined) fields.tags = attrs.tags;
  return fields;
}

/**
 * The inherited scalars applied via PATCH after creation. Used for `favorite`
 * (which `CreateTicketRequest` cannot set) and for the import paths, where the
 * ticket is created by the importer without any inherited field.
 */
export function toUpdateFields(attrs: InheritedTicketAttributes): UpdateTicketRequest {
  const fields: UpdateTicketRequest & {
    priority?: TicketPriority;
    type?: TicketType;
    tags?: string[];
    favorite?: boolean;
  } = {};
  if (attrs.priority !== undefined) fields.priority = attrs.priority;
  if (attrs.type !== undefined) fields.type = attrs.type;
  if (attrs.tags !== undefined) fields.tags = attrs.tags;
  if (attrs.favorite !== undefined) fields.favorite = attrs.favorite;
  return fields;
}
