import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';
import { StepRunEntity } from '../../domain/entities/step-run.entity.js';
import type { StepRunStorePort } from '../../application/ports/step-run-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedStepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  attempt: number;
  status: StepRunStatus;
  result: StepRunResult | null;
  output: StepOutput | null;
  nextEdgeId: string | null;
  executionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export class JsonStepRunStore implements StepRunStorePort {
  private readonly stepRuns = new Map<string, StepRunEntity>();
  private readonly filePath: string;
  private initialized = false;
  /** See JsonWorkflowRunStore — writes go over HTTP, so they must be serialized. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'step-runs.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getById(id: string): Promise<StepRunEntity | null> {
    return this.stepRuns.get(id) ?? null;
  }

  async getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]> {
    return Array.from(this.stepRuns.values())
      .filter((sr) => sr.workflowRunId === workflowRunId)
      .sort(byCreatedAtThenAttempt);
  }

  async getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null> {
    const matches = Array.from(this.stepRuns.values())
      .filter((sr) => sr.workflowRunId === workflowRunId && sr.stepId === stepId)
      .sort((a, b) => b.attempt - a.attempt);
    return matches[0] ?? null;
  }

  async getAll(): Promise<StepRunEntity[]> {
    return Array.from(this.stepRuns.values()).sort(byCreatedAtThenAttempt);
  }

  async save(stepRun: StepRunEntity): Promise<void> {
    this.stepRuns.set(stepRun.id, stepRun);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedStepRun[];
      for (const sr of data) {
        this.stepRuns.set(sr.id, new StepRunEntity(
          sr.id, sr.workflowRunId, sr.stepId, sr.attempt, sr.status,
          sr.result ?? null, sr.output ?? null, sr.nextEdgeId ?? null,
          sr.executionId ?? null,
          sr.startedAt ? new Date(sr.startedAt) : null,
          sr.completedAt ? new Date(sr.completedAt) : null,
          new Date(sr.createdAt),
        ));
      }
      this.logger.info('Step run store loaded', { count: this.stepRuns.size });
    } catch (err) {
      this.logger.warn('Failed to load step runs from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private syncToDisk(): Promise<void> {
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.doWrite());
    return this.writeChain;
  }

  private async doWrite(): Promise<void> {
    try {
      const data: SerializedStepRun[] = Array.from(this.stepRuns.values()).map((sr) => ({
        id: sr.id, workflowRunId: sr.workflowRunId, stepId: sr.stepId,
        attempt: sr.attempt, status: sr.status, result: sr.result, output: sr.output,
        nextEdgeId: sr.nextEdgeId, executionId: sr.executionId,
        startedAt: sr.startedAt?.toISOString() ?? null,
        completedAt: sr.completedAt?.toISOString() ?? null,
        createdAt: sr.createdAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync step runs to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function byCreatedAtThenAttempt(a: StepRunEntity, b: StepRunEntity): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime();
  return delta !== 0 ? delta : a.attempt - b.attempt;
}
