/**
 * Simple in-memory cache with TTL support
 */
export class Cache {
  constructor(ttl = 5 * 60 * 1000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Optional custom TTL in milliseconds
   */
  set(key, value, ttl) {
    this.cache.set(key, {
      value,
      expires: Date.now() + (ttl ?? this.ttl)
    });
  }

  /**
   * Check if a key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Clear a specific key or all cache
   * @param {string} key - Optional key to clear, if omitted clears all
   */
  clear(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get or compute a value, caching the result
   * @param {string} key - Cache key
   * @param {Function} fn - Async function to compute value if not cached
   * @param {number} ttl - Optional custom TTL
   * @returns {Promise<*>}
   */
  async getOrCompute(key, fn, ttl) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fn();
    this.set(key, value, ttl);
    return value;
  }
}

// Create singleton instances with different TTLs
export const mcpCache = new Cache(10 * 60 * 1000); // 10 minutes for MCP servers
export const skillsCache = new Cache(15 * 60 * 1000); // 15 minutes for skills
