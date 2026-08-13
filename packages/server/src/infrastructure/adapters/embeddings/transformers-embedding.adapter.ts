import { homedir } from 'node:os';
import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { EmbeddingProviderPort } from '../../../application/ports/embedding-provider.port.js';
import type { LoggerPort } from '../../../application/ports/logger.port.js';

/**
 * Default model: 384 dimensions, int8-quantised, ~112 MB on disk.
 *
 * Chosen for a bilingual corpus — Fleex tickets and comments mix French and
 * English, so an English-only encoder (all-MiniLM, nomic-embed-text) would
 * degrade on half the content. Among the multilingual options it is the best
 * quality per megabyte and per millisecond of CPU; the heavier ones
 * (EmbeddingGemma-300M, Qwen3-Embedding-0.6B) are configurable alternatives,
 * to be settled by `fleex memory bench` on the real corpus rather than by
 * published leaderboards.
 */
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;

/** Where model weights are cached, so the network is touched once. */
export const MODEL_CACHE_DIR = join(homedir(), FLEEX_DIR, 'models');

/**
 * The e5 family is asymmetric: stored text and queries must carry different
 * prefixes. Omitting them costs a large slice of retrieval quality with no
 * error to show for it, which is why the two paths are separate port methods
 * rather than one `embed()`.
 */
const PASSAGE_PREFIX = 'passage: ';
const QUERY_PREFIX = 'query: ';

/** Batch size for `embedPassages`. Bounded to keep peak memory predictable. */
const BATCH_SIZE = 16;

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export interface TransformersEmbeddingOptions {
  model?: string;
  dimensions?: number;
  /** Skip the network entirely; fails if weights are not already cached. */
  offlineOnly?: boolean;
}

/**
 * Local embeddings via transformers.js (ONNX Runtime).
 *
 * Runs in-process with no daemon and no network once the weights are cached, so
 * memory retrieval keeps working on a plane — the property that makes this
 * viable for a local-first instance at all.
 *
 * `@huggingface/transformers` is imported dynamically and treated as optional.
 * That is deliberate: the semantic engine ships as opt-in beta, and a user who
 * never enables it should not carry an ONNX runtime in their install. A missing
 * package surfaces as "provider unavailable" — the same degradation path as a
 * model that has not finished downloading — instead of a boot failure.
 */
export class TransformersEmbeddingAdapter implements EmbeddingProviderPort {
  readonly id: string;
  readonly dimensions: number;

  private pipeline: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly modelName: string;
  private readonly offlineOnly: boolean;

  constructor(
    private readonly logger: LoggerPort,
    options: TransformersEmbeddingOptions = {},
  ) {
    this.modelName = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    this.offlineOnly = options.offlineOnly ?? false;
    this.id = `transformers:${this.modelName}`;
  }

  isReady(): boolean {
    return this.pipeline !== null;
  }

  /** Idempotent and concurrency-safe: parallel callers share one model load. */
  async init(): Promise<void> {
    if (this.pipeline) return;
    this.initPromise ??= this.load();
    try {
      await this.initPromise;
    } catch (error) {
      // Clear the memo so a later attempt can retry — the usual cause is a
      // transient download failure, not a permanent one.
      this.initPromise = null;
      throw error;
    }
  }

  private async load(): Promise<void> {
    const transformers = await this.importTransformers();

    transformers.env.cacheDir = MODEL_CACHE_DIR;
    transformers.env.allowLocalModels = true;
    if (this.offlineOnly) transformers.env.allowRemoteModels = false;

    this.logger.info('Loading embedding model', { model: this.modelName, cacheDir: MODEL_CACHE_DIR });
    const pipe = await transformers.pipeline('feature-extraction', this.modelName, { dtype: 'q8' });
    this.pipeline = pipe as unknown as FeatureExtractionPipeline;

    // Verify the model's actual width rather than trusting the configured one: a
    // mismatch would otherwise be discovered as silently unusable vectors.
    const probe = await this.embedRaw(['dimension probe']);
    const actual = probe[0]?.length ?? 0;
    if (actual !== this.dimensions) {
      this.pipeline = null;
      throw new Error(
        `Embedding model ${this.modelName} produced ${actual} dimensions, expected ${this.dimensions}`,
      );
    }
    this.logger.info('Embedding model ready', { model: this.modelName, dimensions: actual });
  }

  private async importTransformers(): Promise<{
    pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
    env: Record<string, unknown>;
  }> {
    try {
      // Bare specifier in a variable so bundlers do not hard-require the package.
      const specifier = '@huggingface/transformers';
      return await import(specifier) as never;
    } catch (error) {
      throw new Error(
        'Local embeddings need the optional @huggingface/transformers package. '
        + `Install it to enable the semantic memory engine (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.init();

    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map((t) => PASSAGE_PREFIX + t);
      out.push(...await this.embedRaw(batch));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    await this.init();
    const [vector] = await this.embedRaw([QUERY_PREFIX + text]);
    if (!vector) throw new Error('Embedding provider returned no vector for query');
    return vector;
  }

  /**
   * Mean pooling + L2 normalisation, which is what this model family expects.
   * Normalising here means cosine similarity downstream is a plain dot product's
   * worth of work and is comparable across vectors.
   */
  private async embedRaw(texts: string[]): Promise<Float32Array[]> {
    const pipe = this.pipeline;
    if (!pipe) throw new Error('Embedding provider is not initialised');
    const output = await pipe(texts, { pooling: 'mean', normalize: true });
    return output.tolist().map((row) => Float32Array.from(row));
  }
}
