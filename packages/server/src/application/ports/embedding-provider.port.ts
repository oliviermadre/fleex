/**
 * Turns text into vectors, locally.
 *
 * The port exists so the memory kernel never names a provider: the default runs
 * an ONNX model in-process (no daemon, no network after the first model fetch),
 * but an instance that already runs Ollama can point at it instead, and tests
 * substitute a deterministic fake. That keeps the local-first guarantee a
 * property of the default rather than an assumption baked into callers.
 *
 * `id` is persisted next to every vector it produces. Comparing vectors from
 * two different models is meaningless, so the id is what lets the store detect
 * a model change and invalidate the index rather than silently mixing spaces.
 */
export interface EmbeddingProviderPort {
  /** Stable identifier, e.g. `transformers:multilingual-e5-small@q8`. */
  readonly id: string;
  /** Vector width. Fixed per model; a change means a full re-embed. */
  readonly dimensions: number;

  /**
   * Load the model. Kept off the constructor so server boot never waits on a
   * model download; the kernel calls it lazily and tolerates failure.
   */
  init(): Promise<void>;
  /** False until `init()` has completed successfully. */
  isReady(): boolean;

  /**
   * Embed stored content. Batched because model invocation overhead dominates
   * per-item cost during a backfill.
   */
  embedPassages(texts: string[]): Promise<Float32Array[]>;

  /**
   * Embed a search query. Separate from `embedPassages` because asymmetric
   * models (the e5 family, notably) require a different prefix on each side —
   * getting it wrong degrades retrieval without any visible error.
   */
  embedQuery(text: string): Promise<Float32Array>;
}
