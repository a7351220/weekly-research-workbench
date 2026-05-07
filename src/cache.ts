import type { CacheStore } from "./types";

interface MemoryCacheEntry {
  value: string;
  expiresAt: number | null;
}

export class InMemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, MemoryCacheEntry>();

  async get(key: string, type: "json"): Promise<unknown | null>;
  async get(key: string, type?: "text"): Promise<string | null>;
  async get(key: string, type: "json" | "text" = "text"): Promise<unknown | string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    if (type === "json") {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }

    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttlMs =
      options?.expirationTtl && options.expirationTtl > 0
        ? options.expirationTtl * 1000
        : null;

    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }
}
