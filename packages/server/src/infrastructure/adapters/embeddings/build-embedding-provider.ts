import { resolveEmbeddingModel } from '@fleex/shared';
import type { ConfigPort } from '../../../application/ports/config.port.js';
import type { EmbeddingProviderPort } from '../../../application/ports/embedding-provider.port.js';
import type { LoggerPort } from '../../../application/ports/logger.port.js';
import { OllamaEmbeddingAdapter } from './ollama-embedding.adapter.js';
import { TransformersEmbeddingAdapter } from './transformers-embedding.adapter.js';

/**
 * A provider that can also say whether its backing runtime is present at all.
 *
 * "Installed" and "ready" are different questions with different answers for the
 * user — install a package or start a daemon, versus wait for a download — and the
 * status endpoint reports both.
 */
export interface InstallablEmbeddingProvider extends EmbeddingProviderPort {
  isInstalled(): Promise<boolean>;
  /** What is missing when it is not installed. */
  readonly runtimeLabel: string;
}

/**
 * Build the configured embedding provider.
 *
 * Read once at boot rather than per call: changing the encoder changes the vector
 * space, so it has to be a deliberate restart-scoped decision rather than
 * something that can shift under an in-flight backfill. The sweep migrates the
 * index afterwards, so the restart is the only manual step.
 */
export function buildEmbeddingProvider(
  config: ConfigPort,
  logger: LoggerPort,
): InstallablEmbeddingProvider {
  const settings = config.get();
  const spec = resolveEmbeddingModel(settings.memoryEmbeddingModel);

  if (settings.memoryEmbeddingProvider === 'ollama') {
    const adapter = new OllamaEmbeddingAdapter(logger, {
      // The catalogue's width still governs, so the Supabase column and the
      // daemon agree on how wide a vector is.
      dimensions: spec.dimensions,
    });
    return Object.assign(adapter, { runtimeLabel: OllamaEmbeddingAdapter.PACKAGE_NAME });
  }

  const adapter = new TransformersEmbeddingAdapter(logger, { model: spec.id });
  return Object.assign(adapter, { runtimeLabel: TransformersEmbeddingAdapter.PACKAGE_NAME });
}
