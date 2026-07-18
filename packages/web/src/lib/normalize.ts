/**
 * Accent- and case-insensitive fold for search matching, so "Prépare" matches
 * a query of "prepare" and vice-versa. Shared by every local search box that
 * wants diacritic-insensitive filtering (launcher, Primitives sidebar…).
 */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
