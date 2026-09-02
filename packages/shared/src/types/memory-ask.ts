/**
 * Progress of a question being answered from memory.
 *
 * Answering is several seconds of real work — encode the question, search the
 * index, reassemble the documents that won, then one model call — and a single
 * frozen "Reading what this workspace remembers…" made all of it look like
 * nothing happening. Each stage is emitted as it starts, so the panel can show
 * what is done and what is under way.
 *
 * Shared rather than declared twice: the server writes these and the browser
 * parses them, and a stage renamed on one side only would degrade silently into
 * a progress list that stops moving.
 */
export type MemoryAskStage =
  | { stage: 'encoding' }
  | { stage: 'searching' }
  /** What the search found, before anything is read in full. */
  | { stage: 'retrieved'; passages: number; documents: number }
  /** Documents being reassembled in full, named so the wait shows its work. */
  | { stage: 'reading'; titles: string[] }
  | { stage: 'drafting' };

/**
 * A slice of the answer as the model writes it.
 *
 * Measured on a live instance: retrieval takes 0.6 s and the model 13.1 s, so
 * naming the stages left 95% of the wait sitting under one unmoving line. Text
 * arriving as it is written is the only thing that makes *that* wait legible.
 */
export interface MemoryAskDelta {
  delta: string;
}

/** Everything the answer stream can carry before the result itself. */
export type MemoryAskEvent = MemoryAskStage | MemoryAskDelta;

/** The order stages occur in, for rendering the ones not yet reached. */
export const MEMORY_ASK_STAGES = [
  'encoding',
  'searching',
  'retrieved',
  'reading',
  'drafting',
] as const satisfies ReadonlyArray<MemoryAskStage['stage']>;
