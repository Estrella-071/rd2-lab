import { SpineEnginePort } from "../app/ports/spine_engine_port.js";

function disposeSpineResources(targetCanvas) {
  if (!targetCanvas) return;
  try {
    if (targetCanvas.assetManager && typeof targetCanvas.assetManager.dispose === "function") {
      targetCanvas.assetManager.dispose();
    }
    if (targetCanvas.renderer && typeof targetCanvas.renderer.dispose === "function") {
      targetCanvas.renderer.dispose();
    }
    if (typeof targetCanvas.dispose === "function") {
      targetCanvas.dispose();
    }
  } catch (error) {
    console.warn("SpineWebglEngine: error during instance disposal", error);
  }
}

function settleSpinePromise(state, value) {
  if (!state.pendingResolve) return;
  const resolve = state.pendingResolve;
  state.pendingResolve = null;
  resolve(value);
}

function disposeSpineInstance(state) {
  if (state.isDisposed) return;
  state.isDisposed = true;
  state.engine._instances.delete(state.visualElement);
  if (state.resizeObserver) {
    try {
      state.resizeObserver.disconnect();
    } catch (_) {
      // Observer cleanup is best effort when a browser has already detached it.
    }
    state.resizeObserver = null;
  }
  settleSpinePromise(state, null);
  disposeSpineResources(state.instanceRecord.spineCanvas || state.spineCanvas);
  state.spineCanvas = null;
  state.instanceRecord.spineCanvas = null;
  state.skeleton = null;
  state.animationState = null;
  state.engine._updateVisualStatus(state.visualElement, "STATIC", false);
}

function failSpineInstance(state, message, details) {
  console.warn(`SpineWebglEngine: ${message}`, details);
  state.instanceRecord.dispose();
  state.engine._updateVisualStatus(state.visualElement, "STATIC", true);
}

function prepareSpineCanvas(visualElement, canvas) {
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  if (typeof window !== "undefined" && typeof visualElement.getBoundingClientRect === "function") {
    const rect = visualElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
  }
  return dpr;
}

function animationPlan(data, requestedAnimation) {
  const animationName = data.findAnimation(requestedAnimation)
    ? requestedAnimation
    : (data.animations[0]?.name || null);
  return {
    animationName,
    iconChangeAnimationName: data.findAnimation("iconchange") ? "iconchange" : null,
    entryAnimationName: data.findAnimation("appeared") ? "appeared" : null
  };
}

function playSpineAnimations(state, plan) {
  const { iconChangeAnimationName, entryAnimationName, animationName } = plan;
  if (iconChangeAnimationName && entryAnimationName && animationName) {
    state.animationState.setAnimation(0, iconChangeAnimationName, false);
    state.animationState.addAnimation(0, entryAnimationName, false, 0);
    state.animationState.addAnimation(0, animationName, true, 0);
  } else if (entryAnimationName && animationName && entryAnimationName !== animationName) {
    state.animationState.setAnimation(0, entryAnimationName, false);
    state.animationState.addAnimation(0, animationName, true, 0);
  } else if (animationName) {
    state.animationState.setAnimation(0, animationName, true);
  }
}

function updateSkeletonWorld(state) {
  if (state.spine.Physics?.update) state.skeleton.updateWorldTransform(state.spine.Physics.update);
}

function fitSpineSkeleton(state, canvasApi) {
  if (!state.skeleton) return;
  state.skeleton.scaleX = 1;
  state.skeleton.scaleY = 1;
  state.skeleton.x = 0;
  state.skeleton.y = 0;
  updateSkeletonWorld(state);
  const offset = new state.spine.Vector2();
  const size = new state.spine.Vector2();
  if (typeof state.skeleton.getBounds === "function") state.skeleton.getBounds(offset, size);
  const viewportWidth = canvasApi.renderer.camera?.viewportWidth || state.canvas.width || 300;
  const viewportHeight = canvasApi.renderer.camera?.viewportHeight || state.canvas.height || 300;
  const fitScale = size.x > 0 && size.y > 0
    ? Math.min(viewportWidth / (size.x * 1.2), viewportHeight / (size.y * 1.2))
    : 1;
  const scale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  state.skeleton.scaleX = scale;
  state.skeleton.scaleY = scale;
  state.skeleton.x = -(offset.x + size.x / 2) * scale;
  state.skeleton.y = -(offset.y + size.y / 2) * scale;
}

function warmSpinePose(state, plan) {
  if (plan.entryAnimationName || plan.iconChangeAnimationName) {
    if (plan.entryAnimationName) {
      state.animationState.setAnimation(0, plan.entryAnimationName, false);
      state.animationState.apply(state.skeleton);
      updateSkeletonWorld(state);
      playSpineAnimations(state, plan);
    }
    state.animationState.apply(state.skeleton);
    updateSkeletonWorld(state);
  } else {
    state.skeleton.setToSetupPose();
    updateSkeletonWorld(state);
  }
}

