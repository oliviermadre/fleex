import type { TicketSummaryRef } from '@fleex/shared';
import { isMemoryFeatureEnabled, type ConfigPort, type MemoryFeatureFlags } from '../ports/config.port.js';
import type { EmbeddingProviderPort } from '../ports/embedding-provider.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MemorySearchFilters, MemoryStorePort } from '../ports/memory-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';
import { embeddableText } from '../memory/chunker.js';
import { rankHits, type ScoredHit } from '../memory/scoring.js';
import type { GetRelevantSummariesUseCase } from './get-relevant-summaries.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';

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
  /**
   * Scoring tags carried by the chunk. Exposed so consumers can select on them —
   * the persona coach needs the threads actually tagged as corrections, and a
   * content heuristic would be guesswork.
   */
  tags?: string[];
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

  /** True when a memory-dependent feature is both switched on and usable. */
  isFeatureEnabled(feature: keyof MemoryFeatureFlags): boolean {
    return this.isSemanticEnabled() && isMemoryFeatureEnabled(this.config.get(), feature);
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

  /**
   * Free-text retrieval, for surfaces that search rather than inject: the CLI,
   * the command palette, the question-answering path.
   *
   * Unlike `execute`, this never falls back to the legacy ranking — that ranking
   * only knows how to answer "what relates to this ticket", which is not a
   * search. An empty result is the honest answer when the index has nothing.
   */
  async search(params: {
    query: string;
    limit?: number;
    kinds?: MemorySourceKind[];
    repo?: string | null;
    excludeTicketId?: string | null;
  }): Promise<MemorySnippet[]> {
    if (!this.isSemanticEnabled()) return [];
    const query = params.query.trim();
    if (!query) return [];

    const store = this.memoryStore!;
    const embeddings = this.embeddings!;
    const limit = params.limit ?? DEFAULT_LIMIT;
    const filters: MemorySearchFilters = {
      kinds: params.kinds,
      repo: params.repo ?? null,
      excludeTicketId: params.excludeTicketId ?? null,
    };

    const queryVector = await embeddings.embedQuery(query);
    const candidates = await store.search(queryVector, filters, limit * 4);

    // A keyword pass alongside the vector one, because exact identifiers — error
    // codes, file paths — are precisely what embeddings blur away, and a search
    // box is where a user types them.
    const keywordHits = await store.searchKeyword(query, filters, limit);
    const bySource = new Map(candidates.map((c) => [c.chunk.id, c]));
    for (const chunk of keywordHits) {
      if (!bySource.has(chunk.id)) {
        // Slot keyword-only matches in below the vector hits rather than above:
        // a substring match is weaker evidence than semantic proximity.
        bySource.set(chunk.id, { chunk, similarity: 0 });
      }
    }

    const ranked = rankHits([...bySource.values()], {
      repo: params.repo ?? null,
      boostHumanFeedback: this.isFeatureEnabled('humanFeedbackBoost'),
    }, limit);
    return this.toSnippets(ranked, { includeSummaries: true });
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

    // Repo affinity, when enabled, is applied as a *boost* rather than a filter:
    // the conventions and pitfalls of the repo an agent is working in should
    // outrank equally similar material from elsewhere, but excluding everything
    // else would hide the cross-repo decision that explains why the code is the
    // way it is. An explicit `repo` from the caller still filters.
    const anchorRepo = this.isFeatureEnabled('repoScope') ? primaryRepo(anchor) : null;

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
      repo: params.repo ?? anchorRepo,
      boostHumanFeedback: this.isFeatureEnabled('humanFeedbackBoost'),
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

  /**
   * Hits as snippets, trimmed to the configured character budget.
   *
   * `includeSummaries` separates the two callers: prompt injection routes
   * summaries into their own long-standing section and must not duplicate them
   * here, whereas a search result would be strange for omitting the very
   * summaries that best answer the query.
   */
  private toSnippets(hits: ScoredHit[], opts: { includeSummaries?: boolean } = {}): MemorySnippet[] {
    const budget = this.config.get().memoryInjectionCharBudget ?? DEFAULT_CHAR_BUDGET;
    const out: MemorySnippet[] = [];
    let used = 0;

    for (const hit of hits) {
      if (!opts.includeSummaries && hit.chunk.sourceKind === 'ticket_summary') continue;
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
        tags: hit.chunk.metadata.tags ?? [],
      });
    }
    return out;
  }
}

/**
 * First linked repository of a ticket — its repo affinity for scoring.
 *
 * Guards against a ticket with no `links` array. Not hypothetical bookkeeping: a
 * throw here is swallowed by the caller's fallback, which would silently drop the
 * whole run back to the legacy ranking with nothing to show why.
 */
function primaryRepo(ticket: TicketEntity | null): string | null {
  return ticket?.links?.find((l) => l.type === 'repository')?.ref ?? null;
}
