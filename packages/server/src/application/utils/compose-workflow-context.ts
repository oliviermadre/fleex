import type { JsonSchema, WorkflowEdgeCondition, EdgeOperator } from '@fleex/shared';

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

  // Reinforce the waiting_for_info contract in the workflow context. In a
  // workflow step there's no inline conversation with the user during the run,
  // so it's especially easy for the agent to misuse `comment` as a meta status
  // report ("I asked X about Y") instead of the actual question. The standard
  // mentionStatus instruction covers this, but doubling down here is cheap.
  parts.push(`**If you need human input to continue this workflow**: set \`mentionStatus: "waiting_for_info"\` and put your actual question(s) in \`comment\`. The workflow will pause and a side panel will prompt the user to respond. Their answer is posted as a ticket comment and this step retries automatically with that new context. Write the question directly ("Should we use option A or B?"), as if chatting — do NOT narrate ("I posed a question to @someone", "Awaiting reply"); only what you write in \`comment\` reaches the reader.`);
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

function opSymbol(op: EdgeOperator): string {
  switch (op) {
    case 'eq': return '==';
    case 'neq': return '!=';
    case 'in': return 'in';
    case 'gt': return '>';
    case 'lt': return '<';
    case 'contains': return 'contains';
  }
}
