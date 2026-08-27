import { ViewportPort } from "../app/ports/viewport_port.js";

function removeDomListeners(target, handlers) {
  if (!target || typeof target.removeEventListener !== "function") return;
  for (const [type, handler] of Object.entries(handlers || {})) {
    if (handler) target.removeEventListener(type, handler);
  }
}

// Handles the tree camera and pointer gestures.
export class ViewportController extends ViewportPort {
  /**
   * @param {object} [options]
   * @param {number} [options.mapWidth] - Total SVG coordinate width (default: 4000)
   * @param {number} [options.mapHeight] - Total SVG coordinate height (default: 3400)
   */
  constructor(options = {}) {
    super();
    this.mapWidth = options.mapWidth || 4000;
    this.mapHeight = options.mapHeight || 3400;

    this.container = null;
    this.sceneElement = null;

    this._state = {
      x: 0,
      y: 0,
      scale: 1.0,
      baseScale: 1.0,
      minScale: 0.33,
      maxScale: 2.0,
      isPanning: false
    };

    this._listeners = new Set();
    this._rafId = null;
    this._needsRender = false;
    this._isDestroyed = false;

    // Animation state
    this._animState = null;
    this._animRafId = null;

    // Wheel zoom state
    this._wheelZoomRafId = null;
    this._targetWheelScale = null;
    this._wheelAnchorWorldX = null;
    this._wheelAnchorWorldY = null;
    this._wheelZoomCenterX = null;
    this._wheelZoomCenterY = null;

    // Inertia pan state
    this._inertiaRafId = null;

    this._cachedWidth = null;
    this._cachedHeight = null;

    // DOM event listeners cleanup
    this._domHandlers = null;
    this._domTimerCleanup = null;
    this._handleResize = () => {
      if (this._isDestroyed) return;
      this.updateCachedDimensions();
      const limits = this.calculateScaleLimits();
      this._state.baseScale = limits.baseScale;
      this._state.minScale = limits.minScale;
      this._state.maxScale = limits.maxScale;
      this._state.scale = Math.min(limits.maxScale, Math.max(limits.minScale, this._state.scale));
      this.clampPosition();
      this.requestRender();
    };
  }

