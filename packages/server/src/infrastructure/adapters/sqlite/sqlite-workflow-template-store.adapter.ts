import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';

import { WorkflowTemplateEntity } from '../../../domain/entities/workflow-template.entity.js';

import type { SqliteConnection } from './connection.js';
import type { WorkflowTemplateStorePort } from '../../../application/ports/workflow-template-store.port.js';

interface Row {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: string;
  edges: string;
  entry_step_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class SqliteWorkflowTemplateStoreAdapter implements WorkflowTemplateStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll(): Promise<WorkflowTemplateEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM workflow_templates ORDER BY name ASC')
      .all() as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<WorkflowTemplateEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as
      Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async getBySlug(slug: string): Promise<WorkflowTemplateEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM workflow_templates WHERE slug = ?').get(slug) as
      Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async getEnabled(): Promise<WorkflowTemplateEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM workflow_templates WHERE enabled = 1 ORDER BY name ASC')
      .all() as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(t: WorkflowTemplateEntity): Promise<void> {
    this.conn.db
      .prepare(
        `
      INSERT OR REPLACE INTO workflow_templates
        (id, name, slug, emoji, description, steps, edges, entry_step_id, enabled, created_at, updated_at)
      VALUES
        (@id, @name, @slug, @emoji, @description, @steps, @edges, @entry_step_id, @enabled, @created_at, @updated_at)
    `,
      )
      .run({
        id: t.id,
        name: t.name,
        slug: t.slug,
        emoji: t.emoji,
        description: t.description,
        steps: JSON.stringify(t.steps),
        edges: JSON.stringify(t.edges),
        entry_step_id: t.entryStepId,
        enabled: t.enabled ? 1 : 0,
        created_at: t.createdAt.toISOString(),
        updated_at: t.updatedAt.toISOString(),
      });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM workflow_templates WHERE id = ?').run(id);
  }

  private toEntity(r: Row): WorkflowTemplateEntity {
    return new WorkflowTemplateEntity(
      r.id,
      r.name,
      r.slug,
      r.emoji,
      r.description,
      JSON.parse(r.steps) as WorkflowStep[],
      JSON.parse(r.edges) as WorkflowEdge[],
      r.entry_step_id,
      r.enabled === 1,
      new Date(r.created_at),
      new Date(r.updated_at),
    );
  }
}
