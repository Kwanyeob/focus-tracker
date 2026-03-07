import type { EmbeddingService } from "./embeddingService";

// ---------------------------------------------------------------------------
// Minimal LRU cache (Map preserves insertion order in V8)
// ---------------------------------------------------------------------------
class LRUCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    // Refresh recency: delete + re-insert
    const val = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      // Evict least-recently-used (first inserted entry)
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// EmbeddingServiceImpl
// ---------------------------------------------------------------------------
const DEFAULT_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

interface EmbeddingServiceOptions {
  cacheSize?: number;
  modelId?: string;
}

export class EmbeddingServiceImpl implements EmbeddingService {
  private pipe: ((text: string, opts: object) => Promise<{ data: Float32Array }>) | null = null;
  private readonly cache: LRUCache<string, number[]>;
  private readonly modelId: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: EmbeddingServiceOptions | number = {}) {
    const normalizedOptions =
      typeof options === "number"
        ? { cacheSize: options }
        : options;

    const cacheSize = normalizedOptions.cacheSize ?? 5000;
    this.modelId = normalizedOptions.modelId ?? DEFAULT_MODEL_ID;
    this.cache = new LRUCache<string, number[]>(cacheSize);
  }

  async init(): Promise<void> {
    // Singleton-safe: concurrent calls share the same promise.
    // On failure the promise is cleared so the next call can retry.
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._load().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async _load(): Promise<void> {
    // Dynamic import keeps transformers.js optional at compile time
    const { pipeline } = await import("@xenova/transformers");
    this.pipe = await pipeline("feature-extraction", this.modelId, {
      quantized: true,
    }) as unknown as (text: string, opts: object) => Promise<{ data: Float32Array }>;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.pipe) throw new Error("EmbeddingService not initialised — call init() first");

    const key = text.trim();

    const cached = this.cache.get(key);
    if (cached) return cached;

    const output = await this.pipe(key, { pooling: "mean", normalize: true });
    const vector = Array.from(output.data) as number[];

    this.cache.set(key, vector);
    return vector;
  }

  async shutdown(): Promise<void> {
    this.pipe = null;
    this.initPromise = null;
    this.cache.clear();
  }
}
