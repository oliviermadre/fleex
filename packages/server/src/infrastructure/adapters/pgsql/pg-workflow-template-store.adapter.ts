import { WorkflowTemplateEntity } from '../../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../../application/ports/workflow-template-store.port.js';
import type { PgConnection } from './connection.js';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';
import { readJson } from './pg-json.js';

export class PgWorkflowTemplateStore implements WorkflowTemplateStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<WorkflowTemplateEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates ORDER BY name ASC');
    return rows.map(rowToEntity);
  }

  async getById(id: string): Promise<WorkflowTemplateEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates WHERE id = $1', [id]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<WorkflowTemplateEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates WHERE slug = $1', [slug]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getEnabled(): Promise<WorkflowTemplateEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates WHERE enabled = TRUE ORDER BY name ASC');
    return rows.map(rowToEntity);
  }

  /**
   * Upsert in place, never delete-then-insert: `routines.template_id` carries an
   * ON DELETE CASCADE, so replacing the row would destroy every routine bound to
   * this template the moment someone edits it in the builder.
   */
  async save(t: WorkflowTemplateEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_templates
         (id, name, slug, emoji, description, steps, edges, entry_step_id, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         name = $2,
         slug = $3,
         emoji = $4,
         description = $5,
         steps = $6,
         edges = $7,
         entry_step_id = $8,
         enabled = $9,
         created_at = $10,
         updated_at = $11`,
      [
        t.id,
        t.name,
        t.slug,
        t.emoji,
        t.description,
        JSON.stringify(t.steps),
        JSON.stringify(t.edges),
        t.entryStepId,
        t.enabled,
        t.createdAt.toISOString(),
        t.updatedAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM workflow_templates WHERE id = $1', [id]);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntity(r: any): WorkflowTemplateEntity {
  return new WorkflowTemplateEntity(
    r.id,
    r.name,
    r.slug,
    r.emoji,
    r.description,
    readJson<WorkflowStep[]>(r.steps) ?? [],
    readJson<WorkflowEdge[]>(r.edges) ?? [],
    r.entry_step_id,
    Boolean(r.enabled),
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}
