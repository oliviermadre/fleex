import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot } from '@fleex/shared';

import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';

import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { HostFs } from '../host/types.js';

const ACTIVE_STATUSES: WorkflowRunStatus[] = ['running', 'needs_review'];

interface SerializedRun {
  id: string;
  ticketId: string;
  templateId: string;
  templateSnapshot: WorkflowTemplateSnapshot;
  status: WorkflowRunStatus;
  currentStepId: string | null;
  triggeredBy: string;
  triggeredFrom: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * JSON-file workflow run store.
 *
 * Divergence from the SQL drivers: there is no ON DELETE CASCADE here, so deleting
 * a ticket leaves its workflow runs (and their step runs) orphaned — they still show
 * up in the Execution Log. This matches the driver's pre-existing behaviour for
 * comments and deliverables and is accepted as-is.
 */
export class JsonWorkflowRunStore implements WorkflowRunStorePort {
  private readonly runs = new Map<string, WorkflowRunEntity>();
  private readonly filePath: string;
  private initialized = false;
  /**
   * hostFs.writeFile is an HTTP RPC to the host-gateway, not a local write. The
   * orchestrator saves a run on every step transition, so concurrent syncs could
   * interleave over the network and clobber each other. Chain them instead.
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'workflow-runs.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getById(id: string): Promise<WorkflowRunEntity | null> {
    return this.runs.get(id) ?? null;
  }

  async getByTicket(ticketId: string): Promise<WorkflowRunEntity[]> {
    return Array.from(this.runs.values())
      .filter((r) => r.ticketId === ticketId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null> {
    for (const r of this.runs.values()) {
      if (r.ticketId === ticketId && ACTIVE_STATUSES.includes(r.status)) return r;
    }
    return null;
  }

  async getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]> {
    return Array.from(this.runs.values()).filter((r) => r.status === status);
  }

  async getAll(): Promise<WorkflowRunEntity[]> {
    return Array.from(this.runs.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    );
  }

  async save(run: WorkflowRunEntity): Promise<void> {
    this.runs.set(run.id, run);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedRun[];
      for (const r of data) {
        this.runs.set(
          r.id,
          new WorkflowRunEntity(
            r.id,
            r.ticketId,
            r.templateId,
            r.templateSnapshot,
            r.status,
            r.currentStepId ?? null,
            r.triggeredBy,
            r.triggeredFrom,
            new Date(r.startedAt),
            r.completedAt ? new Date(r.completedAt) : null,
            new Date(r.createdAt),
            new Date(r.updatedAt),
          ),
        );
      }
      this.logger.info('Workflow run store loaded', { count: this.runs.size });
    } catch (err) {
      this.logger.warn('Failed to load workflow runs from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private syncToDisk(): Promise<void> {
    // A failed write must not wedge the chain for every subsequent save.
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.doWrite());
    return this.writeChain;
  }

  private async doWrite(): Promise<void> {
    try {
      const data: SerializedRun[] = Array.from(this.runs.values()).map((r) => ({
        id: r.id,
        ticketId: r.ticketId,
        templateId: r.templateId,
        templateSnapshot: r.templateSnapshot,
        status: r.status,
        currentStepId: r.currentStepId,
        triggeredBy: r.triggeredBy,
        triggeredFrom: r.triggeredFrom,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync workflow runs to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