function observeSpineResize(state, api) {
  if (typeof ResizeObserver !== "function" || !state.visualElement) return;
  state.resizeObserver = new ResizeObserver(() => {
    if (state.isDisposed) return;
    const next = state.visualElement.getBoundingClientRect();
    state.canvas.width = Math.max(1, Math.round(next.width * state.dpr));
    state.canvas.height = Math.max(1, Math.round(next.height * state.dpr));
    if (typeof api.renderer?.resize === "function" && state.spine.ResizeMode) api.renderer.resize(state.spine.ResizeMode.Fit);
    fitSpineSkeleton(state, api);
  });
  state.resizeObserver.observe(state.visualElement);
}

function markSpineReady(state, api) {
  state.instanceRecord.isReady = true;
  state.instanceRecord.spineCanvas = state.spineCanvas;
  state.instanceRecord.skeleton = state.skeleton;
  state.instanceRecord.animationState = state.animationState;
  if (state.visualElement?.classList) {
    state.visualElement.classList.remove("is-error", "is-static");
    state.visualElement.classList.add("is-ready");
  }
  if (state.poster) state.poster.setAttribute("aria-hidden", "true");
  if (state.status) {
    state.status.textContent = state.engine.statusLabels.live;
    if (state.status.classList) state.status.classList.add("is-live");
  }
  settleSpinePromise(state, state.instanceRecord);
}

function initializeSpineCanvas(api, state) {
  if (state.isDisposed) return;
  try {
    const atlasText = api.assetManager.get(state.spineDefinition.atlas);
    const atlas = new state.spine.TextureAtlas(atlasText);
    const atlasRoot = state.spineDefinition.atlas.slice(0, state.spineDefinition.atlas.lastIndexOf("/") + 1);
    atlas.setTextures(api.assetManager, atlasRoot);
    const binary = new state.spine.SkeletonBinary(new state.spine.AtlasAttachmentLoader(atlas));
    binary.scale = 1;
    const data = binary.readSkeletonData(api.assetManager.get(state.spineDefinition.skeleton));
    state.skeleton = new state.spine.Skeleton(data);
    const stateData = new state.spine.AnimationStateData(data);
    state.animationState = new state.spine.AnimationState(stateData);
    const plan = animationPlan(data, state.spineDefinition.animation);
    playSpineAnimations(state, plan);
    warmSpinePose(state, plan);
    if (typeof api.renderer?.resize === "function" && state.spine.ResizeMode) api.renderer.resize(state.spine.ResizeMode.Fit);
    fitSpineSkeleton(state, api);
    observeSpineResize(state, api);
    markSpineReady(state, api);
  } catch (error) {
    failSpineInstance(state, "error creating skeleton", error);
  }
}

function updateSpineCanvas(api, delta, state) {
  if (state.isDisposed || !state.animationState || !state.skeleton) return;
  state.animationState.update(delta);
  state.animationState.apply(state.skeleton);
  updateSkeletonWorld(state);
}

function renderSpineCanvas(api, state) {
  if (state.isDisposed || !state.skeleton) return;
  if (typeof api.clear === "function") api.clear(0, 0, 0, 0);
  if (!api.renderer) return;
  api.renderer.begin();
  api.renderer.drawSkeleton(state.skeleton, false);
  api.renderer.end();
}

function createSpineCallbacks(state) {
  return {
    loadAssets: (api) => {
      if (state.isDisposed) return;
      api.assetManager.loadBinary(state.spineDefinition.skeleton);
      api.assetManager.loadText(state.spineDefinition.atlas);
      api.assetManager.loadTexture(state.spineDefinition.texture);
    },
    initialize: (api) => initializeSpineCanvas(api, state),
    update: (api, delta) => updateSpineCanvas(api, delta, state),
    render: (api) => renderSpineCanvas(api, state),
    error: (canvasOrApi, errors) => failSpineInstance(state, "SpineCanvas runtime error", errors)
  };
}

function createSpineInstanceState({ engine, spine, visualElement, spineDefinition, canvas, poster, status, dpr }) {
  const state = {
    engine,
    spine,
    visualElement,
    spineDefinition,
    canvas,
    poster,
    status,
    dpr,
    isDisposed: false,
    spineCanvas: null,
    skeleton: null,
    animationState: null,
    resizeObserver: null,
    pendingResolve: null,
    instanceRecord: null
  };
  state.instanceRecord = {
    element: visualElement,
    isReady: false,
    canvas,
    dispose: () => disposeSpineInstance(state)
  };
  return state;
}

function startSpineCanvas(state) {
  return new Promise((resolve) => {
    if (state.isDisposed) {
      resolve(null);
      return;
    }
    state.pendingResolve = resolve;
    try {
      const createdSpineCanvas = new state.spine.SpineCanvas(state.canvas, {
        pathPrefix: "",
        webglConfig: { alpha: true, premultipliedAlpha: false, antialias: true },
        app: createSpineCallbacks(state)
      });
      state.spineCanvas = createdSpineCanvas;
      if (state.isDisposed) disposeSpineResources(createdSpineCanvas);
    } catch (error) {
      failSpineInstance(state, "SpineCanvas initialization failed", error);
    }
  });
}

