import type { JsonSchema, WorkflowEdgeCondition, WorkflowEdgeConditionGroup } from '@fleex/shared';
import { formatEdgeCondition, normalizeEdgeCondition } from '@fleex/shared';
import { formatRunHistory, type RunHistoryEntry } from './run-history.js';

export interface WorkflowContextInput {
  workflowName: string;
  stepName: string;
  stepPrompt?: string;
  outputSchema: JsonSchema | undefined;
  outgoingEdges: {
    id: string;
    label?: string;
    condition?: WorkflowEdgeCondition;
    conditionGroup?: WorkflowEdgeConditionGroup;
    targetName: string;
  }[];
  previousOutputs: Record<string, Record<string, unknown>>;
  /**
   * The run's narrative so far. When present it *replaces* the raw
   * `previousOutputs` dump: it says the same thing by step name, and adds the
   * comments, deliverables, gate decisions and human answers that the
   * schemaFields-only dump silently drops.
   */
  runHistory?: RunHistoryEntry[];
  /** Step id → name, so a condition on an earlier step names it readably. */
  stepNames?: Record<string, string>;
}

export function composeWorkflowContextPrompt(input: WorkflowContextInput): string {
  const parts: string[] = [];

  parts.push(`## Workflow Context`);
  parts.push('');
  parts.push(`You are executing step **${input.stepName}** of workflow **${input.workflowName}**.`);
  parts.push('');

  if (input.stepPrompt && input.stepPrompt.trim()) {
    parts.push(input.stepPrompt.trim());
    parts.push('');
  }

  if (input.outputSchema && Object.keys(input.outputSchema.properties).length > 0) {
    parts.push(`**Expected output fields** (in addition to the standard \`deliverable\`/\`comment\`/\`mentionStatus\`):`);
    for (const [name, prop] of Object.entries(input.outputSchema.properties)) {
      const enumPart = prop.enum ? ` (enum: ${prop.enum.join(', ')})` : '';
      const descPart = prop.description ? ` — ${prop.description}` : '';
      parts.push(`- \`${name}\`${enumPart}${descPart}`);
    }
    parts.push('');
  }

  if (input.outgoingEdges.length === 0) {
    parts.push('This is a **terminal step** — the workflow will complete after your output.');
  } else {
    parts.push(`**Branching from this step**:`);
    const steps = Object.entries(input.stepNames ?? {}).map(([id, name]) => ({ id, name }));
    for (const e of input.outgoingEdges) {
      // Both formats go through the shared normalizer, so a legacy
      // single-condition edge and a multi-clause one read the same way.
      const group = normalizeEdgeCondition({ id: e.id, source: '', target: '', isDefault: false, condition: e.condition, conditionGroup: e.conditionGroup });
      const suffix = `→ next step: **${e.targetName}**${e.label ? ` (${e.label})` : ''}`;
      if (group) {
        parts.push(`- If ${formatEdgeCondition(group, steps)} ${suffix}`);
      } else {
        parts.push(`- Default ${suffix}`);
      }
    }
  }
  parts.push('');

  // Reinforce the waiting_for_info contract in the workflow context. In a
  // workflow step there's no inline conversation with the user during the run,
  // so it's especially easy for the agent to misuse `comment` as a meta status
  // report ("I asked X about Y") instead of the actual question. The standard
  // mentionStatus instruction covers this, but doubling down here is cheap.
  parts.push(`**If you need human input to continue this workflow**: set \`mentionStatus: "waiting_for_info"\` and put your actual question(s) in \`comment\`. The workflow will pause and a side panel will prompt the user to respond. Their answer is recorded in this run's history and this step retries automatically with that new context. Write the question directly ("Should we use option A or B?"), as if chatting — do NOT narrate ("I posed a question to @someone", "Awaiting reply"); only what you write in \`comment\` reaches the reader.`);
  parts.push('');

  const history = input.runHistory ? formatRunHistory(input.runHistory) : '';
  if (history) {
    parts.push(history);
    parts.push('');
    return parts.join('\n');
  }

  const prevKeys = Object.keys(input.previousOutputs);
  if (prevKeys.length > 0) {
    parts.push(`**Previous step outputs** (read-only context):`);
    for (const k of prevKeys) {
      parts.push(`- ${k}: ${JSON.stringify(input.previousOutputs[k])}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
