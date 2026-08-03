import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';

import { WorkflowTemplateEntity } from '../../../domain/entities/workflow-template.entity.js';

import type { SupabaseConnection } from './connection.js';
import type { WorkflowTemplateStorePort } from '../../../application/ports/workflow-template-store.port.js';

interface WorkflowTemplateRow {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entry_step_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: WorkflowTemplateRow): WorkflowTemplateEntity {
  return new WorkflowTemplateEntity(
    r.id,
    r.name,
    r.slug,
    r.emoji,
    r.description,
    r.steps,
    r.edges,
    r.entry_step_id,
    r.enabled,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabaseWorkflowTemplateStore implements WorkflowTemplateStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getAll(): Promise<WorkflowTemplateEntity[]> {
    const { data, error } = await this.conn.client
      .from('workflow_templates')
      .select('*')
      .order('name');
    if (error) throw new Error(`SupabaseWorkflowTemplateStore.getAll failed: ${error.message}`);
    return (data as WorkflowTemplateRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<WorkflowTemplateEntity | null> {
    const { data, error } = await this.conn.client
      .from('workflow_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseWorkflowTemplateStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as WorkflowTemplateRow) : null;
  }

  async getBySlug(slug: string): Promise<WorkflowTemplateEntity | null> {
    const { data, error } = await this.conn.client
      .from('workflow_templates')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw new Error(`SupabaseWorkflowTemplateStore.getBySlug failed: ${error.message}`);
    return data ? rowToEntity(data as WorkflowTemplateRow) : null;
  }

  async getEnabled(): Promise<WorkflowTemplateEntity[]> {
    const { data, error } = await this.conn.client
      .from('workflow_templates')
      .select('*')
      .eq('enabled', true)
      .order('name');
    if (error) throw new Error(`SupabaseWorkflowTemplateStore.getEnabled failed: ${error.message}`);
    return (data as WorkflowTemplateRow[]).map(rowToEntity);
  }

  async save(template: WorkflowTemplateEntity): Promise<void> {
    const { error } = await this.conn.client.from('workflow_templates').upsert({
      id: template.id,
      name: template.name,
      slug: template.slug,
      emoji: template.emoji,
      description: template.description,
      steps: template.steps,
      edges: template.edges,
      entry_step_id: template.entryStepId,
      enabled: template.enabled,
      created_at: template.createdAt.toISOString(),
      updated_at: template.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseWorkflowTemplateStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.from('workflow_templates').delete().eq('id', id);
    if (error) throw new Error(`SupabaseWorkflowTemplateStore.remove failed: ${error.message}`);
  }
}
