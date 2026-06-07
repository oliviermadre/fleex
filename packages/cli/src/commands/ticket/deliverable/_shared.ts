import { readFileSync } from 'node:fs';
import {
  DELIVERABLE_TYPES,
  DELIVERABLE_STATUSES,
  isDeliverableStatus,
} from '@fleex/shared';
import type { DeliverableTypeDef, DeliverableStatus, TicketDeliverable } from '@fleex/shared';
import { die } from '../../../core/colors.ts';
import { apiBase, apiCall } from '../../../core/api.ts';

/**
 * Fetch the workspace's configured deliverable type ids from the server. Falls
 * back to the default preset if the endpoint is unreachable (e.g. older server).
 */
async function fetchDeliverableTypeIds(): Promise<string[]> {
  try {
    const view = await apiCall<{ types: DeliverableTypeDef[] }>('GET', `${apiBase()}/api/deliverable-types`);
    const ids = view?.types?.map((t) => t.id) ?? [];
    return ids.length > 0 ? ids : DELIVERABLE_TYPES;
  } catch {
    return DELIVERABLE_TYPES;
  }
}

/**
 * Validate a deliverable type against the workspace's configured types.
 * Exits the process via `die` when invalid.
 */
export async function assertValidType(t: string): Promise<void> {
  const valid = await fetchDeliverableTypeIds();
  if (!valid.includes(t)) {
    die(`Invalid type: ${t} (valid: ${valid.join(', ')})`);
  }
}

export function assertValidStatus(s: string): asserts s is DeliverableStatus {
  if (!isDeliverableStatus(s)) {
    die(`Invalid status: ${s} (valid: ${DELIVERABLE_STATUSES.join(', ')})`);
  }
}

/**
 * Resolve the deliverable content from either --content or --file. Exactly one
 * (or zero, when `allowEmpty` is true) must be provided. Files are read as-is
 * (UTF-8) so callers can ship Markdown or HTML without server-side conversion.
 */
export function resolveContent(opts: { content?: string; file?: string }, allowEmpty = false): string | undefined {
  if (opts.content !== undefined && opts.file !== undefined) {
    die('Use either --content or --file, not both.');
  }
  if (opts.content !== undefined) return opts.content;
  if (opts.file !== undefined) {
    try {
      return readFileSync(opts.file, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      die(`Cannot read --file ${opts.file}: ${msg}`);
    }
  }
  if (allowEmpty) return undefined;
  die('Missing content: use --content "..." or --file path');
}

export type DeliverableDTO = TicketDeliverable;
