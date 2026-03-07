export interface KvStorePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listByPrefix(prefix: string): Promise<{ key: string; value: string }[]>;
}
