import type { CommandDef } from '../../../../../core/types.ts';
import { ok, die, present } from '../../../../../core/colors.ts';
import { apiBase, apiPost } from '../../../../../core/api.ts';
import { fetchRunDetail, resolveStepRunId } from '../../../_shared.ts';
import {
  assertValidType,
  assertValidStatus,
  resolveContent,
  type DeliverableDTO,
} from '../../../../ticket/deliverable/_shared.ts';

interface AddOptions {
  title?: string;
  type?: string;
  status?: string;
  content?: string;
  file?: string;
  agentName?: string;
  ticket?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'add',
  aliases: ['create', 'new'],
  description: 'Attach a deliverable to a step run (add <runId> <stepRunId>)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (prefix needs --ticket)');
    cmd.argument('<stepRunId>', 'Step run UUID or short id prefix');
    cmd.requiredOption('--title <title>', 'Deliverable title');
    cmd.option('--type <type>', 'Deliverable type (configured per workspace; run with an invalid value to list)', 'report');
    cmd.option('--status <status>', 'draft | final', 'final');
    cmd.option('--content <content>', 'Inline content (Markdown or HTML)');
    cmd.option('--file <path>', 'Read content from file — use this for anything long');
    cmd.option('--agent-name <name>', 'Override the agent name attached to this deliverable (default: cli)');
    cmd.option('--ticket <id>', 'Ticket display ID (#42) or UUID — required to resolve a run prefix');
  },
  action: async (runIdArg: string, stepRunIdArg: string, opts: AddOptions) => {
    if (!opts.title) die('Missing --title');
    const type = opts.type ?? 'report';
    // A step deliverable is the step's finished output, not a work-in-progress
    // draft a human will pick up — hence `final` by default, unlike the
    // ticket-scoped command.
    const status = opts.status ?? 'final';
    await assertValidType(type);
    assertValidStatus(status);
    const content = resolveContent({ content: opts.content, file: opts.file });

    const detail = await fetchRunDetail(runIdArg, opts.ticket);
    const stepRunId = resolveStepRunId(detail, stepRunIdArg);

    const created = await apiPost<DeliverableDTO>(
      `${apiBase()}/api/workflows/runs/${encodeURIComponent(detail.run.id)}` +
        `/steps/${encodeURIComponent(stepRunId)}/deliverables`,
      {
        title: opts.title,
        type,
        status,
        content,
        agentName: opts.agentName ?? 'cli',
      },
    );
    present(created, () => ok(`Deliverable created: ${created.id} (step ${stepRunId.slice(0, 8)})`));
  },
};

export default def;