// Owns Spine rendering contexts. Only one context may be active at a time.
export class SpineWebglEngine extends SpineEnginePort {
  /**
   * @param {object} [options]
   * @param {number} [options.maxActiveContexts] - Maximum concurrent active contexts (default: 1)
   * @param {any} [options.spineRuntime] - Injected spine global or defaults to globalThis.spine
   */
  constructor(options = {}) {
    super();
    this.maxActiveContexts = options.maxActiveContexts !== undefined ? options.maxActiveContexts : 1;
    this.spineRuntime = options.spineRuntime || (typeof globalThis !== "undefined" ? globalThis.spine : null);
    this.statusLabels = {
      loading: options.statusLabels?.loading || "載入",
      static: options.statusLabels?.static || "STATIC",
      live: options.statusLabels?.live || "SPINE",
      error: options.statusLabels?.error || "ERROR"
    };
    this._instances = new Map(); // Map<HTMLElement, InstanceRecord>
  }

  setStatusLabels(labels = {}) {
    this.statusLabels = {
      ...this.statusLabels,
      ...Object.fromEntries(Object.entries(labels).filter(([, value]) => String(value || "").trim() !== ""))
    };
  }

  _evictOldestContext() {
    while (this._instances.size >= this.maxActiveContexts) {
      const oldestKey = this._instances.keys().next().value;
      if (!oldestKey) return;
      const oldestInstance = this._instances.get(oldestKey);
      if (oldestInstance) oldestInstance.dispose();
      else this._instances.delete(oldestKey);
    }
  }

  /**
   * Get the runtime Spine library object.
   */
  getSpine() {
    return this.spineRuntime || (typeof globalThis !== "undefined" ? globalThis.spine : null);
  }

  /**
   * Acquire a Spine animation canvas instance for a visual container.
   * @param {HTMLElement} visualElement
   * @param {object} spineDefinition
   * @returns {Promise<object|null>}
   */
  async acquireCanvas(visualElement, spineDefinition) {
    if (!visualElement || visualElement.dataset?.spineDisabled === "true") return null;
    if (this._instances.has(visualElement)) return this._instances.get(visualElement);
    this._evictOldestContext();
    const spine = this.getSpine();
    if (!spine?.SpineCanvas) {
      this._updateVisualStatus(visualElement, "STATIC", true);
      return null;
    }
    const actualSpineDef = spineDefinition?.spine || spineDefinition;
    if (!actualSpineDef?.skeleton) {
      this._updateVisualStatus(visualElement, "STATIC", true);
      return null;
    }
    const canvas = visualElement.querySelector(".monster-spine-canvas");
    if (!canvas) return null;
    const poster = visualElement.querySelector(".monster-spine-poster");
    const status = visualElement.querySelector(".monster-spine-status");
    const dpr = prepareSpineCanvas(visualElement, canvas);
    const state = createSpineInstanceState({
      engine: this,
      spine,
      visualElement,
      spineDefinition: actualSpineDef,
      canvas,
      poster,
      status,
      dpr
    });
    this._instances.set(visualElement, state.instanceRecord);
    this._updateVisualStatus(visualElement, "loading", false);
    return startSpineCanvas(state);
  }

  /**
   * Release and dispose the active Spine canvas instance associated with the element.
   * @param {HTMLElement} visualElement
   */
  releaseCanvas(visualElement) {
    const record = this._instances.get(visualElement);
    if (record) {
      record.dispose();
    }
  }

  /**
   * Dispose all active WebGL contexts and clear instances.
   */
  disposeAll() {
    for (const record of Array.from(this._instances.values())) {
      try {
        record.dispose();
      } catch (_) {}
    }
    this._instances.clear();
  }

  /**
   * Alias for disposeAll to satisfy port lifecycle contracts.
   */
  dispose() {
    this.disposeAll();
  }

  /**
   * Get the current count of active WebGL contexts.
   * @returns {number}
   */
  getActiveContextCount() {
    let count = 0;
    for (const record of this._instances.values()) {
      if (record.isReady) count++;
    }
    return count;
  }

  _updateVisualStatus(visualElement, text, isStatic = false) {
    if (visualElement?.classList) {
      visualElement.classList.remove("is-ready");
      visualElement.classList.toggle?.("is-static", isStatic);
      if (text === "ERROR" || text === "error") {
        visualElement.classList.add("is-error");
      } else {
        visualElement.classList.remove("is-error");
      }
    }
    const status = visualElement?.querySelector?.(".monster-spine-status");
    if (status) {
      const textByState = {
        loading: this.statusLabels.loading,
        STATIC: this.statusLabels.static,
        static: this.statusLabels.static,
        ERROR: this.statusLabels.error,
        error: this.statusLabels.error
      };
      status.textContent = textByState[text] || text;
      if (status.classList && typeof status.classList.remove === "function") {
        status.classList.remove("is-live");
      }
    }
  }
}
