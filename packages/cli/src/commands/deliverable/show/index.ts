import type { CommandDef } from '../../../core/types.ts';
import { c, present } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import type { ListedDeliverable } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view', 'get'],
  description: 'Read one deliverable by id, whatever it belongs to (ticket or routine run): metadata and full content',
  setup(cmd) {
    cmd.argument('<id>', 'Deliverable UUID (from `deliverable search`, `agenda show`, `ticket deliverable list`)');
    cmd.option('--content-only', 'Print only the raw content (no header)');
  },
  action: async (id: string, opts: { contentOnly?: boolean }) => {
    const d = await apiGet<ListedDeliverable>(`${apiBase()}/api/deliverables/${encodeURIComponent(id.trim())}`);
    present({ ok: true, deliverable: d }, () => {
      if (opts.contentOnly) {
        process.stdout.write(d.content.endsWith('\n') ? d.content : `${d.content}\n`);
        return;
      }
      const out = (l = '') => process.stdout.write(`${l}\n`);
      out();
      out(`  ${c.bold(d.title)}  ${c.dim(`[${d.type}]`)}  by ${c.cyan(d.agentName)}  ${d.status}  ${c.dim(`v${d.version}`)}`);
      out(`  ${c.bold('UUID:')}     ${c.dim(d.id)}`);
      if (d.ticketId) out(`  ${c.bold('Ticket:')}   ${c.dim(d.ticketId)}`);
      if (d.workflowRunId) out(`  ${c.bold('Run:')}      ${c.dim(d.workflowRunId)}`);
      out(`  ${c.bold('Created:')}  ${c.dim(d.createdAt)}`);
      out('  ────────────────────────────────────────────────────────');
      for (const line of String(d.content).split('\n')) out(`    ${line}`);
      out();
    });
  },
};

export default def;
