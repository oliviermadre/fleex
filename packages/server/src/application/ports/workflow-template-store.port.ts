import type { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';

export interface WorkflowTemplateStorePort {
  getAll(): Promise<WorkflowTemplateEntity[]>;
  getById(id: string): Promise<WorkflowTemplateEntity | null>;
  getBySlug(slug: string): Promise<WorkflowTemplateEntity | null>;
  getEnabled(): Promise<WorkflowTemplateEntity[]>;
  save(template: WorkflowTemplateEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
