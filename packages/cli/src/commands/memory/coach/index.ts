import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiGet, apiPost, LLM_TIMEOUT_MS } from '../../../core/api.ts';
import { die, info, ok, present, warn } from '../../../core/colors.ts';
import { fetchPersonas } from '../../../core/agentic.ts';
import { describeOrigin, memoryApi, type MemorySnippet } from '../_shared.ts';

interface CoachOptions { apply?: boolean; sources?: boolean }

interface CoachProposal {
  personaId: string;
  personaName: string;
  currentMemoryMd: string;
  proposedMemoryMd: string | null;
  evidence: MemorySnippet[];
  reason?: string;
}

const REASONS: Record<string, string> = {
  unavailable: 'Agent coaching is switched off in Settings › Memory.',
  not_found: 'No such agent.',
  no_evidence: 'No corrections or answered questions found for this agent yet.',
  nothing_to_learn: 'Nothing generalisable to add beyond what this agent already remembers.',
  synthesis_failed: 'Could not draft a proposal.',
};

const def: CommandDef = {
  workspaceAware: true,
  name: 'coach',
  description: 'Propose what an agent should have learned from the times you corrected it',
  setup(cmd) {
    cmd.argument('<agent>', 'Agent name or id');
    cmd.option('--apply', 'Write the proposal to the agent\'s memory instead of only showing it');
    cmd.option('--sources', 'List the corrections the proposal draws on');
  },
  action: async (agentRef: string, opts: CoachOptions) => {
    const needle = agentRef.trim().toLowerCase();
    if (!needle) die('An agent name is required.');

    const personas = await fetchPersonas();
    const persona = personas.find((p) => p.id === agentRef)
      ?? personas.find((p) => p.name.toLowerCase() === needle);
    if (!persona) die(`Unknown agent "${agentRef}".`);

    const proposal = await apiGet<CoachProposal>(memoryApi(`/personas/${encodeURIComponent(persona.id)}/coach`), LLM_TIMEOUT_MS);

    if (!proposal.proposedMemoryMd) {
      present(proposal, () => info(REASONS[proposal.reason ?? ''] ?? 'No proposal.'));
      return;
    }

    if (opts.apply) {
      await apiPost(memoryApi(`/personas/${encodeURIComponent(persona.id)}/coach/apply`), {
        memoryMd: proposal.proposedMemoryMd,
      }, LLM_TIMEOUT_MS);
      present({ ...proposal, applied: true }, () => {
        ok(`Updated ${proposal.personaName}'s memory.`);
      });
      return;
    }

    present(proposal, () => {
      // Printed, not applied: this document shapes every future run of the agent,
      // so `--apply` stays an explicit second step.
      process.stdout.write(`${chalk.bold('Proposed memory')} for ${proposal.personaName}\n\n`);
      process.stdout.write(`${proposal.proposedMemoryMd}\n\n`);

      if (opts.sources && proposal.evidence.length > 0) {
        process.stdout.write(`${chalk.bold('Drawn from')}\n`);
        for (const snippet of proposal.evidence) {
          process.stdout.write(`  - ${snippet.title}\n    ${chalk.dim(describeOrigin(snippet))}\n`);
        }
        process.stdout.write('\n');
      }

      if (!proposal.currentMemoryMd.trim()) {
        info('This agent had no memory yet.');
      }
      warn('Nothing was written. Re-run with --apply to accept this proposal.');
    });
  },
};

export default def;
