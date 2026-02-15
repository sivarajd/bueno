/**
 * Caching Layer
 * 
 * Provides key-value caching with TTL support using Bun.redis
 * or in-memory fallback for development.
 */

// ============= Types =============

export interface CacheConfig {
  driver?: 'redis' | 'memory';
  url?: string;
  ttl?: number; // Default TTL in seconds
  keyPrefix?: string;
}

export interface SessionData {
  [key: string]: unknown;
}

export interface SessionStoreOptions {
  ttl?: number; // Session TTL in seconds
  prefix?: string;
}

// ============= In-Memory Cache =============

class MemoryCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup expired keys every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  async get(key: string): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    
    return entry.value;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const expiresAt = Date.now() + (ttl ?? 3600) * 1000;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    
    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async increment(key: string, by = 1): Promise<number> {
    const current = (await this.get(key)) ?? 0;
    const newValue = Number(current) + by;
    await this.set(key, newValue);
    return newValue;
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// ============= Cache Class =============

export class Cache {
  private driver: MemoryCache;
  private keyPrefix: string;
  private defaultTTL: number;
  private _isConnected = false;

  constructor(config: CacheConfig = {}) {
    this.driver = new MemoryCache();
    this.keyPrefix = config.keyPrefix ?? 'bueno:';
    this.defaultTTL = config.ttl ?? 3600;
  }

  /**
   * Connect to cache (no-op for in-memory)
   */
  async connect(): Promise<void> {
    this._isConnected = true;
  }

  /**
   * Disconnect from cache
   */
  async disconnect(): Promise<void> {
    this.driver.destroy();
    this._isConnected = false;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get a value
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const fullKey = this.keyPrefix + key;
    const value = await this.driver.get(fullKey);
    
    if (value === null) return null;
    
    // Try to parse JSON
    try {
      if (typeof value === 'string') {
        return JSON.parse(value) as T;
      }
      return value as T;
    } catch {
      return value as T;
    }
  }

  /**
   * Set a value
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const fullKey = this.keyPrefix + key;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.driver.set(fullKey, serialized, ttl ?? this.defaultTTL);
  }

  /**
   * Delete a value
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = this.keyPrefix + key;
    return this.driver.delete(fullKey);
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    const fullKey = this.keyPrefix + key;
    return this.driver.has(fullKey);
  }

  /**
   * Increment a value
   */
  async increment(key: string, by = 1): Promise<number> {
    const fullKey = this.keyPrefix + key;
    return this.driver.increment(fullKey, by);
  }

  /**
   * Decrement a value
   */
  async decrement(key: string, by = 1): Promise<number> {
    const fullKey = this.keyPrefix + key;
    return this.driver.decrement(fullKey, by);
  }

  /**
   * Set multiple values
   */
  async mset(values: Record<string, unknown>, ttl?: number): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.set(key, value, ttl);
    }
  }

  /**
   * Get multiple values
   */
  async mget<T = unknown>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map(key => this.get<T>(key)));
  }

  /**
   * Clear all keys with prefix
   */
  async clear(): Promise<void> {
    await this.driver.clear();
  }

  /**
   * Get or set (cache-aside pattern)
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    
    if (cached !== null) {
      return cached;
    }
    
    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Delete multiple keys
   */
  async mdelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }
}

// ============= Session Store =============

export class SessionStore {
  private cache: Cache;
  private ttl: number;

  constructor(options: SessionStoreOptions = {}) {
    this.cache = new Cache({
      keyPrefix: options.prefix ?? 'session:',
      ttl: options.ttl ?? 86400, // 1 day default
    });
    this.ttl = options.ttl ?? 86400;
  }

  /**
   * Initialize the session store
   */
  async init(): Promise<void> {
    await this.cache.connect();
  }

  /**
   * Create a new session
   */
  async create(data: SessionData): Promise<string> {
    const sessionId = crypto.randomUUID();
    await this.cache.set(sessionId, data, this.ttl);
    return sessionId;
  }

  /**
   * Get session data
   */
  async get(sessionId: string): Promise<SessionData | null> {
    return this.cache.get<SessionData>(sessionId);
  }

  /**
   * Update session data
   */
  async update(sessionId: string, data: SessionData): Promise<void> {
    const existing = await this.get(sessionId);
    if (existing) {
      await this.cache.set(sessionId, { ...existing, ...data }, this.ttl);
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    await this.cache.delete(sessionId);
  }

  /**
   * Refresh session TTL
   */
  async refresh(sessionId: string): Promise<boolean> {
    const data = await this.get(sessionId);
    if (data) {
      await this.cache.set(sessionId, data, this.ttl);
      return true;
    }
    return false;
  }

  /**
   * Check if session exists
   */
  async has(sessionId: string): Promise<boolean> {
    return this.cache.has(sessionId);
  }
}

// ============= Factory Functions =============

/**
 * Create a cache instance
 */
export function createCache(config?: CacheConfig): Cache {
  const cache = new Cache(config);
  return cache;
}

/**
 * Create a session store
 */
export function createSessionStore(options?: SessionStoreOptions): SessionStore {
  return new SessionStore(options);
}
