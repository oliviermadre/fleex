import type { LoggerPort } from '../ports/logger.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import { HUMAN_FEEDBACK_TAG } from '../memory/chunker.js';
import { MemorySynthesiser, NOTHING_SENTINEL, renderEvidence } from '../memory/memory-synthesiser.js';
import type { MemorySnippet, RetrieveContextUseCase } from './retrieve-context.js';

/** How many corrections to draw on. Enough for a pattern, not a transcript. */
const EVIDENCE_LIMIT = 20;

const SYSTEM_PROMPT = `
You maintain the long-term memory of a coding agent: a short markdown document of
durable lessons that is prepended to every one of its future runs.

You are given the agent's current memory and excerpts of past work where a human
corrected it or answered its questions.

Write the complete replacement document. Rules:
- Keep every existing lesson that the excerpts do not contradict. This is an
  amendment, not a rewrite.
- Add only lessons that generalise. "Use sessions, not JWT, because we need
  revocation" is a lesson; "fix the typo on line 12" is not.
- State each lesson as an instruction the agent can act on, one per bullet.
- Correct any existing lesson the excerpts show to be wrong, rather than
  appending a contradiction next to it.
- Stay under 400 words. A memory nobody reads is worse than a short one.
- Output the markdown document and nothing else — no preamble, no code fence.

If the excerpts contain no generalisable lesson beyond what the memory already
says, output the single token ${NOTHING_SENTINEL}.
`.trim();

export interface PersonaCoachProposal {
  personaId: string;
  personaName: string;
  /** Current document, so a caller can show the change rather than the result. */
  currentMemoryMd: string;
  /** Proposed replacement, or null when nothing was worth changing. */
  proposedMemoryMd: string | null;
  /** The excerpts the proposal was drawn from, for review. */
  evidence: MemorySnippet[];
  reason?: 'no_evidence' | 'nothing_to_learn' | 'synthesis_failed' | 'unavailable' | 'not_found';
}

/**
 * Proposes what an agent should have learned, from the times it was corrected.
 *
 * The most valuable signal in the instance is the moment someone said "no, not
 * like that" — and today it is inert: the correction sits in a comment thread and
 * the agent re-derives the same mistake next week. This turns those moments into
 * an amendment to the agent's own memory document.
 *
 * It only ever *proposes*. An agent's memory shapes every future run it makes, so
 * rewriting it without review would let one bad inference degrade the agent
 * permanently — and silently, since nobody reads a file they did not change.
 * Applying is a separate, explicit call.
 */
export class CoachPersonaUseCase {
  constructor(
    private readonly personaStore: PersonaStorePort,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly synthesiser: MemorySynthesiser,
    private readonly logger: LoggerPort,
  ) {}

  async propose(personaId: string): Promise<PersonaCoachProposal> {
    const persona = await this.personaStore.getById(personaId);
    if (!persona) {
      return { personaId, personaName: '', currentMemoryMd: '', proposedMemoryMd: null, evidence: [], reason: 'not_found' };
    }

    const base = {
      personaId,
      personaName: persona.name,
      currentMemoryMd: persona.memoryMd,
      proposedMemoryMd: null,
      evidence: [] as MemorySnippet[],
    };

    if (!this.retrieveContext.isFeatureEnabled('personaCoach')) {
      return { ...base, reason: 'unavailable' };
    }

    const evidence = await this.gatherEvidence(persona.name);
    if (evidence.length === 0) return { ...base, reason: 'no_evidence' };

    const proposed = await this.synthesiser.run(
      { systemPrompt: SYSTEM_PROMPT, userPrompt: buildCoachPrompt(persona.name, persona.memoryMd, evidence) },
      { personaId, persona: persona.name },
    );

    if (!proposed) {
      // The synthesiser collapses "declined" and "failed"; distinguishing them
      // here would need a second signal, and the actionable answer is the same:
      // there is no proposal to review.
      return { ...base, evidence, reason: 'nothing_to_learn' };
    }
    if (proposed.trim() === persona.memoryMd.trim()) {
      return { ...base, evidence, reason: 'nothing_to_learn' };
    }

    return { ...base, evidence, proposedMemoryMd: proposed };
  }

  /**
   * Apply a reviewed proposal.
   *
   * Takes the text rather than re-running the model: the user approved a specific
   * document, and regenerating would apply something they never read.
   */
  async apply(personaId: string, memoryMd: string): Promise<boolean> {
    const persona = await this.personaStore.getById(personaId);
    if (!persona) return false;

    persona.update({ memoryMd });
    await this.personaStore.save(persona);
    this.logger.info('Persona memory updated from coach proposal', {
      personaId, persona: persona.name, length: memoryMd.length,
    });
    return true;
  }

  /**
   * Retrieve the corrections and answered questions involving this agent.
   *
   * Two searches rather than one filtered pass: the corrections live in comment
   * threads tagged as feedback, the answered questions in `qa_pair` chunks, and
   * the two carry different vocabulary. A single query would let whichever kind is
   * more verbose crowd out the other.
   */
  private async gatherEvidence(personaName: string): Promise<MemorySnippet[]> {
    const query = `corrections, decisions and answered questions involving the agent ${personaName}`;

    const [threads, pairs] = await Promise.all([
      this.retrieveContext.search({ query, limit: EVIDENCE_LIMIT, kinds: ['comment_thread'] }),
      this.retrieveContext.search({ query, limit: EVIDENCE_LIMIT, kinds: ['qa_pair', 'curated_note'] }),
    ]);

    const seen = new Set<string>();
    return [...pairs, ...threads]
      .filter(teachesSomething)
      .filter((s) => {
        const key = `${s.sourceKind}:${s.sourceId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, EVIDENCE_LIMIT);
  }
}

/**
 * Whether a retrieved snippet carries a lesson.
 *
 * Stated over the snippet rather than left to the store's `kinds` filter, so the
 * rule is legible in one place and a retrieval change cannot silently widen what
 * the coach learns from. An ordinary discussion the agent took part in is not a
 * lesson; a Q&A pair or a note someone deliberately kept always is.
 */
function teachesSomething(snippet: MemorySnippet): boolean {
  if (snippet.sourceKind === 'qa_pair' || snippet.sourceKind === 'curated_note') return true;
  if (snippet.sourceKind === 'comment_thread') return !!snippet.tags?.includes(HUMAN_FEEDBACK_TAG);
  return false;
}

export function buildCoachPrompt(
  personaName: string,
  currentMemoryMd: string,
  evidence: MemorySnippet[],
): string {
  const current = currentMemoryMd.trim() || '(empty — this agent has learned nothing yet)';
  return [
    `Agent: ${personaName}`,
    '',
    '## Current memory',
    '',
    current,
    '',
    '## Past work where a human corrected this agent or answered its questions',
    '',
    renderEvidence(evidence),
    '',
    '---',
    'Write the replacement memory document now.',
  ].join('\n');
}
