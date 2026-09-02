/**
 * The local encoders the semantic memory engine can be pointed at.
 *
 * A catalogue rather than a free-text setting, because a model id alone is not
 * enough to use one correctly: the vector width has to match the column the
 * database created, and every family expects its own prefixes on stored text and
 * on queries. Getting a prefix wrong costs a large slice of retrieval quality and
 * raises no error at all — the only symptom is worse answers — so the convention
 * belongs next to the id, not in the caller.
 *
 * Shared because three places need the same list: the server builds the provider
 * from it, Settings renders it, and the Supabase adapter sizes its vector column
 * from the configured entry's width.
 */

export interface EmbeddingModelSpec {
  /** Hugging Face repo id, as transformers.js resolves it. */
  id: string;
  /** Short name for the UI. */
  label: string;
  /** Vector width. Determines the Supabase column type. */
  dimensions: number;
  /** Approximate on-disk size of the quantised weights, in megabytes. */
  sizeMb: number;
  /** Prepended to stored text before embedding. */
  passagePrefix: string;
  /** Prepended to a query before embedding. */
  queryPrefix: string;
  /** One line on what this trades for what. */
  note: string;
  /** True for the model an instance gets when nothing is configured. */
  default?: boolean;
}

/**
 * Ordered cheapest-first, which is also best-default-first.
 *
 * All three are multilingual: a Fleex corpus mixes French and English in the same
 * ticket, so an English-only encoder — however well it scores on English
 * benchmarks — would degrade half the content.
 */
export const EMBEDDING_MODELS: readonly EmbeddingModelSpec[] = [
  {
    id: 'Xenova/multilingual-e5-small',
    label: 'multilingual-e5-small',
    dimensions: 384,
    sizeMb: 112,
    // The e5 family is asymmetric: stored text and queries carry different
    // prefixes, and omitting them is the single most common way to make this
    // family look mediocre.
    passagePrefix: 'passage: ',
    queryPrefix: 'query: ',
    note: 'Best quality per megabyte and per millisecond of CPU. The default.',
    default: true,
  },
  {
    id: 'Xenova/multilingual-e5-base',
    label: 'multilingual-e5-base',
    dimensions: 768,
    sizeMb: 280,
    passagePrefix: 'passage: ',
    queryPrefix: 'query: ',
    note: 'Same family, twice the width. Noticeably better on long, technical text; ~3× the CPU.',
  },
  {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    label: 'EmbeddingGemma-300M',
    dimensions: 768,
    sizeMb: 300,
    // Gemma's own retrieval template. The document side names a title even when
    // there is none — that is the format it was trained on.
    passagePrefix: 'title: none | text: ',
    queryPrefix: 'task: search result | query: ',
    note: 'Strongest of the three on retrieval benchmarks. Slowest on CPU.',
  },
];

/** The model used when nothing is configured. */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelSpec =
  EMBEDDING_MODELS.find((m) => m.default) ?? EMBEDDING_MODELS[0]!;

/**
 * Look up a configured model id, falling back to the default.
 *
 * Falls back rather than throwing: a config file naming a model that has since
 * been removed from the catalogue must not stop an instance from booting, and the
 * only sensible substitute is the default — vectors record which model produced
 * them, so the mismatch is detected and repaired by the sweep rather than mixed
 * into the ranking.
 */
export function resolveEmbeddingModel(id?: string | null): EmbeddingModelSpec {
  if (!id) return DEFAULT_EMBEDDING_MODEL;
  return EMBEDDING_MODELS.find((m) => m.id === id) ?? DEFAULT_EMBEDDING_MODEL;
}
