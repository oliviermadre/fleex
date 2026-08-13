import { createHash } from 'node:crypto';
import type { EmbeddingProviderPort } from '../../src/application/ports/embedding-provider.port.js';

/**
 * Deterministic stand-in for the real encoder.
 *
 * Vectors are derived from the words in the text, so texts that share
 * vocabulary land close together and unrelated texts do not. That is enough to
 * assert retrieval *plumbing* — ordering, filtering, the per-source cap — with
 * no model download, no network, and no run-to-run variation. It says nothing
 * about retrieval quality, which is what the eval harness is for.
 */
export class FakeEmbeddingProvider implements EmbeddingProviderPort {
  readonly id = 'fake:hash-bag-of-words';
  private ready = false;
  private embedCalls = 0;

  constructor(readonly dimensions = 16) {}

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    this.embedCalls += texts.length;
    return texts.map((t) => this.vectorFor(t));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return this.vectorFor(text);
  }

  /** How many passages have been embedded — lets a test assert re-embed counts. */
  getEmbedCallCount(): number {
    return this.embedCalls;
  }

  resetEmbedCallCount(): void {
    this.embedCalls = 0;
  }

  /**
   * Hash each word into a bucket and L2-normalise the result, mirroring what the
   * real provider returns (normalised vectors) so cosine behaves the same.
   */
  private vectorFor(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

    for (const word of words) {
      const digest = createHash('sha256').update(word).digest();
      const bucket = digest.readUInt32BE(0) % this.dimensions;
      vector[bucket] = (vector[bucket] ?? 0) + 1;
    }

    let norm = 0;
    for (const value of vector) norm += value * value;
    if (norm === 0) return vector;
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! * inv;
    return vector;
  }
}
