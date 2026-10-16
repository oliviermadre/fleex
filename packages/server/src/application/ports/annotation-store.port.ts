import type { TimelineAnnotationEntity } from '../../domain/entities/timeline-annotation.entity.js';

export interface AnnotationStorePort {
  /** A ticket's annotations, oldest instant first. */
  listByTicket(ticketId: string): Promise<TimelineAnnotationEntity[]>;
  getById(id: string): Promise<TimelineAnnotationEntity | null>;
  /** The annotation promoted from this comment, if any (at most one). */
  getBySourceComment(commentId: string): Promise<TimelineAnnotationEntity | null>;
  save(annotation: TimelineAnnotationEntity): Promise<void>;
  remove(id: string): Promise<void>;
  /** The source comment is gone: keep the annotation, drop the link. */
  clearSourceComment(commentId: string): Promise<void>;
}
