/**
 * StoragePort Interface
 * 
 * Defines the contract for client-side key-value persistence with memory fallback.
 */

export class StoragePort {
  /**
   * Get an item by key.
   * @param {string} key
   * @returns {string|null}
   */
  getItem(key) {
    throw new Error("StoragePort.getItem must be implemented by an adapter.");
  }

  /**
   * Set a key-value pair.
   * @param {string} key
   * @param {string} value
   */
  setItem(key, value) {
    throw new Error("StoragePort.setItem must be implemented by an adapter.");
  }

  /**
   * Remove an item by key.
   * @param {string} key
   */
  removeItem(key) {
    throw new Error("StoragePort.removeItem must be implemented by an adapter.");
  }

  /**
   * Clear all items in this storage namespace.
   */
  clear() {
    throw new Error("StoragePort.clear must be implemented by an adapter.");
  }
}
