import { StoragePort } from "../app/ports/storage_port.js";

/**
 * LocalStorageAdapter
 * 
 * Safe local storage adapter with fallback to in-memory map if localStorage
 * is disabled, throwing SecurityError, or running in an SSR / node test environment.
 */
export class LocalStorageAdapter extends StoragePort {
  /**
   * @param {string} [prefix] - Storage key prefix
   */
  constructor(prefix = "rd2_") {
    super();
    this.prefix = prefix;
    this._memoryStore = new Map();
    this._isAvailable = this._checkAvailability();
  }

  _checkAvailability() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return false;
      const testKey = `__test_${Date.now()}__`;
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get item.
   * @param {string} key
   * @returns {string|null}
   */
  getItem(key) {
    const fullKey = this.prefix + key;
    // A write can fall back to memory even while localStorage remains
    // readable (for example after a quota error). Prefer that value so the
    // adapter does not immediately report a successful fallback write as
    // missing.
    if (this._memoryStore.has(fullKey)) {
      return this._memoryStore.get(fullKey);
    }
    if (this._isAvailable) {
      try {
        return window.localStorage.getItem(fullKey);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Set item.
   * @param {string} key
   * @param {string} value
   */
  setItem(key, value) {
    const fullKey = this.prefix + key;
    if (this._isAvailable) {
      try {
        window.localStorage.setItem(fullKey, String(value));
        // Remove a stale fallback value after localStorage recovers so reads
        // continue to reflect the latest successful write.
        this._memoryStore.delete(fullKey);
        return;
      } catch {
        // QuotaExceeded or disabled, fallback
      }
    }
    this._memoryStore.set(fullKey, String(value));
  }

  /**
   * Remove item.
   * @param {string} key
   */
  removeItem(key) {
    const fullKey = this.prefix + key;
    if (this._isAvailable) {
      try {
        window.localStorage.removeItem(fullKey);
      } catch {
        // Ignore
      }
    }
    this._memoryStore.delete(fullKey);
  }

  /**
   * Clear all items with current prefix.
   */
  clear() {
    if (this._isAvailable) {
      try {
        const keysToRemove = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k?.startsWith(this.prefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      } catch {
        // Ignore
      }
    }
    this._memoryStore.clear();
  }
}
