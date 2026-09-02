import type { EmbeddingProviderPort } from '../../../application/ports/embedding-provider.port.js';
import type { LoggerPort } from '../../../application/ports/logger.port.js';

/** Where an Ollama daemon listens unless told otherwise. */
const DEFAULT_HOST = 'http://127.0.0.1:11434';

/**
 * Default Ollama model. Same family as the in-process default, so switching
 * providers does not also change which encoder the corpus was indexed with —
 * only where the arithmetic happens.
 */
const DEFAULT_MODEL = 'zylonai/multilingual-e5-small';
const DEFAULT_DIMENSIONS = 384;

/** Prefixes, as with transformers: the e5 family is asymmetric. */
const PASSAGE_PREFIX = 'passage: ';
const QUERY_PREFIX = 'query: ';

/** Long enough for a cold model load, short enough to fail a dead daemon fast. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Batch size for `embedPassages` — one request per batch, not per text. */
const BATCH_SIZE = 32;

export interface OllamaEmbeddingOptions {
  host?: string;
  model?: string;
  dimensions?: number;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  /** Older daemons answer the single-input shape. */
  embedding?: number[];
  error?: string;
}

/**
 * Embeddings from a local Ollama daemon.
 *
 * Offered because some machines already run one — with a GPU behind it, it embeds
 * a corpus in a fraction of the time the in-process ONNX runtime takes, and it
 * removes the optional `@huggingface/transformers` install entirely.
 *
 * Never the default. It is a second process the user has to be running, and
 * assuming it would break the property that matters most here: that a fresh
 * install works offline with nothing else set up. So this adapter is selected
 * explicitly (`memoryEmbeddingProvider: 'ollama'`), and if the daemon is not
 * there it reports itself unavailable exactly like a model that has not been
 * downloaded — ingestion defers, retrieval falls back, nothing breaks.
 */
export class OllamaEmbeddingAdapter implements EmbeddingProviderPort {
  readonly id: string;
  readonly dimensions: number;

  private readonly host: string;
  private readonly model: string;
  private ready = false;

  constructor(
    private readonly logger: LoggerPort,
    options: OllamaEmbeddingOptions = {},
  ) {
    this.host = (options.host ?? process.env['OLLAMA_HOST'] ?? DEFAULT_HOST).replace(/\/$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    // Provider and model both in the id: a corpus embedded by Ollama's e5 and one
    // embedded by the ONNX e5 are not guaranteed bit-identical, so they are
    // treated as different models and re-embedded rather than mixed.
    this.id = `ollama:${this.model}`;
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Confirm the daemon answers and the model is pulled, by embedding one token.
   *
   * A tag listing would only prove the daemon is up; the first real request is
   * what surfaces a model that was never pulled, and it is cheap.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    const probe = await this.embed([`${QUERY_PREFIX}dimension probe`]);
    const width = probe[0]?.length ?? 0;
    if (width !== this.dimensions) {
      throw new Error(
        `Ollama model ${this.model} produced ${width} dimensions, expected ${this.dimensions}`,
      );
    }
    this.ready = true;
    this.logger.info('Ollama embeddings ready', { host: this.host, model: this.model, dimensions: width });
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.init();

    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map((t) => PASSAGE_PREFIX + t);
      out.push(...await this.embed(batch));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    await this.init();
    const [vector] = await this.embed([QUERY_PREFIX + text]);
    if (!vector) throw new Error('Ollama returned no vector for query');
    return vector;
  }

  /**
   * One request, normalising both response shapes and the vectors themselves.
   *
   * Ollama does not promise unit-length output, and the scorer's cosine assumes
   * it — so normalising here keeps the two providers interchangeable instead of
   * making every consumer ask which one it got.
   */
  private async embed(inputs: string[]): Promise<Float32Array[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.host}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: inputs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama answered ${response.status} — is \`ollama pull ${this.model}\` done?`);
      }

      const body = await response.json() as OllamaEmbedResponse;
      if (body.error) throw new Error(`Ollama: ${body.error}`);

      const rows = body.embeddings ?? (body.embedding ? [body.embedding] : []);
      if (rows.length !== inputs.length) {
        throw new Error(`Ollama returned ${rows.length} vectors for ${inputs.length} inputs`);
      }
      return rows.map((row) => normalise(row));
    } catch (error) {
      this.ready = false;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Ollama did not answer within ${REQUEST_TIMEOUT_MS / 1000}s at ${this.host}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Whether a daemon is reachable at all — used to report provider status. */
  async isInstalled(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      try {
        const response = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  /** What to tell the user when it is not reachable. */
  static readonly PACKAGE_NAME = 'ollama (a local daemon on :11434)';
}

function normalise(values: number[]): Float32Array {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm === 0) return vector;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! * inv;
  return vector;
}
