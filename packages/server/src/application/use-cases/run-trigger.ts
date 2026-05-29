import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TriggerRunEntity } from '../../domain/entities/trigger-run.entity.js';
import { buildTriggerWorkspaceId } from '../../domain/services/branch-utils.js';
import { STANDARD_OUTPUT_SCHEMA } from '../utils/merge-output-schemas.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { TriggerEntity } from '../../domain/entities/trigger.entity.js';
import type { TriggerRunStorePort } from '../ports/trigger-run-store.port.js';
import type { TriggerStorePort } from '../ports/trigger-store.port.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { CreateWorkflowRunUseCase } from './create-workflow-run.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import type { EventBus } from '../event-bus.js';
import type { LoggerPort } from '../ports/logger.port.js';

export interface RunTriggerDeps {
  triggerStore: TriggerStorePort;
  triggerRunStore: TriggerRunStorePort;
  resolver: RepoPathResolver;
  workflowTemplateStore: WorkflowTemplateStorePort | null;
  createWorkflowRun: CreateWorkflowRunUseCase | null;
  executeAgent: ExecuteAgentUseCase;
  eventBus: EventBus;
  logger: LoggerPort;
}

/**
 * Execute a single firing of a trigger: provision an isolated run workspace,
 * launch the target primitive (ticketless), and record the outcome as a
 * trigger_run. The trigger's descriptionMd is the "mission" surfaced to the
 * launched run.
 *
 * v1 supports `workflow` and `agent` targets. `skill`/`panel` targets are
 * rejected with a clear error until those execution paths are made
 * ticket-optional (they currently require a ticket).
 */
export class RunTriggerUseCase {
  constructor(private readonly deps: RunTriggerDeps) {}

  async execute(params: { trigger: TriggerEntity; scheduledFor: Date }): Promise<TriggerRunEntity> {
    const { trigger, scheduledFor } = params;
    const run = TriggerRunEntity.create({ id: randomUUID(), triggerId: trigger.id, scheduledFor });

    // Provision an isolated workspace for this run (best-effort: a failure here
    // is logged but doesn't abort the launch — many targets need no filesystem).
    try {
      run.workspacePath = this.provisionWorkspace(trigger, run.id);
    } catch (err) {
      this.deps.logger.warn('Failed to provision trigger run workspace', {
        triggerId: trigger.id, runId: run.id, error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.deps.triggerRunStore.save(run);
    this.deps.eventBus.emit({
      type: 'trigger.run_started', triggerId: trigger.id, triggerRunId: run.id, occurredAt: new Date(),
    });

    try {
      if (trigger.targetType === 'workflow') {
        if (!this.deps.createWorkflowRun || !this.deps.workflowTemplateStore) {
          throw new Error('workflow execution is not available on this storage backend');
        }
        const template = (await this.deps.workflowTemplateStore.getById(trigger.targetRef))
          ?? (await this.deps.workflowTemplateStore.getBySlug(trigger.targetRef));
        if (!template) throw new Error(`workflow template "${trigger.targetRef}" not found`);
        const wfRun = await this.deps.createWorkflowRun.execute({
          ticketId: null,
          templateId: template.id,
          triggeredBy: `trigger:${trigger.slug}`,
          triggeredFrom: 'trigger',
        });
        run.complete({ workflowRunId: wfRun.id });
      } else if (trigger.targetType === 'agent') {
        const res = await this.deps.executeAgent.executeForWorkflowStep({
          personaName: trigger.targetRef,
          ticketId: null,
          outputFormat: STANDARD_OUTPUT_SCHEMA,
          workflowContextPrompt: this.missionPrompt(trigger),
          mode: trigger.mode,
        });
        run.complete({ executionId: res.executionId });
      } else {
        throw new Error(`trigger target type "${trigger.targetType}" is not supported yet (use 'workflow' or 'agent')`);
      }
      trigger.lastStatus = 'completed';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      run.fail(msg);
      trigger.lastStatus = 'failed';
      this.deps.logger.error('Trigger run failed', { triggerId: trigger.id, runId: run.id, error: msg });
    }

    trigger.lastRunAt = new Date();
    trigger.updatedAt = new Date();
    await this.deps.triggerRunStore.save(run);
    await this.deps.triggerStore.save(trigger);
    this.deps.eventBus.emit({
      type: 'trigger.run_completed', triggerId: trigger.id, triggerRunId: run.id,
      status: run.status, occurredAt: new Date(),
    });
    return run;
  }

  /** A fresh isolated directory + `.fleex.json` manifest for this run. */
  private provisionWorkspace(trigger: TriggerEntity, runId: string): string {
    const workspaceId = buildTriggerWorkspaceId(trigger.slug, runId);
    const root = this.deps.resolver.workspacePath(workspaceId);
    mkdirSync(root, { recursive: true });
    const manifestPath = join(root, '.fleex.json');
    if (!existsSync(manifestPath)) {
      writeFileSync(manifestPath, JSON.stringify(
        { kind: 'trigger', runId, triggerId: trigger.id, triggerSlug: trigger.slug }, null, 2,
      ));
    }
    return root;
  }

  private missionPrompt(trigger: TriggerEntity): string {
    const parts: string[] = [`# Trigger: ${trigger.name}`];
    if (trigger.descriptionMd.trim()) {
      parts.push(trigger.descriptionMd);
    } else if (trigger.description.trim()) {
      parts.push(trigger.description);
    } else {
      parts.push('Run the configured task.');
    }
    return parts.join('\n\n');
  }
}
