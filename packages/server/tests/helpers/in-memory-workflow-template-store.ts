import type { WorkflowTemplateStorePort } from '../../src/application/ports/workflow-template-store.port.js';
import type { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';

/**
 * Stands in for the sqlite/supabase template store so the
 * `/api/workflows/templates` routes get registered under the json driver.
 */
export class InMemoryWorkflowTemplateStore implements WorkflowTemplateStorePort {
  private readonly byId = new Map<string, WorkflowTemplateEntity>();

  async getAll(): Promise<WorkflowTemplateEntity[]> {
    return [...this.byId.values()];
  }

  async getById(id: string): Promise<WorkflowTemplateEntity | null> {
    return this.byId.get(id) ?? null;
  }

  async getBySlug(slug: string): Promise<WorkflowTemplateEntity | null> {
    for (const t of this.byId.values()) {
      if (t.slug === slug) return t;
    }
    return null;
  }

  async getEnabled(): Promise<WorkflowTemplateEntity[]> {
    return [...this.byId.values()].filter((t) => t.enabled);
  }

  async save(template: WorkflowTemplateEntity): Promise<void> {
    this.byId.set(template.id, template);
  }

  async remove(id: string): Promise<void> {
    this.byId.delete(id);
  }
}
