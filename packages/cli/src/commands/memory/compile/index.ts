import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiPost } from '../../../core/api.ts';
import { die, info, ok, present, warn } from '../../../core/colors.ts';
import { describeOrigin, memoryApi, type MemorySnippet } from '../_shared.ts';

interface CompileOptions { limit?: string; repo?: string; save?: string; sources?: boolean }

interface SynthesisResult {
  subject: string;
  document: string | null;
  sources: MemorySnippet[];
  deliverableId?: string;
  reason?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'compile',
  description: 'Compile everything this workspace knows about a subject into a sourced document',
  setup(cmd) {
    cmd.argument('<subject...>', 'What to compile a reference about');
    cmd.option('-n, --limit <n>', 'Excerpts to draw on (default 24)');
    cmd.option('-r, --repo <owner/name>', 'Only draw on content attached to this repository');
    cmd.option('--save <ticketId>', 'Also save the document as a deliverable on this ticket');
    cmd.option('--sources', 'List the excerpts the document cites');
  },
  action: async (subjectParts: string[], opts: CompileOptions) => {
    const subject = subjectParts.join(' ').trim();
    if (!subject) die('A subject is required.');

    const result = await apiPost<SynthesisResult>(memoryApi('/synthesise'), {
      subject,
      limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
      repo: opts.repo ?? null,
      saveToTicketId: opts.save ?? null,
    });

    present(result, () => {
      if (!result.document) {
        if (result.reason === 'no_results') info(`Nothing in memory relates to "${subject}".`);
        else warn(`Could not compile a document about "${subject}".`);
        return;
      }

      process.stdout.write(`${result.document}\n`);

      if (opts.sources && result.sources.length > 0) {
        process.stdout.write(`\n${chalk.bold('Sources')}\n`);
        for (const [i, snippet] of result.sources.entries()) {
          process.stdout.write(`  [${i + 1}] ${snippet.title}\n      ${chalk.dim(describeOrigin(snippet))}\n`);
        }
      }

      if (result.deliverableId) ok(`Saved as a deliverable (${result.deliverableId}).`);
      else if (opts.save) warn('Could not save it to that ticket — the document above is unaffected.');
    });
  },
};

export default def;
