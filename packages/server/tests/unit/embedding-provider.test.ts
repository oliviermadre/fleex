import { describe, it, expect, vi, afterEach } from 'vitest';
import { EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL } from '@fleex/shared';
import { buildEmbeddingProvider } from '../../src/infrastructure/adapters/embeddings/build-embedding-provider.js';
import { OllamaEmbeddingAdapter } from '../../src/infrastructure/adapters/embeddings/ollama-embedding.adapter.js';
import { TransformersEmbeddingAdapter } from '../../src/infrastructure/adapters/embeddings/transformers-embedding.adapter.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function config(overrides: Partial<AppConfig> = {}): ConfigPort {
  return { get: () => overrides as AppConfig } as unknown as ConfigPort;
}

describe('buildEmbeddingProvider', () => {
  it('defaults to the in-process runtime and the default model', () => {
    const provider = buildEmbeddingProvider(config(), silent as never);
    expect(provider.id).toBe(`transformers:${DEFAULT_EMBEDDING_MODEL.id}`);
    expect(provider.dimensions).toBe(DEFAULT_EMBEDDING_MODEL.dimensions);
  });

  it('honours a configured model, width included', () => {
    const wide = EMBEDDING_MODELS.find((m) => m.dimensions === 768)!;
    const provider = buildEmbeddingProvider(
      config({ memoryEmbeddingModel: wide.id }), silent as never,
    );
    expect(provider.id).toContain(wide.id);
    // The width has to travel with the choice: it is what sizes the Supabase column.
    expect(provider.dimensions).toBe(768);
  });

  it('falls back to the default for a model that is no longer in the catalogue', () => {
    // A config naming a removed model must not stop the instance from booting; the
    // mismatch is detected per row and repaired by the sweep.
    const provider = buildEmbeddingProvider(
      config({ memoryEmbeddingModel: 'someone/deleted-model' }), silent as never,
    );
    expect(provider.id).toBe(`transformers:${DEFAULT_EMBEDDING_MODEL.id}`);
  });

  it('builds the Ollama runtime when asked, at the configured width', () => {
    const wide = EMBEDDING_MODELS.find((m) => m.dimensions === 768)!;
    const provider = buildEmbeddingProvider(
      config({ memoryEmbeddingProvider: 'ollama', memoryEmbeddingModel: wide.id }),
      silent as never,
    );
    expect(provider.id.startsWith('ollama:')).toBe(true);
    expect(provider.dimensions).toBe(768);
  });

  it('reports what is missing, per runtime', () => {
    expect(buildEmbeddingProvider(config(), silent as never).runtimeLabel)
      .toBe('@huggingface/transformers');
    expect(buildEmbeddingProvider(config({ memoryEmbeddingProvider: 'ollama' }), silent as never).runtimeLabel)
      .toContain('ollama');
  });
});

