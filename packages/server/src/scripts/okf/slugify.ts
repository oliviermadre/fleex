/**
 * Deterministic slugification for OKF concept filenames.
 *
 * Algorithm (see spec §7.2):
 *   NFKD → strip diacritics → lowercase → replace every run of
 *   non-[a-z0-9] with '-' → trim leading/trailing '-' → collapse '--' →
 *   truncate to 60 chars (without leaving a trailing '-').
 *
 * Pure & total: identical input always yields identical output.
 */
export function slugify(input: string): string {
  const base = (input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (base.length <= 60) return base;
  return base.slice(0, 60).replace(/-+$/g, '');
}

/** slugify with a fallback when the result would be empty. */
export function slugifyOr(input: string, fallback = 'untitled'): string {
  const s = slugify(input);
  return s.length > 0 ? s : fallback;
}

/**
 * Assign collision-free slugs to a set of entities.
 *
 * If two or more entities share the same base slug, *all* of them are
 * disambiguated by appending `-<first 8 chars of id>`. This makes the
 * outcome independent of iteration order (a winner-takes-the-bare-slug
 * scheme would depend on sort order), so it stays deterministic.
 *
 * Returns a map of entity id → final slug.
 */
export function assignSlugs<T>(
  items: readonly T[],
  getId: (t: T) => string,
  getBase: (t: T) => string,
): Map<string, string> {
  const baseById = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const item of items) {
    const base = slugifyOr(getBase(item));
    baseById.set(getId(item), base);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const item of items) {
    const id = getId(item);
    const base = baseById.get(id)!;
    const final = (counts.get(base) ?? 0) > 1 ? `${base}-${id.slice(0, 8)}` : base;
    result.set(id, final);
  }
  return result;
}
