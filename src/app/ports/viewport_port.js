/**
 * ViewportPort Interface
 * 
 * Defines the contract for kinetic camera manipulation, Pan/Zoom transformations,
 * and requestAnimationFrame-based batch rendering for the SVG tree view.
 */

export class ViewportPort {
  /**
   * Initialize viewport listeners on map container and target SVG.
   * @param {HTMLElement} containerElement - Scroll/Gesture container element
   * @param {SVGElement} svgElement - Target SVG element with viewBox
   * @param {object} [options] - Initial configuration (dimensions, scale limits)
   */
  init(containerElement, svgElement, options = {}) {
    throw new Error("ViewportPort.init must be implemented by an adapter.");
  }

  /**
   * Apply pan translation delta.
   * @param {number} dx - X-axis delta
   * @param {number} dy - Y-axis delta
   */
  pan(dx, dy) {
    throw new Error("ViewportPort.pan must be implemented by an adapter.");
  }

  /**
   * Zoom the camera smoothly around a center point.
   * @param {number} factor - Scale factor delta (e.g. 1.2 or 0.8)
   * @param {number} [cx] - Pivot center X
   * @param {number} [cy] - Pivot center Y
   */
  zoom(factor, cx, cy) {
    throw new Error("ViewportPort.zoom must be implemented by an adapter.");
  }

  /**
   * Center the camera on a specific world coordinate.
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} [targetScale]
   * @param {boolean} [animate]
   */
  centerOn(worldX, worldY, targetScale, animate = true) {
    throw new Error("ViewportPort.centerOn must be implemented by an adapter.");
  }

  /**
   * Reset viewport to initial base scale and centered position.
   */
  reset() {
    throw new Error("ViewportPort.reset must be implemented by an adapter.");
  }

  /**
   * Get current transform state.
   * @returns {{ x: number, y: number, scale: number, baseScale: number, minScale: number, maxScale: number }}
   */
  getState() {
    throw new Error("ViewportPort.getState must be implemented by an adapter.");
  }

  /**
   * Subscribe to camera transform change events.
   * @param {Function} listener - Callback (state) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    throw new Error("ViewportPort.subscribe must be implemented by an adapter.");
  }

  /**
   * Destroy and clean up event listeners and animation frames.
   */
  destroy() {
    throw new Error("ViewportPort.destroy must be implemented by an adapter.");
  }
}
