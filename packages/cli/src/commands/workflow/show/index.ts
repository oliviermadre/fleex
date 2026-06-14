import type { CommandDef } from '../../../core/types.ts';
import { c, die, info } from '../../../core/colors.ts';
import {
  fetchWorkflows,
  handle,
  printJson,
  resolveFromList,
  workflowHandleName,
} from '../../../core/agentic.ts';

interface ShowOptions { json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: 'Show one workflow template (by slug or UUID), including its steps',
  setup(cmd) {
    cmd.argument('<id|slug>', 'Workflow slug (@workflow: handle) or UUID');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (arg: string, opts: ShowOptions) => {
    const workflows = await fetchWorkflows();
    const w = resolveFromList(arg, workflows, workflowHandleName, (x) => x.name);
    if (!w) die(`Workflow not found: ${arg}`);

    if (opts.json) {
      printJson(w);
      return;
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(`${w.emoji ? w.emoji + ' ' : ''}${w.name}`)}\n`);
    process.stdout.write(`  ${c.dim('handle')}   ${handle('workflow', workflowHandleName(w))}\n`);
    process.stdout.write(`  ${c.dim('id')}       ${w.id}\n`);
    process.stdout.write(`  ${c.dim('enabled')}  ${w.enabled ? 'yes' : 'no'}\n`);
    if (w.description) process.stdout.write(`  ${c.dim('about')}    ${w.description}\n`);
    if (w.steps?.length) {
      process.stdout.write(`\n  ${c.bold('Steps')}\n`);
      for (const s of w.steps) {
        const entry = s.id === w.entryStepId ? c.dim(' (entry)') : '';
        const executor = s.executorType
          ? c.dim(` [${s.executorType}${s.executorRef ? `:${s.executorRef}` : ''}]`)
          : '';
        process.stdout.write(`  - ${s.name ?? s.id}${executor}${entry}\n`);
      }
    }
    process.stdout.write('\n');
    info(`Trigger with: fleex trigger <ticket> --workflow ${workflowHandleName(w)}`);
  },
};

export default def;
