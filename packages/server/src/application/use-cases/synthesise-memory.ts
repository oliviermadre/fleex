import type { LoggerPort } from '../ports/logger.port.js';
import { MemorySynthesiser, NOTHING_SENTINEL, renderEvidence } from '../memory/memory-synthesiser.js';
import type { MemorySnippet, RetrieveContextUseCase } from './retrieve-context.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';

/** Wide by design: a compilation is only worth reading if it saw the whole picture. */
const DEFAULT_LIMIT = 24;

const SYSTEM_PROMPT = `
You compile what a developer's workspace knows about one subject into a single
reference document.

You are given numbered excerpts from tickets, discussions, deliverables and notes.

Write a markdown document. Rules:
- Use only the excerpts. Never add outside knowledge, and never smooth over a gap
  with a plausible sentence.
- Cite every claim with the excerpt number it came from, e.g. [3].
- Organise by theme, not by source. The point is a synthesis, not a list of
  excerpts with headings.
- Where excerpts disagree, say so and cite both. A contradiction the reader needs
  to resolve is more useful than a confident average.
- Open with a short "What this covers" paragraph, then the themes, then an
  "Open questions" section for what the excerpts raise but do not answer.
- No preamble, no code fence — the document itself.

If the excerpts have nothing coherent to say about the subject, output the single
token ${NOTHING_SENTINEL}.
- Write in the language the subject and its sources are in, not in English by
  default.
`.trim();

export interface SynthesisResult {
  subject: string;
  /** The compiled document, or null when nothing coherent could be written. */
  document: string | null;
  /** The excerpts it drew on, in citation order. */
  sources: MemorySnippet[];
  /** Set when the document was saved to a ticket. */
  deliverableId?: string;
  reason?: 'no_results' | 'synthesis_failed' | 'unavailable';
}

/**
 * Compiles everything the workspace knows about a subject into one document.
 *
 * Distinct from `ask` in what it is for: `ask` answers a question in a sentence,
 * this produces a reference someone will come back to. That difference drives the
 * design — a much wider retrieval, organisation by theme rather than by source,
 * explicit contradictions instead of an averaged answer, and an "open questions"
 * section, because the gaps in what an instance knows are usually the most
 * actionable part of knowing it.
 *
 * Saving is optional and explicit. A compilation is a snapshot of a moving
 * corpus, so persisting every one of them would fill the Documents library with
 * near-duplicates; the user decides which is worth keeping.
 */
export class SynthesiseMemoryUseCase {
  constructor(
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly synthesiser: MemorySynthesiser,
    private readonly logger: LoggerPort,
    private readonly submitDeliverable?: SubmitDeliverableUseCase,
  ) {}

  async execute(params: {
    subject: string;
    limit?: number;
    repo?: string | null;
    /** When set, the document is saved as a deliverable on this ticket. */
    saveToTicketId?: string | null;
  }): Promise<SynthesisResult> {
    const subject = params.subject.trim();
    if (!subject) return { subject, document: null, sources: [], reason: 'no_results' };

    if (!this.retrieveContext.isFeatureEnabled('synthesis')) {
      return { subject, document: null, sources: [], reason: 'unavailable' };
    }

    const sources = await this.retrieveContext.search({
      query: subject,
      limit: params.limit ?? DEFAULT_LIMIT,
      repo: params.repo ?? null,
    });
    if (sources.length === 0) return { subject, document: null, sources: [], reason: 'no_results' };

    const document = await this.synthesiser.run(
      { systemPrompt: SYSTEM_PROMPT, userPrompt: buildSynthesisPrompt(subject, sources) },
      { subject },
    );
    if (!document) return { subject, document: null, sources, reason: 'synthesis_failed' };

    const result: SynthesisResult = { subject, document, sources };

    if (params.saveToTicketId && this.submitDeliverable) {
      try {
        const deliverable = await this.submitDeliverable.execute({
          ticketId: params.saveToTicketId,
          agentName: 'memory',
          type: 'report',
          title: `What we know about ${subject}`,
          content: withProvenance(document, sources),
          status: 'final',
        });
        result.deliverableId = deliverable.id;
      } catch (error) {
        // The document is the deliverable; failing to file it must not lose it.
        this.logger.warn('Could not save synthesis as a deliverable', {
          subject,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}

export function buildSynthesisPrompt(subject: string, sources: MemorySnippet[]): string {
  return [
    `Subject: ${subject}`,
    '',
    '## Excerpts from this workspace',
    '',
    renderEvidence(sources),
    '',
    '---',
    `Compile what this workspace knows about "${subject}" now.`,
  ].join('\n');
}

/**
 * Append the source list to a saved document.
 *
 * A stored compilation outlives the request that produced it, so its bracketed
 * citations have to resolve to something. Without this the numbers in a saved
 * document point at nothing.
 */
export function withProvenance(document: string, sources: MemorySnippet[]): string {
  const lines = sources.map((s, i) => {
    const origin = [s.sourceKind.replace(/_/g, ' '), s.repo, s.updatedAt?.slice(0, 10)]
      .filter(Boolean)
      .join(' — ');
    return `- [${i + 1}] ${s.title} (${origin})`;
  });
  return `${document}\n\n---\n\n## Sources\n\n${lines.join('\n')}\n`;
}
