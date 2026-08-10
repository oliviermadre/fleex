import type { WorkflowStep, JsonSchema, JsonSchemaProperty } from '../types/workflow.js';

/**
 * Meta fields a `trigger` step always publishes, declared or not. They come
 * from the run itself — never from the payload, whose identically named keys
 * are overwritten (a webhook sender must not be able to spoof `firedVia`).
 */
export const TRIGGER_STEP_META_PROPERTIES: Record<string, JsonSchemaProperty> = {
  previousRunAt: {
    type: 'string',
    description: "Start of the routine's previous run — empty on the first run and in ticket runs.",
  },
  firedVia: {
    type: 'string',
    description: 'How the run started: schedule, webhook, routine, api, workflow, mention:*.',
  },
  firedAt: {
    type: 'string',
    description: 'When this run started.',
  },
};

/**
 * The output schema a step effectively produces.
 *
 * For every executor type this is the author-declared `outputSchema`; a
 * trigger step additionally publishes its meta fields, so the reference
 * validator, the pickers and the edge suggestions must see those as declared —
 * otherwise `{{ steps.<trigger>.previousRunAt }}` would be refused on a step
 * with no declared payload shape.
 */
export function effectiveOutputSchema(step: WorkflowStep): JsonSchema | undefined {
  if (step.executorType !== 'trigger') return step.outputSchema;
  return {
    type: 'object',
    properties: { ...(step.outputSchema?.properties ?? {}), ...TRIGGER_STEP_META_PROPERTIES },
    ...(step.outputSchema?.required ? { required: step.outputSchema.required } : {}),
  };
}
