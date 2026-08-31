import { computeUpstreamTopologyPath } from "../domain/dag_topology.js";

const VIEWPORT_ACTIONS = new Set(["UPDATE_VIEWPORT", "SET_VIEWPORT"]);

/**
 * Coordinates application state and the Canvas renderer. The map surface is
 * intentionally not queried for SVG nodes; semantic HTML buttons are the
 * only interaction targets.
 */
export class TreeView {
  constructor({
    store,
    selectNodeUseCase,
    navigateViewportUseCase,
    container,
    renderer = null,
    localization = null,
    mapScene = null
  }) {
    this.store = store;
    this.selectNodeUseCase = selectNodeUseCase;
    this.navigateViewportUseCase = navigateViewportUseCase;
    this.container = container;
    this.renderer = renderer;
    this.localization = localization;
    this.sceneRoot = mapScene || container?.querySelector?.(".map-scene") || container?.querySelector?.("#scene") || null;
    this.nodePositions = new Map();
    this.nodesMap = new Map();
    this.parsedEdges = [];
    this.edgesMap = new Map();
    this._unsubscribe = null;
    this._initialized = false;
    this._suppressNextClick = false;
    this._suppressClickReason = null;
    this._boundClick = (event) => this._handleClick(event);
    this._boundPointerDown = (event) => this._handlePointerDown(event);
    this._boundPointerUp = () => this._handlePointerUp();
    this._boundViewportDrag = () => {
      this._suppressNextClick = true;
      this._suppressClickReason = "drag";
      // A viewport candidate is world-space content.  It can finish while a
      // drag is in progress when its coverage still contains the moving
      // viewport, so cancel only state/selection work here.  Cancelling that
      // candidate leaves the previous cropped frame on screen and exposes
      // blank map regions during a fast zoom-to-fit gesture.
      this.renderer?.pauseBackgroundRenders?.({ preserveViewportCandidate: true });
    };
  }

  init() {
    if (this._initialized) return this._readyPromise || this;
    this._initialized = true;
    this._setSceneAccessibility();
    this.container?.addEventListener?.("click", this._boundClick);
    this.container?.addEventListener?.("pointerdown", this._boundPointerDown, true);
    if (typeof document !== "undefined") document.addEventListener?.("rd2:viewport-drag", this._boundViewportDrag);
    if (typeof window !== "undefined") {
      window.addEventListener?.("pointerup", this._boundPointerUp);
      window.addEventListener?.("pointercancel", this._boundPointerUp);
    }
    this._unsubscribe = this.store?.subscribe?.((state, action) => this.render(state, action)) || null;
    this.render(this.store?.getState?.() || {});
    return this;
  }

  _setSceneAccessibility() {
    const scene = this.sceneRoot || this.container?.querySelector?.("#scene,.map-scene");
    scene?.setAttribute?.("role", "group");
  }

  _handlePointerDown(event) {
    // A new pointer sequence owns suppression state. Do not clear it from a
    // window-level pointerup: mobile browsers may deliver the synthetic click
    // after that callback, which would turn one blank tap into two actions.
    this._suppressNextClick = false;
    this._suppressClickReason = null;
    const isCompact = typeof window !== "undefined" && window.innerWidth <= 768;
    if (!isCompact) return;
    const selectedNodeId = this.store?.getState?.()?.selectedNodeId;
    const tooltip = typeof document !== "undefined" ? document.getElementById("tooltip") : null;
    if (!selectedNodeId || tooltip?.contains?.(event?.target)) return;
    if (event?.target?.closest?.(".tree-node-semantic")) return;
    const clickedMapSurface = event?.target === this.container
      || event?.target?.id === "viewport"
      || event?.target?.id === "scene"
      || this.sceneRoot?.contains?.(event?.target);
    if (!clickedMapSurface) return;
    this._suppressNextClick = true;
    this._suppressClickReason = "blank-dismiss";
    this._dismissSelection();
  }

  _handlePointerUp() {
    // A drag normally has no activation click. Clear only that suppression
    // on the next task; the browser may still dispatch its activation click in
    // the current task. Blank-tap suppression must survive until that delayed
    // click instead.
    if (this._suppressClickReason !== "drag") return;
    setTimeout(() => {
      if (this._suppressClickReason !== "drag") return;
      this._suppressNextClick = false;
      this._suppressClickReason = null;
    }, 0);
  }

  refreshLocalizedLabels(localization = this.localization) {
    this.localization = localization || null;
    this.renderer?.refreshLocalizedLabels?.(this.localization);
    this.render(this.store?.getState?.() || {}, { type: "LOCALE_CHANGED" });
  }

  setNodePositions(positions) {
    this.nodePositions = positions instanceof Map ? positions : new Map(Object.entries(positions || {}));
  }

