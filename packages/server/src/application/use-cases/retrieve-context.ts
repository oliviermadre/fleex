import type { TicketSummaryRef } from '@fleex/shared';
import type { ConfigPort } from '../ports/config.port.js';
import type { EmbeddingProviderPort } from '../ports/embedding-provider.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MemorySearchFilters, MemoryStorePort } from '../ports/memory-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';
import { embeddableText } from '../memory/chunker.js';
import { rankHits, type ScoredHit } from '../memory/scoring.js';
import type { GetRelevantSummariesUseCase } from './get-relevant-summaries.js';

/** Default number of memory chunks returned for a prompt injection. */
const DEFAULT_LIMIT = 8;

/** Default character budget for the injected snippets. */
const DEFAULT_CHAR_BUDGET = 10_000;

/** One retrieved piece of memory, ready to be injected and attributed. */
export interface MemorySnippet {
  sourceKind: MemorySourceKind;
  sourceId: string;
  /** Breadcrumb: `Ticket #42: Fix login > Solution`. */
  title: string;
  content: string;
  /** Hybrid score that selected it — surfaced so the choice is auditable. */
  score: number;
  ticketId?: string | null;
  repo?: string | null;
  updatedAt?: string | null;
}

export interface RetrieveContextResult {
  /** Which engine produced this result — recorded on the execution. */
  engine: 'legacy' | 'semantic';
  /**
   * Ticket summaries in the legacy shape. Always populated, whichever engine
   * ran, so the existing prompt section keeps working untouched.
   */
  summaries: TicketSummaryRef[];
  /** Everything beyond summaries. Empty under the legacy engine. */
  snippets: MemorySnippet[];
}

/**
 * Chooses and runs the retrieval strategy for prompt injection.
 *
 * The two engines live behind one call so the switch is a config read rather
 * than a wiring change: `legacy` delegates verbatim to the ranking that shipped
 * before, and `semantic` retrieves across the whole index. Anything that can go
 * wrong on the semantic path — no index yet, model still downloading, provider
 * missing — falls back to `legacy` rather than degrading the prompt, because a
 * run must never get *less* context than it would have had before the beta
 * existed.
 */
export class RetrieveContextUseCase {
  constructor(
    private readonly config: ConfigPort,
    private readonly getRelevantSummaries: GetRelevantSummariesUseCase,
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
    private readonly memoryStore?: MemoryStorePort,
    private readonly embeddings?: EmbeddingProviderPort,
  ) {}

  /** True when the semantic engine is selected AND actually usable. */
  isSemanticEnabled(): boolean {
    return this.config.get().memoryEngine === 'semantic' && !!this.memoryStore && !!this.embeddings;
  }

  async execute(params: {
    ticketId?: string;
    /** Free text. Derived from the ticket when omitted. */
    query?: string;
    limit?: number;
    kinds?: MemorySourceKind[];
    repo?: string | null;
  }): Promise<RetrieveContextResult> {
    if (!this.isSemanticEnabled()) {
      return { engine: 'legacy', summaries: await this.legacySummaries(params.ticketId), snippets: [] };
    }

    try {
      const semantic = await this.semantic(params);
      // An index that is empty or still embedding would silently starve the
      // prompt; fall back so the beta is never worse than the default.
      if (semantic.summaries.length === 0 && semantic.snippets.length === 0) {
        return { engine: 'legacy', summaries: await this.legacySummaries(params.ticketId), snippets: [] };
      }
      return semantic;
    } catch (error) {
      this.logger.warn('Semantic retrieval failed, falling back to legacy ranking', {
        error: error instanceof Error ? error.message : String(error),
        ticketId: params.ticketId ?? null,
      });
      return { engine: 'legacy', summaries: await this.legacySummaries(params.ticketId), snippets: [] };
    }
  }

  /** The pre-existing ranking, unchanged and still the default. */
  private async legacySummaries(ticketId?: string): Promise<TicketSummaryRef[]> {
    if (!ticketId) return [];
    try {
      return await this.getRelevantSummaries.execute({ ticketId });
    } catch {
      // Non-critical: a run without related summaries is fine, a failed run is not.
      return [];
    }
  }

  private async semantic(params: {
    ticketId?: string;
    query?: string;
    limit?: number;
    kinds?: MemorySourceKind[];
    repo?: string | null;
  }): Promise<RetrieveContextResult> {
    const store = this.memoryStore!;
    const embeddings = this.embeddings!;
    const limit = params.limit ?? DEFAULT_LIMIT;

    const anchor = params.ticketId ? await this.ticketStore.getTicketById(params.ticketId) : null;
    const queryText = params.query ?? (anchor
      ? embeddableText({ title: anchor.title, content: anchor.description ?? '' })
      : '');
    if (!queryText.trim()) return { engine: 'semantic', summaries: [], snippets: [] };

    const filters: MemorySearchFilters = {
      kinds: params.kinds,
      repo: params.repo ?? null,
      excludeTicketId: params.ticketId ?? null,
    };

    const queryVector = await embeddings.embedQuery(queryText);
    // Over-fetch: ranking re-orders on the structural signals and drops chunks to
    // the per-source cap, so the vector stage must offer more than the final cut.
    const candidates = await store.search(queryVector, filters, limit * 4);

    const ranked = rankHits(candidates, {
      tags: anchor?.tags ?? [],
      boardId: anchor?.boardId ?? null,
      repo: params.repo ?? null,
    }, limit);

    return {
      engine: 'semantic',
      summaries: this.toSummaryRefs(ranked),
      snippets: this.toSnippets(ranked),
    };
  }

  /**
   * Map the summary-kind hits onto the legacy `TicketSummaryRef` shape.
   *
   * Keeping the existing prompt section fed from the new engine is what makes the
   * switch invisible to the prompt template: the "Related Ticket Summaries"
   * heading still receives summaries, just better chosen ones.
   */
  private toSummaryRefs(hits: ScoredHit[]): TicketSummaryRef[] {
    const out: TicketSummaryRef[] = [];
    for (const hit of hits) {
      if (hit.chunk.sourceKind !== 'ticket_summary') continue;
      out.push({
        ticketId: hit.chunk.metadata.ticketId ?? hit.chunk.sourceId,
        ticketTitle: hit.chunk.title,
        // The chunk does not carry the ticket's live status; `done` is the only
        // status a ticket summary is ever written for.
        ticketStatus: 'done',
        content: hit.chunk.content,
        updatedAt: (hit.chunk.sourceUpdatedAt ?? hit.chunk.updatedAt).toISOString(),
      });
    }
    return out;
  }

  /** Non-summary hits, trimmed to the configured character budget. */
  private toSnippets(hits: ScoredHit[]): MemorySnippet[] {
    const budget = this.config.get().memoryInjectionCharBudget ?? DEFAULT_CHAR_BUDGET;
    const out: MemorySnippet[] = [];
    let used = 0;

    for (const hit of hits) {
      if (hit.chunk.sourceKind === 'ticket_summary') continue;
      if (used + hit.chunk.content.length > budget) continue;
      used += hit.chunk.content.length;
      out.push({
        sourceKind: hit.chunk.sourceKind,
        sourceId: hit.chunk.sourceId,
        title: hit.chunk.title,
        content: hit.chunk.content,
        score: hit.score,
        ticketId: hit.chunk.metadata.ticketId ?? null,
        repo: hit.chunk.metadata.repo ?? null,
        updatedAt: hit.chunk.sourceUpdatedAt?.toISOString() ?? null,
      });
    }
    return out;
  }
}
