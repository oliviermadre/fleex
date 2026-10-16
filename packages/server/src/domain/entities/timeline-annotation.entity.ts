import type { AnnotationTone, TimelineAnnotation } from '@fleex/shared';
import { ANNOTATION_BODY_MAX, ANNOTATION_TITLE_MAX, isAnnotationTone, sanitizeForStorage } from '@fleex/shared';
import { InvalidAnnotationError } from '../errors.js';

/** What may change on an existing annotation (all optional). */
export interface AnnotationPatch {
  at?: string;
  title?: string;
  body?: string;
  tone?: string;
}

/**
 * A piece of information pinned to an instant of the ticket's Timeline.
 *
 * Invariants (enforced on create and on every update):
 * - title: trimmed, 1..80 chars — it is always rendered on the card, so empty
 *   or a paragraph would break the "readable at a glance" promise;
 * - body: ≤ 4000 chars of markdown;
 * - at: a valid instant, never before the ticket existed (there is no frieze
 *   there), and clamped to now if in the future (the frieze ends at now).
 */
export class TimelineAnnotationEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public at: Date,
    public title: string,
    public body: string,
    public tone: AnnotationTone,
    public sourceCommentId: string | null,
    public readonly authorType: 'user' | 'agent',
    public readonly authorName: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    ticketCreatedAt: Date;
    at: string;
    title: string;
    body?: string;
    tone?: string;
    sourceCommentId?: string | null;
    authorType: 'user' | 'agent';
    authorName: string;
    now?: Date;
  }): TimelineAnnotationEntity {
    const now = params.now ?? new Date();
    return new TimelineAnnotationEntity(
      params.id,
      params.ticketId,
      resolveAt(params.at, params.ticketCreatedAt, now),
      validTitle(params.title),
      validBody(params.body ?? ''),
      validTone(params.tone ?? 'info'),
      params.sourceCommentId ?? null,
      params.authorType,
      params.authorName,
      now,
      now,
    );
  }

  update(patch: AnnotationPatch, ticketCreatedAt: Date, now = new Date()): void {
    // Validate everything before mutating anything: a bad field rejects the whole patch.
    const at = patch.at !== undefined ? resolveAt(patch.at, ticketCreatedAt, now) : this.at;
    const title = patch.title !== undefined ? validTitle(patch.title) : this.title;
    const body = patch.body !== undefined ? validBody(patch.body) : this.body;
    const tone = patch.tone !== undefined ? validTone(patch.tone) : this.tone;
    this.at = at;
    this.title = title;
    this.body = body;
    this.tone = tone;
    this.updatedAt = now;
  }

  toDTO(): TimelineAnnotation {
    return {
      id: this.id,
      ticketId: this.ticketId,
      at: this.at.toISOString(),
      title: this.title,
      body: this.body,
      tone: this.tone,
      sourceCommentId: this.sourceCommentId,
      authorType: this.authorType,
      authorName: this.authorName,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}

/**
 * Default title for a comment promoted to the Timeline: its first meaningful
 * line, markdown stripped, cut to the title limit.
 */
export function titleFromCommentBody(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>~]/g, '').trim())
    .find((l) => l.length > 0) ?? '';
  return line.length > ANNOTATION_TITLE_MAX ? `${line.slice(0, ANNOTATION_TITLE_MAX - 1)}…` : line;
}

function validTitle(raw: string): string {
  const title = sanitizeForStorage(String(raw ?? '')).trim();
  if (title.length === 0) throw new InvalidAnnotationError('Annotation title is required');
  if (title.length > ANNOTATION_TITLE_MAX) {
    throw new InvalidAnnotationError(`Annotation title must be at most ${ANNOTATION_TITLE_MAX} characters`);
  }
  return title;
}

function validBody(raw: string): string {
  const body = sanitizeForStorage(String(raw ?? ''));
  if (body.length > ANNOTATION_BODY_MAX) {
    throw new InvalidAnnotationError(`Annotation body must be at most ${ANNOTATION_BODY_MAX} characters`);
  }
  return body;
}

function validTone(raw: string): AnnotationTone {
  if (!isAnnotationTone(raw)) throw new InvalidAnnotationError(`Invalid annotation tone: ${raw}`);
  return raw;
}

function resolveAt(raw: string, ticketCreatedAt: Date, now: Date): Date {
  const at = raw === 'now' ? now : new Date(raw);
  if (Number.isNaN(at.getTime())) throw new InvalidAnnotationError(`Invalid annotation instant: ${raw}`);
  if (at.getTime() < ticketCreatedAt.getTime()) {
    throw new InvalidAnnotationError('An annotation cannot be placed before the ticket was created');
  }
  return at.getTime() > now.getTime() ? now : at;
}
