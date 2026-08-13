import { homedir } from 'node:os';
import { join } from 'node:path';
import { FLEEX_DIR, resolveEmbeddingModel, type EmbeddingModelSpec } from '@fleex/shared';
import type { EmbeddingProviderPort } from '../../../application/ports/embedding-provider.port.js';
import type { LoggerPort } from '../../../application/ports/logger.port.js';

/**
 * Which encoders exist, what they cost and which prefixes they need lives in the
 * shared catalogue (`EMBEDDING_MODELS`), because Settings renders the same list
 * and the Supabase adapter sizes its vector column from the same widths.
 */

/** Where model weights are cached, so the network is touched once. */
export const MODEL_CACHE_DIR = join(homedir(), FLEEX_DIR, 'models');

// Prefixes come from the model spec: each family has its own retrieval template,
// and using the wrong one costs quality with no error to show for it. That is why
// passages and queries are separate port methods rather than one `embed()`.

/** Batch size for `embedPassages`. Bounded to keep peak memory predictable. */
const BATCH_SIZE = 16;

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export interface TransformersEmbeddingOptions {
  /** Catalogue id. Unknown or absent resolves to the default model. */
  model?: string | null;
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
  /** The resolved catalogue entry — model id, width, prefixes. */
  readonly spec: EmbeddingModelSpec;

  private pipeline: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly modelName: string;
  private readonly offlineOnly: boolean;

  constructor(
    private readonly logger: LoggerPort,
    options: TransformersEmbeddingOptions = {},
  ) {
    this.spec = resolveEmbeddingModel(options.model);
    this.modelName = this.spec.id;
    this.dimensions = this.spec.dimensions;
    this.offlineOnly = options.offlineOnly ?? false;
    // The model is part of the provider id, and the provider id is what every
    // chunk records — so switching models is detectable per row rather than
    // being an undetectable change of meaning.
    this.id = `transformers:${this.modelName}`;
  }

  isReady(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Whether the optional package is installed, without loading a model.
   *
   * Distinct from `isReady()` on purpose: "the package is missing" and "the model
   * has not been fetched yet" need different actions from the user — one is an
   * install, the other is a wait — and a single boolean cannot say which. Cached
   * because the answer only changes when dependencies do.
   */
  async isInstalled(): Promise<boolean> {
    if (this.pipeline) return true;
    this.installed ??= this.importTransformers().then(() => true, () => false);
    return this.installed;
  }

  private installed: Promise<boolean> | null = null;

  /** The package that has to be installed for local embeddings to work. */
  static readonly PACKAGE_NAME = '@huggingface/transformers';

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
      const batch = texts.slice(i, i + BATCH_SIZE).map((t) => this.spec.passagePrefix + t);
      out.push(...await this.embedRaw(batch));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    await this.init();
    const [vector] = await this.embedRaw([this.spec.queryPrefix + text]);
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