  /**
   * Update cached container dimensions to prevent repeated layout reflows during gestures.
   */
  updateCachedDimensions() {
    this._cachedWidth = this.container?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1000);
    this._cachedHeight = this.container?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 800);
  }

  /**
   * Get current viewport dimensions with fallback to cached dimensions / clientWidth / window / defaults.
   * @returns {{ width: number, height: number }}
   */
  viewportSize() {
    if (this._cachedWidth === null || this._cachedHeight === null) {
      this.updateCachedDimensions();
    }
    return { width: this._cachedWidth, height: this._cachedHeight };
  }

  /**
   * Determine scale limits based on screen viewport width.
   * @param {number} [screenWidth]
   */
  calculateScaleLimits(screenWidth = (this._cachedWidth || this.container?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1000))) {
    const isMobile = screenWidth <= 768;
    const baseScale = isMobile ? 0.5 : 1.0;
    const minScale = isMobile ? 0.16 : 0.33;
    const maxScale = isMobile ? 1.4 : 2.0;
    return { isMobile, baseScale, minScale, maxScale };
  }

  /**
   * Ken Perlin Smootherstep easing function: 6t^5 - 15t^4 + 10t^3
   * @param {number} t (0..1)
   * @returns {number}
   */
  _cameraEase(t) {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
  }

  /**
   * Stop any active camera animation.
   */
  _stopAnimation() {
    if (this._animRafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._animRafId);
    }
    this._animRafId = null;
    this._animState = null;
    this._stopInertiaPan();
  }

  /**
   * Stop smooth wheel zoom animation loop.
   */
  _stopSmoothWheelZoom() {
    if (this._wheelZoomRafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._wheelZoomRafId);
    }
    this._wheelZoomRafId = null;
    this._targetWheelScale = null;
    this._wheelAnchorWorldX = null;
    this._wheelAnchorWorldY = null;
  }

  /**
   * Stop inertia pan decay loop.
   */
  _stopInertiaPan(fromStart = false) {
    if (this._inertiaRafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._inertiaRafId);
    }
    this._inertiaRafId = null;
    if (!fromStart) {
      this._setNavigating?.(false);
    }
  }

  /**
   * Launch inertia pan momentum decay.
   * @param {number} initialVx - Initial X velocity in px/ms
   * @param {number} initialVy - Initial Y velocity in px/ms
   */
  _startInertiaPan(initialVx, initialVy) {
    this._stopInertiaPan(true);
    this._setNavigating?.(true);
    let vx = initialVx;
    let vy = initialVy;
    let lastTime = (typeof performance !== "undefined" ? performance.now() : Date.now());

    const inertiaStep = (now = (typeof performance !== "undefined" ? performance.now() : Date.now())) => {
      if (this._isDestroyed) return;
      const dt = Math.min(32, Math.max(8, now - lastTime));
      lastTime = now;

      this._state.x += vx * dt;
      this._state.y += vy * dt;

      const { minPanX, maxPanX, minPanY, maxPanY } = this.getPanBounds(this._state.scale);
      let outOfBounds = false;

      if (this._state.x < minPanX) {
        this._state.x += (minPanX - this._state.x) * 0.16;
        vx *= 0.65;
        outOfBounds = true;
      } else if (this._state.x > maxPanX) {
        this._state.x += (maxPanX - this._state.x) * 0.16;
        vx *= 0.65;
        outOfBounds = true;
      }

      if (this._state.y < minPanY) {
        this._state.y += (minPanY - this._state.y) * 0.16;
        vy *= 0.65;
        outOfBounds = true;
      } else if (this._state.y > maxPanY) {
        this._state.y += (maxPanY - this._state.y) * 0.16;
        vy *= 0.65;
        outOfBounds = true;
      }

      const decay = outOfBounds ? 0.8 : 0.938;
      const decayFactor = Math.pow(decay, dt / 16.67);
      vx *= decayFactor;
      vy *= decayFactor;

      this.requestRender();

      const currentSpeed = Math.hypot(vx, vy);
      if (currentSpeed < 0.018 && !outOfBounds) {
        this.clampPosition();
        this.requestRender();
        this._stopInertiaPan();
      } else if (typeof requestAnimationFrame === "function") {
        this._inertiaRafId = requestAnimationFrame(inertiaStep);
      } else {
        this._stopInertiaPan();
      }
    };

    if (typeof requestAnimationFrame === "function") {
      this._inertiaRafId = requestAnimationFrame(inertiaStep);
    }
  }

  /**
   * Initialize viewport controller on container and scene/SVG elements.
   * @param {HTMLElement} containerElement
   * @param {HTMLElement|SVGElement} sceneElement
   * @param {object} [options]
   */
  init(containerElement, sceneElement, options = {}) {
    this._isDestroyed = false;
    this._cleanupEventListeners();
    this.container = containerElement;
    this.sceneElement = sceneElement;
    this.updateCachedDimensions();

    const limits = this.calculateScaleLimits();
    this._state.baseScale = limits.baseScale;
    this._state.minScale = limits.minScale;
    this._state.maxScale = limits.maxScale;
    this._state.scale = options.initialScale || limits.baseScale;

    if (options.initialX !== undefined && options.initialY !== undefined) {
      this._state.x = options.initialX;
      this._state.y = options.initialY;
    } else {
      this.resetToCenter(true);
    }

    this._setupEventListeners();
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("resize", this._handleResize);
    }
    this.requestRender();
  }

  /**
   * Bind real DOM event listeners for pointer drag, pinch-zoom, and wheel zoom.
   */
  _setupEventListeners() {
    if (!this.container || typeof this.container.addEventListener !== "function") return;

    this._gestureState = {
      pointers: new Map(),
      dragStart: null,
      pinchStart: null,
      dragHistory: [],
      zoomingTimer: null,
      navigatingCooldownTimer: null
    };
    this._setNavigating = this._setNavigatingState.bind(this);
    this._domTimerCleanup = this._cleanupGestureTimers.bind(this);

    const pointerdown = this._handlePointerDown.bind(this);
    const pointermove = this._handlePointerMove.bind(this);
    const pointerup = this._handlePointerUp.bind(this);
    const wheel = this._handleWheel.bind(this);
    this._domHandlers = {
      container: { pointerdown, wheel },
      window: { pointermove, pointerup, pointercancel: pointerup }
    };

    this.container.addEventListener("pointerdown", pointerdown);
    this.container.addEventListener("wheel", wheel, { passive: false });

    const win = typeof window !== "undefined" ? window : null;
    if (win && typeof win.addEventListener === "function") {
      win.addEventListener("pointermove", pointermove, { passive: false });
      win.addEventListener("pointerup", pointerup);
      win.addEventListener("pointercancel", pointerup);
    } else {
      this._domHandlers.container.pointermove = pointermove;
      this._domHandlers.container.pointerup = pointerup;
      this._domHandlers.container.pointercancel = pointerup;
      this.container.addEventListener("pointermove", pointermove);
      this.container.addEventListener("pointerup", pointerup);
      this.container.addEventListener("pointercancel", pointerup);
    }
  }

  _setZoomingState(isZooming) {
    if (typeof document === "undefined" || !document.body || !this._gestureState) return;
    const state = this._gestureState;
    if (isZooming) {
      document.body.classList.add("is-zooming");
      if (state.zoomingTimer) clearTimeout(state.zoomingTimer);
      state.zoomingTimer = setTimeout(() => {
        if (this._gestureState !== state) return;
        document.body.classList.remove("is-zooming");
        state.zoomingTimer = null;
      }, 450);
      return;
    }
    if (state.zoomingTimer) {
      clearTimeout(state.zoomingTimer);
      state.zoomingTimer = null;
    }
    document.body.classList.remove("is-zooming");
  }

  _setNavigatingState(active, immediate = false) {
    if (typeof document === "undefined" || !document.body || !this._gestureState) return;
    const state = this._gestureState;
    if (state.navigatingCooldownTimer) {
      clearTimeout(state.navigatingCooldownTimer);
      state.navigatingCooldownTimer = null;
    }
    if (active) {
      document.body.classList.add("is-navigating", "is-manual-navigating");
      return;
    }
    if (immediate) {
      document.body.classList.remove("is-navigating", "is-manual-navigating");
      return;
    }
    state.navigatingCooldownTimer = setTimeout(() => {
      if (this._gestureState !== state) return;
      document.body.classList.remove("is-navigating", "is-manual-navigating");
      state.navigatingCooldownTimer = null;
    }, 120);
  }

  _cleanupGestureTimers() {
    const state = this._gestureState;
    if (state?.zoomingTimer) clearTimeout(state.zoomingTimer);
    if (state?.navigatingCooldownTimer) clearTimeout(state.navigatingCooldownTimer);
    this._setNavigating = null;
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("is-zooming", "is-navigating", "is-manual-navigating");
    }
    this._gestureState = null;
  }

  _eventTimestamp() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  _dispatchViewportDrag() {
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
      document.dispatchEvent(new CustomEvent("rd2:viewport-drag"));
    }
  }

  _handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType === "pen" && event.button !== 0 && event.button !== -1) return;

    const state = this._gestureState;
    if (!state) return;
    this._stopAnimation();
    this._stopSmoothWheelZoom();
    this._stopInertiaPan();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.dragHistory = [{ x: event.clientX, y: event.clientY, t: this._eventTimestamp() }];

    if (state.pointers.size === 2) {
      state.dragStart = null;
      state.pinchStart = this._createPinchStart(state.pointers);
      this._setZoomingState(true);
      this._setNavigatingState(true);
      event.preventDefault?.();
      return;
    }
    if (state.pointers.size === 1) {
      state.dragStart = {
        startX: event.clientX,
        startY: event.clientY,
        initialX: this._state.x,
        initialY: this._state.y,
        hasMoved: false
      };
      this._state.isPanning = true;
    }
  }

  _createPinchStart(pointers) {
    const points = Array.from(pointers.values());
    const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const rect = this.container.getBoundingClientRect?.() || { left: 0, top: 0 };
    return {
      initialDist: Math.max(dist, 10),
      initialScale: this._state.scale,
      cx: (points[0].x + points[1].x) / 2 - (rect.left || 0),
      cy: (points[0].y + points[1].y) / 2 - (rect.top || 0)
    };
  }

  _handlePointerMove(event) {
    const state = this._gestureState;
    if (!state?.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.pointers.size === 2 && state.pinchStart) {
      this._updatePinchGesture(state, event);
      return;
    }
    if (state.pointers.size === 1 && state.dragStart) {
      this._updateDragGesture(state, event);
    }
  }

  _updatePinchGesture(state, event) {
    this._setZoomingState(true);
    this._setNavigatingState(true);
    this._dispatchViewportDrag();
    const points = Array.from(state.pointers.values());
    const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const ratio = dist / state.pinchStart.initialDist;
    const targetScale = state.pinchStart.initialScale * ratio;
    const scaleFactor = targetScale / (this._state.scale || 1.0);
    this.zoom(scaleFactor, state.pinchStart.cx, state.pinchStart.cy);
    event.preventDefault?.();
  }

  _updateDragGesture(state, event) {
    const dx = event.clientX - state.dragStart.startX;
    const dy = event.clientY - state.dragStart.startY;
    const moveDist = Math.hypot(dx, dy);

    if (!state.dragStart.hasMoved && moveDist >= 4) {
      state.dragStart.hasMoved = true;
      this._setNavigatingState(true);
      this.container?.classList?.add("is-dragging");
      this._dispatchViewportDrag();
    }
    if (!state.dragStart.hasMoved) return;

    const rawX = state.dragStart.initialX + dx;
    const rawY = state.dragStart.initialY + dy;
    const resisted = this._applyPanResistance(rawX, rawY, this._state.scale);
    this._state.x = resisted.x;
    this._state.y = resisted.y;
    this.requestRender();
    state.dragHistory.push({ x: event.clientX, y: event.clientY, t: this._eventTimestamp() });
    if (state.dragHistory.length > 5) state.dragHistory.shift();
    event.preventDefault?.();
  }

  _handlePointerUp(event) {
    const state = this._gestureState;
    if (!state) return;
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.pinchStart = null;
    if (state.pointers.size === 0) this._finishPointerGesture(state);
  }

  _finishPointerGesture(state) {
    const velocity = this._getDragVelocity(state.dragHistory);
    state.dragHistory = [];
    state.dragStart = null;
    this._state.isPanning = false;
    this.container?.classList?.remove("is-dragging");

    if (velocity) {
      this._startInertiaPan(velocity.vx, velocity.vy);
      return;
    }
    this._settlePointerPosition();
    this._setNavigatingState(false);
  }

  _getDragVelocity(dragHistory) {
    if (dragHistory.length < 2) return null;
    const recent = dragHistory.at(-1);
    const older = dragHistory[0];
    const dt = recent.t - older.t;
    const age = this._eventTimestamp() - recent.t;
    if (dt <= 0 || dt >= 150 || age >= 100) return null;
    const vx = (recent.x - older.x) / dt;
    const vy = (recent.y - older.y) / dt;
    return Math.hypot(vx, vy) > 0.1 ? { vx, vy } : null;
  }

  _settlePointerPosition() {
    const { minPanX, maxPanX, minPanY, maxPanY } = this.getPanBounds(this._state.scale);
    const targetX = Math.min(maxPanX, Math.max(minPanX, this._state.x));
    const targetY = Math.min(maxPanY, Math.max(minPanY, this._state.y));
    const needsAnimation = Math.abs(targetX - this._state.x) > 0.5 || Math.abs(targetY - this._state.y) > 0.5;
    if (needsAnimation) {
      this.panTo(targetX, targetY, true, 260);
      return;
    }
    this.clampPosition();
    this.requestRender();
  }

  _handleWheel(event) {
    event.preventDefault?.();
    this._stopAnimation();
    this._setZoomingState(true);
    this._setNavigatingState(true);

    const { width, height } = this.viewportSize();
    const cx = width / 2;
    const cy = height / 2;
    this._initializeWheelZoomAnchor(cx, cy);
    const zoomMultiplier = Math.exp(-event.deltaY * 0.0018);
    this._targetWheelScale = this._clampWheelTarget(this._targetWheelScale * zoomMultiplier);
    this._scheduleSmoothWheelZoom();
  }

  _initializeWheelZoomAnchor(cx, cy) {
    if (this._targetWheelScale !== null && this._wheelAnchorWorldX !== null) return;
    this._targetWheelScale = this._state.scale;
    this._wheelAnchorWorldX = (cx - this._state.x) / this._state.scale;
    this._wheelAnchorWorldY = (cy - this._state.y) / this._state.scale;
    this._wheelZoomCenterX = cx;
    this._wheelZoomCenterY = cy;
  }

  _clampWheelTarget(scale) {
    return Math.min(this._state.maxScale, Math.max(this._state.minScale, scale));
  }

  _scheduleSmoothWheelZoom() {
    if (this._wheelZoomRafId) return;
    if (typeof requestAnimationFrame === "function") {
      this._wheelZoomRafId = requestAnimationFrame(() => this._smoothWheelZoomStep());
      return;
    }
    this._smoothWheelZoomStep();
  }

  _smoothWheelZoomStep() {
    const diff = this._targetWheelScale - this._state.scale;
    if (Math.abs(diff) < 0.001) {
      this._state.scale = this._targetWheelScale;
      this._state.x = this._wheelZoomCenterX - this._wheelAnchorWorldX * this._state.scale;
      this._state.y = this._wheelZoomCenterY - this._wheelAnchorWorldY * this._state.scale;
      this.clampPosition();
      this.requestRender();
      this._stopSmoothWheelZoom();
      this._setNavigatingState(false, true);
      return;
    }

    this._state.scale += diff * 0.32;
    this._state.x = this._wheelZoomCenterX - this._wheelAnchorWorldX * this._state.scale;
    this._state.y = this._wheelZoomCenterY - this._wheelAnchorWorldY * this._state.scale;
    this.clampPosition();
    this.requestRender();

    if (typeof requestAnimationFrame === "function") {
      this._wheelZoomRafId = requestAnimationFrame(() => this._smoothWheelZoomStep());
    } else {
      this._stopSmoothWheelZoom();
    }
  }

  /**
   * Cleanup DOM event listeners.
   */
  _cleanupEventListeners() {
    removeDomListeners(typeof window !== "undefined" ? window : null, { resize: this._handleResize });
    this._domTimerCleanup?.();
    this._domTimerCleanup = null;
    const handlers = this._domHandlers;
    this._domHandlers = null;
    if (!handlers) return;
    removeDomListeners(this.container, handlers.container);
    removeDomListeners(typeof window !== "undefined" ? window : null, handlers.window);
  }

  /**
   * Calculate pan boundary constraints.
   * Uses robust margin math to avoid lockup when scaledWidth <= containerWidth.
   * @param {number} [scale]
   * @returns {{ minPanX: number, maxPanX: number, minPanY: number, maxPanY: number }}
   */
  getPanBounds(scale = this._state.scale) {
    const { width, height } = this.viewportSize();
    const scaledWidth = this.mapWidth * scale;
    const scaledHeight = this.mapHeight * scale;

    const marginX = Math.max(width * 0.55, 320);
    const marginY = Math.max(height * 0.55, 300);

    let minPanX, maxPanX, minPanY, maxPanY;

    if (scaledWidth <= width) {
      const centerPanX = (width - scaledWidth) / 2;
      minPanX = centerPanX - marginX;
      maxPanX = centerPanX + marginX;
    } else {
      minPanX = width - scaledWidth - marginX;
      maxPanX = marginX;
    }

    if (scaledHeight <= height) {
      const centerPanY = (height - scaledHeight) / 2;
      minPanY = centerPanY - marginY;
      maxPanY = centerPanY + marginY;
    } else {
      minPanY = height - scaledHeight - marginY;
      maxPanY = marginY;
    }

    return { minPanX, maxPanX, minPanY, maxPanY };
  }

  /**
   * Apply elastic rubber-banding resistance for soft pan boundaries.
   * @param {number} rawX
   * @param {number} rawY
   * @param {number} [scale]
   * @returns {{ x: number, y: number }}
   */
  _applyPanResistance(rawX, rawY, scale = this._state.scale) {
    const { minPanX, maxPanX, minPanY, maxPanY } = this.getPanBounds(scale);
    let x = rawX;
    let y = rawY;
    const maxOverdrag = 160;
    const resistance = 0.38;

    if (x < minPanX) {
      const over = minPanX - x;
      x = minPanX - Math.min(maxOverdrag, over * resistance);
    } else if (x > maxPanX) {
      const over = x - maxPanX;
      x = maxPanX + Math.min(maxOverdrag, over * resistance);
    }

    if (y < minPanY) {
      const over = minPanY - y;
      y = minPanY - Math.min(maxOverdrag, over * resistance);
    } else if (y > maxPanY) {
      const over = y - maxPanY;
      y = maxPanY + Math.min(maxOverdrag, over * resistance);
    }

    return { x, y };
  }

  /**
   * Apply pan delta in screen coordinates.
   * @param {number} dx
   * @param {number} dy
   */
  pan(dx, dy) {
    if (this._isDestroyed) return;
    this._stopAnimation();
    this._stopSmoothWheelZoom();
    this._state.x += dx;
    this._state.y += dy;
    this.clampPosition();
    this.requestRender();
  }

  /**
   * Zoom camera smoothly.
   * @param {number} factor - Scale multiplier (e.g. 1.1 or 0.9)
   * @param {number} [cx] - Pivot client X
   * @param {number} [cy] - Pivot client Y
   */
  zoom(factor, cx, cy) {
    if (this._isDestroyed) return;
    this._stopAnimation();
    this._stopSmoothWheelZoom();
    const oldScale = this._state.scale;
    let newScale = oldScale * factor;
    newScale = Math.max(this._state.minScale, Math.min(this._state.maxScale, newScale));

    if (Math.abs(newScale - oldScale) < 0.0001) return;

    if (cx !== undefined && cy !== undefined && this.container) {
      const rect = this.container.getBoundingClientRect?.() || { left: 0, top: 0 };
      const pivotX = cx - (rect.left || 0);
      const pivotY = cy - (rect.top || 0);

      // Adjust (x, y) so that world coordinate under pivot remains invariant
      this._state.x = pivotX - (pivotX - this._state.x) * (newScale / oldScale);
      this._state.y = pivotY - (pivotY - this._state.y) * (newScale / oldScale);
    } else if (this.container) {
      const { width, height } = this.viewportSize();
      const pivotX = width / 2;
      const pivotY = height / 2;
      this._state.x = pivotX - (pivotX - this._state.x) * (newScale / oldScale);
      this._state.y = pivotY - (pivotY - this._state.y) * (newScale / oldScale);
    }

    this._state.scale = newScale;
    this.clampPosition();
    this.requestRender();
  }

  /**
   * Pan directly to screen coordinates with optional animation.
   * @param {number} rawTargetX
   * @param {number} rawTargetY
   * @param {boolean} [animate]
   * @param {number} [customDuration]
   */
  panTo(rawTargetX, rawTargetY, animate = true, customDuration = null) {
    if (this._isDestroyed || !this.container) return;
    const { minPanX, maxPanX, minPanY, maxPanY } = this.getPanBounds(this._state.scale);
    const targetX = Math.min(maxPanX, Math.max(minPanX, rawTargetX));
    const targetY = Math.min(maxPanY, Math.max(minPanY, rawTargetY));

    this._stopAnimation();
    this._stopSmoothWheelZoom();

    if (!animate || typeof requestAnimationFrame !== "function") {
      this._state.x = targetX;
      this._state.y = targetY;
      this.clampPosition();
      this.requestRender();
      return;
    }

    const startX = this._state.x;
    const startY = this._state.y;
    const dist = Math.hypot(targetX - startX, targetY - startY);
    if (dist < 0.5) return;

    const duration = customDuration || Math.min(480, Math.max(380, 380 + dist * 0.08));
    const startTime = (typeof performance !== "undefined" ? performance.now() : Date.now());

    this._animState = {
      startX,
      startY,
      targetX,
      targetY,
      startScale: this._state.scale,
      targetScale: this._state.scale,
      startTime,
      duration
    };

    const step = (now = (typeof performance !== "undefined" ? performance.now() : Date.now())) => {
      if (!this._animState) return;
      const elapsed = now - this._animState.startTime;
      const progress = Math.min(1, elapsed / this._animState.duration);
      const ease = this._cameraEase(progress);

      this._state.x = this._animState.startX + (this._animState.targetX - this._animState.startX) * ease;
      this._state.y = this._animState.startY + (this._animState.targetY - this._animState.startY) * ease;
      this.requestRender();

      if (progress < 1) {
        this._animRafId = requestAnimationFrame(step);
      } else {
        this._state.x = this._animState.targetX;
        this._state.y = this._animState.targetY;
        this._stopAnimation();
        this.clampPosition();
        this.requestRender();
      }
    };

    this._animRafId = requestAnimationFrame(step);
  }

  /**
   * Smoothly zoom and frame target scale anchored on specific world coordinates.
   * @param {number} nextScale
   * @param {number} [anchorWorldX]
   * @param {number} [anchorWorldY]
   * @param {boolean} [immediate]
   * @param {number} [customDuration]
   */
  zoomTo(nextScale, anchorWorldX = null, anchorWorldY = null, immediate = false, customDuration = null) {
    if (this._isDestroyed || !this.container) return;
    this._stopAnimation();
    this._stopSmoothWheelZoom();

    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const effectiveImmediate = immediate || isMobile;
    const limits = this.calculateScaleLimits();
    const clampedScale = Math.min(limits.maxScale, Math.max(limits.minScale, nextScale));
    const { width, height } = this.viewportSize();
    const cx = width / 2;
    const cy = height / 2;

    const wx = anchorWorldX !== null ? anchorWorldX : (cx - this._state.x) / this._state.scale;
    const wy = anchorWorldY !== null ? anchorWorldY : (cy - this._state.y) / this._state.scale;

    const targetPanX = cx - wx * clampedScale;
    const targetPanY = cy - wy * clampedScale;

    if (effectiveImmediate || typeof requestAnimationFrame !== "function") {
      this._state.scale = clampedScale;
      this._state.x = targetPanX;
      this._state.y = targetPanY;
      this.clampPosition();
      this.requestRender();
      return;
    }

    const dist = Math.hypot(targetPanX - this._state.x, targetPanY - this._state.y);
    if (Math.abs(clampedScale - this._state.scale) < 0.001 && dist < 0.5) return;

    const duration = customDuration || Math.min(480, Math.max(380, 380 + dist * 0.08));
    const startTime = (typeof performance !== "undefined" ? performance.now() : Date.now());

    this._animState = {
      startScale: this._state.scale,
      targetScale: clampedScale,
      startPanX: this._state.x,
      startPanY: this._state.y,
      targetPanX,
      targetPanY,
      startTime,
      duration
    };

    const step = (now = (typeof performance !== "undefined" ? performance.now() : Date.now())) => {
      if (!this._animState) return;
      const elapsed = now - this._animState.startTime;
      const progress = Math.min(1, elapsed / this._animState.duration);
      const eased = this._cameraEase(progress);

      this._state.scale = this._animState.startScale + (this._animState.targetScale - this._animState.startScale) * eased;
      this._state.x = this._animState.startPanX + (this._animState.targetPanX - this._animState.startPanX) * eased;
      this._state.y = this._animState.startPanY + (this._animState.targetPanY - this._animState.startPanY) * eased;

      this.requestRender();

      if (progress < 1 && typeof requestAnimationFrame === "function") {
        this._animRafId = requestAnimationFrame(step);
      } else {
        this._state.scale = this._animState.targetScale;
        this._state.x = this._animState.targetPanX;
        this._state.y = this._animState.targetPanY;
        this._stopAnimation();
        this.clampPosition();
        this.requestRender();
      }
    };

    if (typeof requestAnimationFrame === "function") {
      this._animRafId = requestAnimationFrame(step);
    } else {
      step();
    }
  }

  /**
   * Center camera on a world position with optional target scale.
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} [targetScale]
   * @param {boolean} [animate]
   */
  centerOn(worldX, worldY, targetScale, animate = true) {
    if (this._isDestroyed || !this.container) return;
    const { width, height } = this.viewportSize();
    const scale = targetScale !== undefined 
      ? Math.max(this._state.minScale, Math.min(this._state.maxScale, targetScale)) 
      : this._state.scale;
    
    let targetX = width / 2 - worldX * scale;
    let targetY = height / 2 - worldY * scale;

    const { minPanX, maxPanX, minPanY, maxPanY } = this.getPanBounds(scale);
    targetX = Math.min(maxPanX, Math.max(minPanX, targetX));
    targetY = Math.min(maxPanY, Math.max(minPanY, targetY));

    if (Math.abs(scale - this._state.scale) > 0.001) {
      this.zoomTo(scale, worldX, worldY, !animate);
    } else {
      this.panTo(targetX, targetY, animate);
    }
  }

  /**
   * Reset viewport to 100% zoom and centered.
   * @param {boolean} [immediate]
   */
  resetToCenter(immediate = false) {
    const limits = this.calculateScaleLimits();
    const baseScale = limits.baseScale;
    const { width, height } = this.viewportSize();

    const targetPanX = (width - this.mapWidth * baseScale) / 2;
    const targetPanY = (height - this.mapHeight * baseScale) / 2;

    if (immediate) {
      this._stopAnimation();
      this._stopSmoothWheelZoom();
      this._state.baseScale = baseScale;
      this._state.scale = baseScale;
      this._state.x = targetPanX;
      this._state.y = targetPanY;
      this.clampPosition();
      this.requestRender();
    } else {
      this.zoomTo(baseScale, this.mapWidth / 2, this.mapHeight / 2, false);
    }
  }

  /**
   * Fit full tree into available viewport.
   * @param {boolean} [immediate]
   */
  fitToViewport(immediate = false) {
    const limits = this.calculateScaleLimits();
    const { width, height } = this.viewportSize();

    const horizontalRoom = Math.max(300, width - 40);
    const verticalRoom = Math.max(260, height - 80);
    const nextScale = Math.min(limits.maxScale, Math.max(limits.minScale, Math.min(horizontalRoom / this.mapWidth, verticalRoom / this.mapHeight)));

    if (immediate) {
      this._stopAnimation();
      this._stopSmoothWheelZoom();
      this._state.scale = nextScale;
      this._state.x = (width - this.mapWidth * nextScale) / 2;
      this._state.y = (height - this.mapHeight * nextScale) / 2;
      this.clampPosition();
      this.requestRender();
    } else {
      this.zoomTo(nextScale, this.mapWidth / 2, this.mapHeight / 2, false);
    }
  }

  /**
   * Center purely via pan on a node position, preserving current zoom level.
   * @param {{ x: number, y: number }} pt
   * @param {boolean} [immediate]
   */
  centerOnNode(pt, immediate = false) {
    if (!pt || !this.container) return;
    const { width, height } = this.viewportSize();
    const currentScale = this._state.scale;
    const targetX = width / 2 - pt.x * currentScale;
    const targetY = height / 2 - pt.y * currentScale;
    this.panTo(targetX, targetY, !immediate);
  }

  /**
   * Center on node positioned for optimal tooltip placement.
   * @param {object} params
   * @param {{ x: number, y: number }} params.pt
   * @param {object} [params.node]
   * @param {boolean} [params.isBelow]
   * @param {number} [params.tipHeight]
   * @param {boolean} [params.immediate]
   */
  centerOnNodeForTooltip({ pt, node, isBelow = false, tipHeight = 320, immediate = false } = {}) {
    if (!pt || !this.container) return;
    const { width, height } = this.viewportSize();
    const currentScale = this._state.scale;
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

    const targetX = width / 2 - pt.x * currentScale;

    const isLarge = node?.node_type === "DICE" || node?.type === "DICE" || node?.node_type === "PERK" || node?.is_big;
    const nodeRadius = (isLarge ? 52 : 36) * currentScale;
    const gap = isMobile ? 16 : 14;
    const upwardShift = isMobile ? 28 : 0;

    let targetNodeScreenY;
    if (isBelow) {
      targetNodeScreenY = height / 2 - nodeRadius - tipHeight / 2 - gap - upwardShift;
    } else {
      targetNodeScreenY = height / 2 + nodeRadius + tipHeight / 2 + gap + upwardShift;
    }

    const targetY = targetNodeScreenY - pt.y * currentScale;
    this.panTo(targetX, targetY, !immediate);
  }

  /**
   * Center and fit camera on a set of prerequisite node positions.
   * @param {Array<{ x: number, y: number }>} positions
   * @param {boolean} [immediate]
   */
  centerOnPrereqPath(positions = [], immediate = false) {
    if (!positions?.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    positions.forEach((pt) => {
      if (pt) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
      }
    });

    if (!Number.isFinite(minX)) return;

    const { width, height } = this.viewportSize();
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const pathWidth = maxX - minX + 240;
    const pathHeight = maxY - minY + 240;

    const limits = this.calculateScaleLimits();
    const fitScale = Math.min(1.1, Math.max(limits.minScale, Math.min((width - 80) / pathWidth, (height - 120) / pathHeight)));

    if (immediate) {
      this._stopAnimation();
      this._stopSmoothWheelZoom();
      this._state.scale = fitScale;
      this._state.x = width / 2 - centerX * fitScale;
      this._state.y = height / 2 - centerY * fitScale;
      this.clampPosition();
      this.requestRender();
    } else {
      this.zoomTo(fitScale, centerX, centerY, false);
    }
  }

  /**
   * Adaptive camera focus to a set of matched node positions.
   * @param {Array<{ x: number, y: number }>} positions
   * @param {boolean} [immediate]
   * @param {number} [padding]
   */
  fitCameraToNodes(positions = [], immediate = false, padding = 200) {
    if (!positions?.length) {
      this.resetToCenter(immediate);
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    positions.forEach((pt) => {
      if (pt) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
      }
    });

    if (!Number.isFinite(minX)) {
      this.resetToCenter(immediate);
      return;
    }

    const { width, height } = this.viewportSize();
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const boundingWidth = maxX - minX + padding * 2;
    const boundingHeight = maxY - minY + padding * 2;

    const limits = this.calculateScaleLimits();
    const fitScale = Math.min(0.92, Math.max(limits.minScale, Math.min((width - 80) / boundingWidth, (height - 120) / boundingHeight)));

    if (immediate) {
      this._stopAnimation();
      this._stopSmoothWheelZoom();
      this._state.scale = fitScale;
      this._state.x = width / 2 - centerX * fitScale;
      this._state.y = height / 2 - centerY * fitScale;
      this.clampPosition();
      this.requestRender();
    } else {
      this.zoomTo(fitScale, centerX, centerY, false);
    }
  }

  /**
   * Reset viewport to centered base scale (alias).
   * @param {boolean} [render]
   */
  reset(render = true) {
    this.resetToCenter(!render);
  }

  /**
   * Clamp position to reasonable boundaries using getPanBounds.
   */
  clampPosition() {
    if (!this.container) return;
    const { minPanX, maxPanX, minPanY, maxPanY } = this.getPanBounds(this._state.scale);
    this._state.x = Math.min(maxPanX, Math.max(minPanX, this._state.x));
    this._state.y = Math.min(maxPanY, Math.max(minPanY, this._state.y));
  }

  /**
   * Format zoom percentage string.
   * @param {number} [scale]
   * @returns {string}
   */
  formatZoomPercent(scale = this._state.scale) {
    const base = this._state.baseScale || 1.0;
    return `${Math.round((scale / base) * 100)}%`;
  }

  /**
   * Request RAF-batched render.
   */
  requestRender() {
    if (this._needsRender) return;
    this._needsRender = true;

    if (typeof requestAnimationFrame === "function") {
      this._rafId = requestAnimationFrame(() => this._applyRender());
    } else {
      this._applyRender();
    }
  }

  _applyRender() {
    this._needsRender = false;
    if (this._isDestroyed) return;

    const targetEl = this.sceneElement;
    if (targetEl?.style) {
      targetEl.style.transform = `translate3d(${this._state.x}px, ${this._state.y}px, 0) scale(${this._state.scale})`;
    }

    const snapshot = this.getState();
    for (const listener of this._listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("ViewportController listener error:", err);
      }
    }
  }

  /**
   * Get current transform state copy.
   * @returns {{ x: number, y: number, scale: number, baseScale: number, minScale: number, maxScale: number, isPanning: boolean, formattedZoom: string }}
   */
  getState() {
    return {
      ...this._state,
      formattedZoom: this.formatZoomPercent(this._state.scale)
    };
  }

  /**
   * Subscribe to camera state changes.
   * @param {Function} listener
   * @returns {Function} Unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener);
    // Initial notification
    listener(this.getState());
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Destroy and cleanup.
   */
  destroy() {
    this._isDestroyed = true;
    this._stopAnimation();
    this._stopSmoothWheelZoom();
    this._cleanupEventListeners();
    if (this._rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._rafId);
    }
    this._listeners.clear();
  }
}
