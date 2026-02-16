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
  driver?: 'redis' | 'memory';
  url?: string;
}

export interface PubSubMessage {
  channel: string;
  message: string;
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

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());
    if (!pattern) return allKeys;
    
    // Simple glob pattern matching
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return allKeys.filter(k => regex.test(k));
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2; // Key doesn't exist
    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -1;
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttl * 1000;
    return true;
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

// ============= Redis Cache =============

class RedisCache {
  private client: unknown = null;
  private url: string;
  private _isConnected = false;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    try {
      // Try to use Bun.redis if available (Bun v1.2+)
      const bunModule = await import('bun').catch(() => null);
      
      if (bunModule && 'redis' in bunModule) {
        // Bun.redis is available
        // Note: The actual API depends on Bun version
        this.client = bunModule.redis;
        this._isConnected = true;
        return;
      }
      
      // Fallback: Use a simple TCP connection for Redis
      // This is a basic implementation - for production, use ioredis or similar
      throw new Error('Bun.redis not available. Install ioredis for Redis support.');
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && typeof (this.client as { close?: () => void }).close === 'function') {
      (this.client as { close: () => void }).close();
    }
    this._isConnected = false;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  private async sendCommand(command: string[]): Promise<unknown> {
    // Basic Redis protocol implementation
    // For production use, this should use a proper Redis client
    const client = this.client as {
      send?: (cmd: string[]) => Promise<unknown>;
      query?: (cmd: string) => Promise<unknown>;
    };
    
    if (client?.send) {
      return client.send(command);
    }
    
    if (client?.query) {
      return client.query(command.join(' '));
    }
    
    throw new Error('Redis client not properly initialized');
  }

  async get(key: string): Promise<unknown> {
    try {
      const result = await this.sendCommand(['GET', key]);
      return result;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    
    if (ttl) {
      await this.sendCommand(['SETEX', key, String(ttl), serialized]);
    } else {
      await this.sendCommand(['SET', key, serialized]);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.sendCommand(['DEL', key]);
    return Number(result) > 0;
  }

  async has(key: string): Promise<boolean> {
    const result = await this.sendCommand(['EXISTS', key]);
    return Number(result) > 0;
  }

  async clear(): Promise<void> {
    await this.sendCommand(['FLUSHDB']);
  }

  async increment(key: string, by = 1): Promise<number> {
    const result = await this.sendCommand(['INCRBY', key, String(by)]);
    return Number(result);
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by);
  }

  async keys(pattern: string): Promise<string[]> {
    const result = await this.sendCommand(['KEYS', pattern]);
    return Array.isArray(result) ? result : [];
  }

  async ttl(key: string): Promise<number> {
    const result = await this.sendCommand(['TTL', key]);
    return Number(result);
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const result = await this.sendCommand(['EXPIRE', key, String(ttl)]);
    return Number(result) === 1;
  }
}

// ============= Cache Driver Interface =============

interface CacheDriver {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  increment(key: string, by?: number): Promise<number>;
  decrement(key: string, by?: number): Promise<number>;
  keys?(pattern: string): Promise<string[]>;
  ttl?(key: string): Promise<number>;
  expire?(key: string, ttl: number): Promise<boolean>;
}

// ============= Cache Class =============

export class Cache {
  private driver: CacheDriver;
  private keyPrefix: string;
  private defaultTTL: number;
  private _isConnected = false;
  private driverType: 'redis' | 'memory';

  constructor(config: CacheConfig = {}) {
    this.driverType = config.driver ?? 'memory';
    this.keyPrefix = config.keyPrefix ?? 'bueno:';
    this.defaultTTL = config.ttl ?? 3600;

    if (this.driverType === 'redis' && config.url) {
      this.driver = new RedisCache(config.url);
    } else {
      this.driver = new MemoryCache();
    }
  }

  /**
   * Connect to cache
   */
  async connect(): Promise<void> {
    if ('connect' in this.driver && typeof this.driver.connect === 'function') {
      await (this.driver as RedisCache).connect();
    }
    this._isConnected = true;
  }

  /**
   * Disconnect from cache
   */
  async disconnect(): Promise<void> {
    if ('disconnect' in this.driver && typeof this.driver.disconnect === 'function') {
      await (this.driver as RedisCache).disconnect();
    } else if ('destroy' in this.driver && typeof this.driver.destroy === 'function') {
      (this.driver as MemoryCache).destroy();
    }
    this._isConnected = false;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get the driver type
   */
  getDriverType(): 'redis' | 'memory' {
    return this.driverType;
  }

  /**
   * Get a value
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const fullKey = this.keyPrefix + key;
    const value = await this.driver.get(fullKey);
    
    if (value === null || value === undefined) return null;
    
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
   * Get remaining TTL
   */
  async ttl(key: string): Promise<number> {
    const fullKey = this.keyPrefix + key;
    if (this.driver.ttl) {
      return this.driver.ttl(fullKey);
    }
    return -1;
  }

  /**
   * Set expiration on a key
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    const fullKey = this.keyPrefix + key;
    if (this.driver.expire) {
      return this.driver.expire(fullKey, ttl);
    }
    return false;
  }

  /**
   * Find keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const fullPattern = this.keyPrefix + pattern;
    if (this.driver.keys) {
      const keys = await this.driver.keys(fullPattern);
      // Remove prefix from returned keys
      return keys.map(k => k.startsWith(this.keyPrefix) ? k.slice(this.keyPrefix.length) : k);
    }
    return [];
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

  /**
   * Remember with lock (prevent cache stampede)
   */
  async remember<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
    lockTimeout = 10
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Try to acquire lock
    const lockKey = `lock:${key}`;
    const lockAcquired = await this.driver.has(lockKey);
    
    if (lockAcquired) {
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.remember(key, factory, ttl, lockTimeout);
    }

    // Set lock
    await this.driver.set(lockKey, '1', lockTimeout);
    
    try {
      const value = await factory();
      await this.set(key, value, ttl);
      return value;
    } finally {
      // Release lock
      await this.driver.delete(lockKey);
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
      driver: options.driver ?? 'memory',
      url: options.url,
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
