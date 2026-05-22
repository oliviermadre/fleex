import { readFileSync } from 'node:fs';
import {
  DELIVERABLE_TYPES,
  DELIVERABLE_STATUSES,
  isDeliverableType,
  isDeliverableStatus,
} from '@fleex/shared';
import type { DeliverableType, DeliverableStatus, TicketDeliverable } from '@fleex/shared';
import { die } from '../../../core/colors.ts';

export function assertValidType(t: string): asserts t is DeliverableType {
  if (!isDeliverableType(t)) {
    die(`Invalid type: ${t} (valid: ${DELIVERABLE_TYPES.join(', ')})`);
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
