/**
 * SpineEnginePort Interface
 * 
 * Defines the contract for managing Spine 4.2 WebGL instances and memory context pooling.
 * Capped strictly at 1 active WebGL context to prevent leaks and GPU context loss.
 */

export class SpineEnginePort {
  /**
   * Acquire a Spine animation canvas instance for a visual container.
   * If an active instance already exists, safely disposes it before acquiring.
   * @param {HTMLElement} visualElement - Container DOM element
   * @param {object} spineDefinition - Spine resource paths { skeleton, atlas, texture, animation }
   * @returns {Promise<object|null>} Spine instance controller or null if disabled/unavailable
   */
  async acquireCanvas(visualElement, spineDefinition) {
    throw new Error("SpineEnginePort.acquireCanvas must be implemented by an adapter.");
  }

  /**
   * Release and dispose the active Spine canvas instance associated with the element.
   * @param {HTMLElement} visualElement
   */
  releaseCanvas(visualElement) {
    throw new Error("SpineEnginePort.releaseCanvas must be implemented by an adapter.");
  }

  /**
   * Dispose all active WebGL contexts and clear asset manager caches.
   */
  disposeAll() {
    throw new Error("SpineEnginePort.disposeAll must be implemented by an adapter.");
  }

  /**
   * Dispose all active WebGL contexts and release resources (standard lifecycle).
   */
  dispose() {
    return this.disposeAll();
  }

  /**
   * Get the current count of active WebGL contexts (should always be 0 or 1).
   * @returns {number}
   */
  getActiveContextCount() {
    throw new Error("SpineEnginePort.getActiveContextCount must be implemented by an adapter.");
  }
}
