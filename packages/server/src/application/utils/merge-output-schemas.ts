import { DELIVERABLE_TYPES, DELIVERABLE_STATUSES, DEFAULT_DELIVERABLE_TYPES } from '@fleex/shared';
import type { JsonSchema } from '@fleex/shared';

/**
 * Build the structured-output JSON schema with the workspace's configured
 * deliverable type ids constraining `deliverable.type`. Pass the agent-selectable
 * type ids (system types excluded).
 */
export function buildStandardOutputSchema(typeIds: string[]) {
  // Guard against an empty enum (invalid JSON schema) by falling back to the
  // default preset's non-system types.
  const types =
    typeIds.length > 0
      ? typeIds
      : DEFAULT_DELIVERABLE_TYPES.filter((t) => !t.system).map((t) => t.id);
  return {
    type: 'json_schema' as const,
    schema: {
      type: 'object' as const,
      properties: {
        deliverable: {
          oneOf: [
            {
              type: 'object',
              properties: {
                title: { type: 'string' },
                markdown: { type: 'string' },
                type: { type: 'string', enum: types },
                status: { type: 'string', enum: [...DELIVERABLE_STATUSES] },
              },
              required: ['title', 'markdown', 'type', 'status'],
            },
            { type: 'null' },
          ],
        },
        comment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        mentionStatus: {
          type: 'string',
          enum: ['resolved', 'waiting_for_info'],
          default: 'resolved',
        },
      },
      required: ['deliverable', 'comment'],
    },
  };
}

/**
 * Default schema built from the legacy preset. Retained for the type annotation
 * (`typeof STANDARD_OUTPUT_SCHEMA`) used across the agent execution code and as a
 * fallback. Runtime executions build the schema from configured types.
 */
export const STANDARD_OUTPUT_SCHEMA = buildStandardOutputSchema([...DELIVERABLE_TYPES]);

export function mergeOutputSchemas(
  standard: typeof STANDARD_OUTPUT_SCHEMA,
  custom: JsonSchema | undefined,
): typeof STANDARD_OUTPUT_SCHEMA {
  if (!custom) return standard;
  return {
    type: standard.type,
    schema: {
      type: 'object',
      properties: { ...standard.schema.properties, ...custom.properties },
      required: Array.from(
        new Set([...(standard.schema.required ?? []), ...(custom.required ?? [])]),
      ),
    },
  } as typeof STANDARD_OUTPUT_SCHEMA;
}
