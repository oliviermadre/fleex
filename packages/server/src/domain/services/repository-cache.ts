interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  staleAt: number;
}

export class RepositoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  // TTLs in ms
  static readonly TTL_PULLS = 2 * 60 * 1000;
  static readonly TTL_ISSUES = 5 * 60 * 1000;
  static readonly TTL_MERGED = 5 * 60 * 1000;
  static readonly TTL_DIFF_STATS = 3 * 60 * 1000;
  static readonly TTL_REPO_LIST = 30 * 60 * 1000;
  static readonly TTL_USER = 60 * 60 * 1000;
  static readonly TTL_SUMMARY = 2 * 60 * 1000;

  // Stale window = TTL * 2 (serve stale data while revalidating)
  private staleMultiplier = 2;

  get<T>(key: string): { data: T; stale: boolean } | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return {
      data: entry.data,
      stale: now > entry.staleAt,
    };
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    const now = Date.now();
    this.store.set(key, {
      data,
      staleAt: now + ttlMs,
      expiresAt: now + ttlMs * this.staleMultiplier,
    });
  }

  invalidate(pattern: string): void {
    if (pattern.includes('*')) {
      const prefix = pattern.replace('*', '');
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix) || key.endsWith(prefix.replace(':', ''))) {
          this.store.delete(key);
        }
      }
    } else {
      this.store.delete(pattern);
    }
  }

  invalidateRepo(org: string, name: string): void {
    const suffix = `${org}/${name}`;
    for (const key of this.store.keys()) {
      if (key.endsWith(suffix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