describe('TransformersEmbeddingAdapter.isInstalled', () => {
  /** Adapter whose import fails until `present` is flipped. */
  class Probeable extends TransformersEmbeddingAdapter {
    present = false;
    imports = 0;

    protected override async importTransformers(): Promise<never> {
      this.imports++;
      if (!this.present) throw new Error('Cannot find package');
      return {} as never;
    }
  }

  it('notices the package appearing, without a restart', async () => {
    const adapter = new Probeable(silent as never);

    expect(await adapter.isInstalled()).toBe(false);
    // The user reads "not installed", installs it, and looks again. Caching the
    // negative made the panel keep saying no until the process was restarted —
    // which nothing told them to do.
    adapter.present = true;
    expect(await adapter.isInstalled()).toBe(true);
  });

  it('stops probing once the answer is yes', async () => {
    const adapter = new Probeable(silent as never);
    adapter.present = true;

    await adapter.isInstalled();
    await adapter.isInstalled();
    await adapter.isInstalled();
    // A positive cannot become negative without a restart, so it is asked once.
    expect(adapter.imports).toBe(1);
  });

  it('shares one probe between concurrent callers', async () => {
    const adapter = new Probeable(silent as never);
    adapter.present = true;

    const [a, b, c] = await Promise.all([
      adapter.isInstalled(), adapter.isInstalled(), adapter.isInstalled(),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    // A Settings panel polls this; it must not start a resolution per request.
    expect(adapter.imports).toBe(1);
  });

  it('re-probes while the answer is no', async () => {
    const adapter = new Probeable(silent as never);

    await adapter.isInstalled();
    await adapter.isInstalled();
    expect(adapter.imports).toBe(2);
  });
});

describe('OllamaEmbeddingAdapter', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = handler(String(input), init);
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }) as unknown as typeof fetch;
  }

  it('embeds a batch in one request', async () => {
    const seen: unknown[] = [];
    stubFetch((_url, init) => {
      const parsed = JSON.parse(String(init?.body));
      seen.push(parsed);
      return { embeddings: parsed.input.map(() => [3, 0, 0, 0]) };
    });

    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 4 });
    const vectors = await adapter.embedPassages(['one', 'two']);

    expect(vectors).toHaveLength(2);
    // One probe (init) plus one batch — not one request per text.
    expect(seen).toHaveLength(2);
    expect((seen[1] as { input: string[] }).input).toEqual(['passage: one', 'passage: two']);
  });

  it('normalises what the daemon returns, which does not promise unit length', async () => {
    stubFetch(() => ({ embeddings: [[3, 4, 0, 0]] }));
    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 4 });

    const vector = await adapter.embedQuery('anything');
    const norm = Math.sqrt([...vector].reduce((sum, v) => sum + v * v, 0));
    // The scorer's cosine assumes unit vectors; both providers must agree on that.
    expect(norm).toBeCloseTo(1, 6);
    expect(vector[0]).toBeCloseTo(0.6, 6);
  });

  it('accepts the older single-embedding response shape', async () => {
    stubFetch(() => ({ embedding: [1, 0, 0, 0] }));
    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 4 });
    await expect(adapter.embedQuery('anything')).resolves.toHaveLength(4);
  });

  it('prefixes queries and passages differently', async () => {
    const inputs: string[][] = [];
    stubFetch((_url, init) => {
      const parsed = JSON.parse(String(init?.body));
      inputs.push(parsed.input);
      return { embeddings: parsed.input.map(() => [1, 0, 0, 0]) };
    });

    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 4 });
    await adapter.embedQuery('why sessions');
    await adapter.embedPassages(['we chose sessions']);

    // The e5 family is asymmetric; using one prefix for both costs quality
    // silently, so this is worth pinning.
    expect(inputs.some((batch) => batch[0] === 'query: why sessions')).toBe(true);
    expect(inputs.some((batch) => batch[0] === 'passage: we chose sessions')).toBe(true);
  });

  it('refuses a model whose width does not match the configuration', async () => {
    stubFetch(() => ({ embeddings: [[1, 0]] }));
    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 384 });
    // Wrong width means unusable vectors, which would otherwise be discovered as
    // silently poor retrieval rather than as an error.
    await expect(adapter.init()).rejects.toThrow(/expected 384/);
  });

  it('surfaces a daemon error with the command that fixes it', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({}),
    } as Response)) as unknown as typeof fetch;

    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 4 });
    await expect(adapter.embedQuery('x')).rejects.toThrow(/ollama pull/);
  });

  it('reports itself uninstalled when nothing answers', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const adapter = new OllamaEmbeddingAdapter(silent as never);
    // Same degradation path as a model that has not been downloaded: the status
    // endpoint says what is missing and ingestion defers.
    expect(await adapter.isInstalled()).toBe(false);
  });

  it('rejects a response that answers a different number of inputs', async () => {
    stubFetch(() => ({ embeddings: [[1, 0, 0, 0]] }));
    const adapter = new OllamaEmbeddingAdapter(silent as never, { dimensions: 4 });
    await adapter.init();
    await expect(adapter.embedPassages(['a', 'b'])).rejects.toThrow(/2 inputs/);
  });
});
