import { readFileSync } from 'node:fs';
import { die } from '../../../core/colors.ts';

export const VALID_DELIVERABLE_TYPES = [
  'prd',
  'spec',
  'plan',
  'code',
  'report',
  'url',
  'html',
  'ticket-summary',
] as const;

export const VALID_DELIVERABLE_STATUSES = ['draft', 'final'] as const;

export function assertValidType(t: string): void {
  if (!VALID_DELIVERABLE_TYPES.includes(t as typeof VALID_DELIVERABLE_TYPES[number])) {
    die(`Invalid type: ${t} (valid: ${VALID_DELIVERABLE_TYPES.join(', ')})`);
  }
}

export function assertValidStatus(s: string): void {
  if (!VALID_DELIVERABLE_STATUSES.includes(s as typeof VALID_DELIVERABLE_STATUSES[number])) {
    die(`Invalid status: ${s} (valid: ${VALID_DELIVERABLE_STATUSES.join(', ')})`);
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

export interface DeliverableDTO {
  id: string;
  ticketId: string;
  agentName: string;
  type: string;
  title: string;
  content: string;
  version: number;
  status: 'draft' | 'final';
  createdAt: string;
  updatedAt: string;
}
