import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';

import { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';

import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedTemplate {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class JsonWorkflowTemplateStore implements WorkflowTemplateStorePort {
  private readonly templates = new Map<string, WorkflowTemplateEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'workflow-templates.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getAll(): Promise<WorkflowTemplateEntity[]> {
    return Array.from(this.templates.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<WorkflowTemplateEntity | null> {
    return this.templates.get(id) ?? null;
  }

  async getBySlug(slug: string): Promise<WorkflowTemplateEntity | null> {
    for (const t of this.templates.values()) {
      if (t.slug === slug) return t;
    }
    return null;
  }

  async getEnabled(): Promise<WorkflowTemplateEntity[]> {
    return Array.from(this.templates.values())
      .filter((t) => t.enabled)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(template: WorkflowTemplateEntity): Promise<void> {
    this.templates.set(template.id, template);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.templates.delete(id);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedTemplate[];
      for (const t of data) {
        this.templates.set(
          t.id,
          new WorkflowTemplateEntity(
            t.id,
            t.name,
            t.slug,
            t.emoji ?? '',
            t.description ?? '',
            t.steps ?? [],
            t.edges ?? [],
            t.entryStepId,
            t.enabled,
            new Date(t.createdAt),
            new Date(t.updatedAt),
          ),
        );
      }
      this.logger.info('Workflow template store loaded', { count: this.templates.size });
    } catch (err) {
      this.logger.warn('Failed to load workflow templates from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedTemplate[] = Array.from(this.templates.values()).map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        emoji: t.emoji,
        description: t.description,
        steps: t.steps,
        edges: t.edges,
        entryStepId: t.entryStepId,
        enabled: t.enabled,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync workflow templates to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
