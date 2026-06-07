import type { StatusModel } from '@fleex/shared';

/**
 * Persistence for the kanban status model (the ordered set of columns and their
 * semantic roles — see @fleex/shared status-model). A single global model for
 * now; per-board models are a later concern (PR5).
 */
export interface StatusModelStorePort {
  /**
   * The persisted model, or `null` when none has been configured yet — callers
   * then fall back to DEFAULT_STATUS_MODEL.
   */
  getModel(): Promise<StatusModel | null>;

  /** Replace the full set of columns atomically. */
  saveModel(model: StatusModel): Promise<void>;
}
