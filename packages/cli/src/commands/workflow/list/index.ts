import type { CommandDef } from '../../../core/types.ts';
import { info } from '../../../core/colors.ts';
import {
  fetchWorkflows,
  handle,
  printJson,
  renderTable,
  trunc,
  workflowHandleName,
} from '../../../core/agentic.ts';

interface ListOptions { json?: boolean; enabled?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List workflow templates with their @workflow: handle and description',
  setup(cmd) {
    cmd.option('--enabled', 'Only show enabled workflows');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: ListOptions) => {
    const workflows = await fetchWorkflows(Boolean(opts.enabled));
    if (opts.json) {
      printJson(workflows);
      return;
    }
    if (workflows.length === 0) {
      info('No workflows found.');
      return;
    }
    workflows.sort((a, b) => workflowHandleName(a).localeCompare(workflowHandleName(b)));
    const rows = workflows.map((w) => [
      handle('workflow', workflowHandleName(w)),
      trunc(`${w.emoji ? w.emoji + ' ' : ''}${w.name ?? ''}`, 30),
      trunc(w.description ?? '', 44),
      String(w.steps?.length ?? 0),
      w.enabled ? 'yes' : 'no',
    ]);
    renderTable(['HANDLE', 'NAME', 'DESCRIPTION', 'STEPS', 'ENABLED'], rows);
    info(`${workflows.length} workflow(s)`);
  },
};

export default def;
