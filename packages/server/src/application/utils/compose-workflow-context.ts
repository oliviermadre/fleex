import type { JsonSchema, WorkflowEdgeCondition } from '@fleex/shared';

export interface WorkflowContextInput {
  workflowName: string;
  stepName: string;
  outputSchema: JsonSchema | undefined;
  outgoingEdges: {
    id: string;
    label?: string;
    condition?: WorkflowEdgeCondition;
    targetName: string;
  }[];
  previousOutputs: Record<string, Record<string, unknown>>;
}

export function composeWorkflowContextPrompt(input: WorkflowContextInput): string {
  const parts: string[] = [];

  parts.push(`## Workflow Context`);
  parts.push('');
  parts.push(`You are executing step **${input.stepName}** of workflow **${input.workflowName}**.`);
  parts.push('');

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
    for (const e of input.outgoingEdges) {
      if (e.condition) {
        const opSym = opSymbol(e.condition.operator);
        const value = Array.isArray(e.condition.value) ? JSON.stringify(e.condition.value) : `"${e.condition.value}"`;
        parts.push(`- If \`${e.condition.field}\` ${opSym} ${value} → next step: **${e.targetName}**${e.label ? ` (${e.label})` : ''}`);
      } else {
        parts.push(`- Default → next step: **${e.targetName}**${e.label ? ` (${e.label})` : ''}`);
      }
    }
  }
  parts.push('');

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

function opSymbol(op: string): string {
  switch (op) {
    case 'eq': return '==';
    case 'neq': return '!=';
    case 'in': return 'in';
    case 'gt': return '>';
    case 'lt': return '<';
    case 'contains': return 'contains';
    default: return op;
  }
}
