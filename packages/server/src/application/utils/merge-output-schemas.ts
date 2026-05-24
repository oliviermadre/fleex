import { DELIVERABLE_TYPES, DELIVERABLE_STATUSES } from '@fleex/shared';
import type { JsonSchema } from '@fleex/shared';

export const STANDARD_OUTPUT_SCHEMA = {
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
              type: { type: 'string', enum: [...DELIVERABLE_TYPES] },
              status: { type: 'string', enum: [...DELIVERABLE_STATUSES] },
            },
            required: ['title', 'markdown', 'type', 'status'],
          },
          { type: 'null' },
        ],
      },
      comment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      mentionStatus: { type: 'string', enum: ['resolved', 'waiting_for_info'], default: 'resolved' },
    },
    required: ['deliverable', 'comment'],
  },
};

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
      required: [...(standard.schema.required ?? []), ...(custom.required ?? [])],
    },
  } as typeof STANDARD_OUTPUT_SCHEMA;
}