  _handleClick(event) {
    if (this._suppressNextClick) {
      this._suppressNextClick = false;
      this._suppressClickReason = null;
      return;
    }
    const nodeButton = event?.target?.closest?.("button.tree-node-semantic[data-node-id], .tree-node-semantic[data-node-id]");
    if (nodeButton) {
      const selectedNodeId = this.store?.getState?.()?.selectedNodeId;
      const isCompact = typeof window !== "undefined" && window.innerWidth <= 768;
      if (isCompact && selectedNodeId && String(selectedNodeId) === String(nodeButton.dataset.nodeId)) {
        // On touch screens a second tap on the anchored node is the explicit
        // close gesture. Keep prerequisite mode until the following blank tap.
        this._dismissSelection();
        return;
      }
      this._selectNode(nodeButton.dataset.nodeId);
      return;
    }
    const tooltip = typeof document !== "undefined" ? document.getElementById("tooltip") : null;
    const clickedMapSurface = event?.target === this.container
      || event?.target?.id === "viewport"
      || event?.target?.id === "scene"
      || this.sceneRoot?.contains?.(event?.target);
    if (clickedMapSurface && !tooltip?.contains?.(event?.target)) {
      this._dismissSelection();
    }
  }

  _dismissSelection() {
    const state = this.store?.getState?.() || {};
    if (state.selectedNodeId) {
      this.selectNodeUseCase?.deselect?.({
        preservePrereqDisplay: Boolean(state.showPrereqMode && state.activePrereqIds?.size)
      });
      return;
    }
    if (state.activePrereqIds?.size) this.selectNodeUseCase?.deselect?.();
  }

  _selectNode(nodeId) {
    const id = String(nodeId || "");
    if (!id) return;
    const point = this.nodePositions.get(id) || this.renderer?.model?.nodesById?.get(id)?.position || null;
    // Selection immediately starts a camera transition.  Cancel stale tile,
    // dynamic-surface, and progressive-node jobs before the new model render
    // so they cannot compete with the transition's first frames.
    this.renderer?.pauseBackgroundRenders?.();
    this.selectNodeUseCase?.execute?.(id, { point, nodePositions: this.nodePositions });
    this.navigateViewportUseCase?.centerOnNodeForTooltip?.(id, false);
  }

  _syncLegacyState(state) {
    this.nodesMap = state?.nodesMap instanceof Map ? state.nodesMap : new Map();
    const edges = state?.treeData?.edges || [];
    this.parsedEdges = edges.map((edge) => {
      const from = String(edge.from || edge.source || edge.startId || "");
      const to = String(edge.to || edge.target || edge.endId || "");
      return { startId: from, endId: to, key: `${from}->${to}` };
    }).filter((edge) => edge.startId && edge.endId);
    this.edgesMap = new Map(this.parsedEdges.map((edge) => [edge.key, edge]));
  }

  render(state, action = null) {
    if (VIEWPORT_ACTIONS.has(action?.type)) {
      // CanvasTreeRenderer owns the viewport request path. Calling its public
      // render method once preserves the adapter contract and avoids the old
      // prepareViewport + render double schedule.
      this.renderer?.render?.(state, action);
      return;
    }
    this._syncLegacyState(state);
    this.renderer?.render?.(state, action);
    const scene = this.sceneRoot || this.container?.querySelector?.("#scene,.map-scene");
    const hasFilter = Boolean(state?.filters?.search || state?.filters?.factions?.size || state?.filters?.nodeTypes?.size);
    const hasPrereq = Boolean(state?.showPrereqMode && state?.activePrereqIds?.size);
    scene?.classList?.toggle?.("has-tree-focus", Boolean(hasFilter || state?.selectedNodeId || hasPrereq));
    scene?.classList?.toggle?.("has-tree-filter", hasFilter);
    scene?.classList?.toggle?.("has-tree-prereq", hasPrereq);
    if (typeof document !== "undefined") document.body?.classList.toggle("simulation-mode", Boolean(state?.simulation?.active));
  }

  getNodeScreenRect(nodeId) {
    return this.renderer?.getNodeScreenRect?.(nodeId) || null;
  }

  renderToCanvas(options = {}) {
    return this.renderer?.renderToCanvas?.(options) || false;
  }

  getFilterPathNodeIds(state) {
    const matching = state?.matchingNodeIds || new Set();
    return computeUpstreamTopologyPath(matching, state?.nodesMap || this.nodesMap).activePathNodeIds;
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.container?.removeEventListener?.("click", this._boundClick);
    this.container?.removeEventListener?.("pointerdown", this._boundPointerDown, true);
    if (typeof document !== "undefined") document.removeEventListener?.("rd2:viewport-drag", this._boundViewportDrag);
    if (typeof window !== "undefined") {
      window.removeEventListener?.("pointerup", this._boundPointerUp);
      window.removeEventListener?.("pointercancel", this._boundPointerUp);
    }
    this.renderer?.destroy?.();
    this.renderer = null;
    this._initialized = false;
    this._suppressNextClick = false;
    this._suppressClickReason = null;
  }
}
