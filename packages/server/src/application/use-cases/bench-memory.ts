import type { LoggerPort } from '../ports/logger.port.js';
import type { MemoryStorePort } from '../ports/memory-store.port.js';
import type { EmbeddingProviderPort } from '../ports/embedding-provider.port.js';
import {
  deriveCasesFromCorpus,
  firstRelevantRank,
  scoreOutcomes,
  type EvalCase,
  type EvalOutcome,
  type EvalReport,
} from '../memory/retrieval-eval.js';

/** Results returned per query. Also the K in recall@K. */
const DEFAULT_K = 5;

/** Cases to run. Enough to be indicative, few enough to finish in seconds. */
const DEFAULT_CASES = 30;

export interface BenchResult {
  /** Model the index was built with. */
  model: string;
  dimensions: number;
  report: EvalReport;
  /** Mean wall-clock per query, embedding included. */
  meanQueryMs: number;
  /** How much of the index the run covered. */
  indexedChunks: number;
  reason?: 'unavailable' | 'empty_index' | 'no_cases';
}

/**
 * Measures how well retrieval actually finds things on this corpus.
 *
 * The model choice was made from published benchmarks, which say nothing about a
 * particular workspace: a corpus of French tickets and English deliverables is not
 * the distribution MTEB measures. This is the check that settles it locally —
 * point the config at another model, reindex, run this again, compare.
 *
 * It measures the index as built, not the model in isolation. That is the useful
 * question: chunking, breadcrumbs and the hybrid score are all part of whether a
 * query finds its answer, and swapping the encoder while holding them fixed is
 * exactly the comparison a reader of this number wants to make.
 */
export class BenchMemoryUseCase {
  constructor(
    private readonly logger: LoggerPort,
    private readonly memoryStore?: MemoryStorePort,
    private readonly embeddings?: EmbeddingProviderPort,
  ) {}

  async execute(params: { cases?: number; k?: number } = {}): Promise<BenchResult> {
    const store = this.memoryStore;
    const provider = this.embeddings;
    const k = params.k ?? DEFAULT_K;

    const base: BenchResult = {
      model: provider?.id ?? 'none',
      dimensions: provider?.dimensions ?? 0,
      report: { cases: 0, recallAtK: 0, k, mrr: 0, misses: [] },
      meanQueryMs: 0,
      indexedChunks: 0,
    };

    if (!store || !provider) return { ...base, reason: 'unavailable' };

    const stats = await store.getStats();
    if (stats.totalChunks === 0) return { ...base, indexedChunks: 0, reason: 'empty_index' };

    const cases = await this.buildCases(store, params.cases ?? DEFAULT_CASES);
    if (cases.length === 0) {
      return { ...base, indexedChunks: stats.totalChunks, reason: 'no_cases' };
    }

    const outcomes: EvalOutcome[] = [];
    let totalMs = 0;

    for (const evalCase of cases) {
      const started = Date.now();
      const vector = await provider.embedQuery(evalCase.query);
      const hits = await store.search(vector, {}, k);
      totalMs += Date.now() - started;

      const returned = hits.map((hit) => hit.chunk.sourceId);
      outcomes.push({ ...evalCase, returned, firstRelevantRank: firstRelevantRank(returned, evalCase.expected) });
    }

    const report = scoreOutcomes(outcomes, k);
    this.logger.info('Memory bench complete', {
      model: provider.id, cases: report.cases, recallAtK: report.recallAtK, mrr: report.mrr,
    });

    return {
      model: provider.id,
      dimensions: provider.dimensions,
      report,
      meanQueryMs: Math.round(totalMs / cases.length),
      indexedChunks: stats.totalChunks,
    };
  }

  /**
   * Sample the index to build cases.
   *
   * Read through the keyword path with an empty-ish term because the port has no
   * "list rows" method by design — nothing else needs one, and adding it would
   * invite callers to page the corpus into memory.
   */
  private async buildCases(store: MemoryStorePort, limit: number): Promise<EvalCase[]> {
    // A single space matches nothing useful, so sample on a common letter instead:
    // any prose chunk contains an "e", and the LIKE path is cheap.
    const sample = await store.searchKeyword('e', {}, limit * 4);
    return deriveCasesFromCorpus(
      sample.map((chunk) => ({ sourceId: chunk.sourceId, title: chunk.title, content: chunk.content })),
      limit,
    );
  }
}
