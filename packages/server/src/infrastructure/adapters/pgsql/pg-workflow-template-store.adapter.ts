import { WorkflowTemplateEntity } from '../../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../../application/ports/workflow-template-store.port.js';
import type { PgConnection } from './connection.js';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';

export class PgWorkflowTemplateStore implements WorkflowTemplateStorePort {
  constructor(private readonly db: PgConnection) {}

  async getAll(): Promise<WorkflowTemplateEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates ORDER BY name ASC');
    return rows.map(rowToTemplate);
  }

  async getById(id: string): Promise<WorkflowTemplateEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates WHERE id = $1', [id]);
    return rows.length > 0 ? rowToTemplate(rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<WorkflowTemplateEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM workflow_templates WHERE slug = $1', [slug]);
    return rows.length > 0 ? rowToTemplate(rows[0]) : null;
  }

  async getEnabled(): Promise<WorkflowTemplateEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM workflow_templates WHERE enabled = TRUE ORDER BY name ASC',
    );
    return rows.map(rowToTemplate);
  }

  async save(t: WorkflowTemplateEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_templates (
        id, name, slug, emoji, description, steps, edges, entry_step_id, enabled, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        name = $2, slug = $3, emoji = $4, description = $5, steps = $6, edges = $7,
        entry_step_id = $8, enabled = $9, created_at = $10, updated_at = $11`,
      [
        t.id,
        t.name,
        t.slug,
        t.emoji,
        t.description,
        // Always stringify: node-pg serializes a raw JS array as a Postgres array
        // literal, which is not valid JSONB.
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

function rowToTemplate(row: Record<string, unknown>): WorkflowTemplateEntity {
  return new WorkflowTemplateEntity(
    row.id as string,
    row.name as string,
    row.slug as string,
    (row.emoji as string) ?? '',
    (row.description as string) ?? '',
    parseJsonColumn<WorkflowStep[]>(row.steps, []),
    parseJsonColumn<WorkflowEdge[]>(row.edges, []),
    row.entry_step_id as string,
    row.enabled as boolean,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}

/**
 * node-pg already parses JSONB columns into JS values — unlike SQLite, where the
 * column is TEXT and must be JSON.parse'd. Handle both so the adapter survives a
 * column that was written as TEXT by an older instance.
 */
function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
