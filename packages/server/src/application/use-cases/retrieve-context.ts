import type { TicketSummaryRef } from '@fleex/shared';
import { isMemoryFeatureEnabled, type ConfigPort, type MemoryFeatureFlags } from '../ports/config.port.js';
import type { EmbeddingProviderPort } from '../ports/embedding-provider.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MemorySearchFilters, MemoryStorePort } from '../ports/memory-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { MemoryChunkEntity, MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';
import { embeddableText } from '../memory/chunker.js';
import { rankHits, type ScoredHit } from '../memory/scoring.js';
import type { GetRelevantSummariesUseCase } from './get-relevant-summaries.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';

/** Default number of memory chunks returned for a prompt injection. */
const DEFAULT_LIMIT = 8;

/**
 * Candidate multiplier when the caller wants one row per object.
 *
 * Deliberately wide: the winners are chosen per source, so the pre-fetch has to
 * contain enough *different* sources to choose from, and a single document can
 * contribute fifty chunks.
 */
const DIVERSE_OVER_FETCH = 20;

/** Ceiling on the pre-fetch, so a large `limit` cannot ask for the whole index. */
const MAX_OVER_FETCH = 500;

/**
 * How many of the best-ranked documents get reassembled in full.
 *
 * Three, because an answer usually rests on one document with a couple of others
 * corroborating it, and because every chunk added here displaces evidence from
 * somewhere else.
 */
const EXPAND_TOP_SOURCES = 3;

/**
 * Above this many chunks, a source is a transcript rather than a document.
 *
 * Eight covers the documents people actually ask about — a live corpus put its
 * OKR document at four — while leaving a ninety-four-chunk meeting transcript to
 * contribute only the passages that matched.
 */
const EXPAND_MAX_CHUNKS = 8;

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
  /**
   * What the semantic engine would have retrieved, when shadow mode is on and
   * legacy is the engine actually feeding the prompt. Never injected.
   */
  shadowSnippets?: MemorySnippet[];
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

  /** Character ceiling on what goes into a prompt. Never applied to a list. */
  private injectionBudget(): number {
    return this.config.get().memoryInjectionCharBudget ?? DEFAULT_CHAR_BUDGET;
  }

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
      return {
        engine: 'legacy',
        summaries: await this.legacySummaries(params.ticketId),
        snippets: [],
        shadowSnippets: await this.shadow(params),
      };
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
    /** Keep only the best-scoring chunk of each source. */
    oneChunkPerSource?: boolean;
    /**
     * Reassemble the best-ranked documents in full instead of passing the two
     * passages that matched. For answering a question about a document.
     */
    expandSources?: boolean;
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
      // Only vectors from the model that is answering. A superseded encoder's
      // vectors live in another space, so their distance to this query is a
      // meaningless number that would still sort into the results.
      embeddingModel: embeddings.id,
    };

    const queryVector = await embeddings.embedQuery(query);
    // The pre-fetch is measured in chunks, and a large document brings dozens of
    // them: on a live instance the top 48 chunks for one query all belonged to five
    // documents, so nothing else — including the ticket those documents hang off —
    // could reach the ranker. A list of distinct objects therefore has to look much
    // deeper than a list of passages.
    const overFetch = params.oneChunkPerSource
      ? Math.min(limit * DIVERSE_OVER_FETCH, MAX_OVER_FETCH)
      : limit * 4;
    const candidates = await store.search(queryVector, filters, overFetch);

    // A keyword pass alongside the vector one, because exact identifiers — error
    // codes, file paths, record ids — are precisely what embeddings blur away, and
    // a search box is where a user types them.
    const keywordHits = await this.keywordPass(query, filters, limit);
    const bySource = new Map(candidates.map((c) => [c.chunk.id, c]));
    for (const chunk of keywordHits) {
      if (!bySource.has(chunk.id)) {
        // Slot keyword-only matches in below the vector hits rather than above:
        // a substring match is weaker evidence than semantic proximity.
        bySource.set(chunk.id, { chunk, similarity: 0 });
      }
    }

    // A surface that lists *references* wants one row per thing. Applied as the
    // ranker's per-source cap rather than as a filter afterwards: filtering spent
    // the limit on two passages of each document and then discarded one, so a
    // request for twelve results came back with five.
    const ranked = rankHits([...bySource.values()], {
      repo: params.repo ?? null,
      boostHumanFeedback: this.isFeatureEnabled('humanFeedbackBoost'),
      // Lets the title match break the near-ties that cosine leaves behind on a
      // corpus dominated by meeting transcripts.
      query,
    }, limit, params.oneChunkPerSource ? 1 : undefined);

    const hits = params.expandSources ? await this.expand(ranked) : ranked;
    return this.toSnippets(hits, { includeSummaries: true });
  }

  /**
   * The exact-match pass, run only where it can pay for itself.
   *
   * A substring search with a leading wildcard cannot use an index, so it reads
   * the whole table — fine at 500 ms while Postgres has those rows cached, and a
   * cancelled statement when it does not. A question asked in prose could never
   * have earned that cost anyway: no document contains the literal text "les
   * routines c'est quoi ?", so the scan was guaranteed to return nothing. What
   * this pass is for is the identifier embeddings blur away, and an identifier is
   * one token.
   *
   * A failure here is logged and swallowed. Vector search has already succeeded by
   * this point, and letting an optional enrichment turn a good answer into a 500
   * is the wrong trade every time — which is exactly what it did.
   */
  private async keywordPass(
    query: string,
    filters: MemorySearchFilters,
    limit: number,
  ): Promise<MemoryChunkEntity[]> {
    if (/\s/.test(query)) return [];
    try {
      return await this.memoryStore!.searchKeyword(query, filters, limit);
    } catch (error) {
      this.logger.warn('Keyword pass skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Replace the matched passages of the best documents with the whole document.
   *
   * Search finds passages; a question is usually about a document. Measured on a
   * live corpus: asked for the quarter's OKRs, retrieval returned two of the OKR
   * document's four chunks and the answer covered one of its three objectives —
   * the model cited everything it was given, and the other two objectives had
   * never left the index.
   *
   * Only short documents are reassembled. A source running past
   * `EXPAND_MAX_CHUNKS` is a meeting transcript or a log, not a document someone
   * asked about; pasting ninety chunks of it would bury the answer it was meant to
   * support. Detected by asking for one chunk more than the cap, so the decision
   * costs no extra round trip.
   */
  private async expand(ranked: ScoredHit[]): Promise<ScoredHit[]> {
    const store = this.memoryStore!;
    const order: string[] = [];
    const groups = new Map<string, ScoredHit[]>();
    for (const hit of ranked) {
      const key = `${hit.chunk.sourceKind}:${hit.chunk.sourceId}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(hit);
    }

    for (const key of order.slice(0, EXPAND_TOP_SOURCES)) {
      const group = groups.get(key)!;
      const best = group[0]!;
      let whole: MemoryChunkEntity[];
      try {
        whole = await store.chunksBySource(
          best.chunk.sourceKind,
          best.chunk.sourceId,
          EXPAND_MAX_CHUNKS + 1,
        );
      } catch (error) {
        // A document read failing must not cost the caller its search results.
        this.logger.warn('Memory source expansion failed', {
          sourceId: best.chunk.sourceId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (whole.length > EXPAND_MAX_CHUNKS || whole.length <= group.length) continue;

      // Every chunk carries the document's best score, so the group keeps the rank
      // its strongest passage earned rather than sinking on its weakest.
      groups.set(key, whole.map((chunk) => ({ chunk, similarity: best.similarity, score: best.score })));
    }

    return order.flatMap((key) => groups.get(key)!);
  }

  /**
   * What the semantic engine would have injected, for a run the legacy engine is
   * feeding.
   *
   * Best-effort and silent on failure: this is an observation, so a shadow that
   * cannot be computed must not affect — or even be visible to — the run it is
   * observing.
   */
  private async shadow(params: {
    ticketId?: string;
    query?: string;
    limit?: number;
    kinds?: MemorySourceKind[];
    repo?: string | null;
  }): Promise<MemorySnippet[] | undefined> {
    if (!this.config.get().memoryShadowMode) return undefined;
    if (!this.memoryStore || !this.embeddings) return undefined;

    try {
      const result = await this.semantic(params);
      // Summaries too: under the semantic engine they would have been chosen
      // differently, and a comparison that hides that is not a comparison.
      return [
        ...result.snippets,
        ...result.summaries.map((summary) => ({
          sourceKind: 'ticket_summary' as MemorySourceKind,
          sourceId: summary.ticketId,
          title: summary.ticketTitle,
          content: summary.content,
          score: 0,
          ticketId: summary.ticketId,
          updatedAt: summary.updatedAt,
        })),
      ];
    } catch {
      return undefined;
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
      embeddingModel: embeddings.id,
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
      snippets: this.toSnippets(ranked, { budget: this.injectionBudget() }),
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
   * Hits as snippets.
   *
   * `includeSummaries` separates the two callers: prompt injection routes
   * summaries into their own long-standing section and must not duplicate them
   * here, whereas a search result would be strange for omitting the very
   * summaries that best answer the query.
   *
   * `budget` applies to injection only. Sharing it with search made a list silently
   * shorter than asked for — thirty requested, nine returned — and made any chunk
   * larger than the whole budget permanently unreachable, which is what ticket
   * summaries are: stored unsplit, and routinely longer than 10 000 characters. A
   * list of references is bounded by its count; only a prompt is bounded by size.
   */
  private toSnippets(
    hits: ScoredHit[],
    opts: { includeSummaries?: boolean; budget?: number } = {},
  ): MemorySnippet[] {
    const budget = opts.budget ?? Infinity;
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
