import type { CommandDef } from '../../../core/types.ts';
import { apiPost, LLM_TIMEOUT_MS } from '../../../core/api.ts';
import { die, info, ok, present } from '../../../core/colors.ts';
import { memoryApi } from '../_shared.ts';

interface KeepOptions {
  title?: string;
  note?: string;
  content?: string;
  ticket?: string;
  repo?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'keep',
  description: 'Keep a moment of an execution as a memory note, ranked above ordinary run output',
  setup(cmd) {
    cmd.argument('<executionId>', 'Execution to keep something from');
    cmd.option('-t, --title <title>', 'Title for the note');
    cmd.option('-m, --note <text>', 'Why this is worth keeping — indexed with the content');
    cmd.option('-c, --content <text>', 'Exact text to keep (default: the run\'s own words)');
    cmd.option('--ticket <ticketId>', 'Ticket to attach the note to');
    cmd.option('-r, --repo <owner/name>', 'Repository the note is about');
  },
  action: async (executionId: string, opts: KeepOptions) => {
    if (!executionId?.trim()) die('An execution id is required.');

    const result = await apiPost<{ ok: boolean; noteId?: string; reason?: string }>(
      memoryApi('/curate'),
      {
        executionId: executionId.trim(),
        title: opts.title,
        content: opts.content,
        comment: opts.note ?? null,
        ticketId: opts.ticket ?? null,
        repo: opts.repo ?? null,
      }, LLM_TIMEOUT_MS);

    present(result, () => {
      if (!result.ok) {
        info(result.reason === 'empty'
          ? 'Nothing to keep — that execution produced no text. Pass --content to keep your own.'
          : 'Curation is switched off in Settings › Memory.');
        return;
      }
      ok('Kept.');
      if (result.noteId) info(`Note id: ${result.noteId}`);
    });
  },
};

export default def;
