// Draws the minimap and its viewport marker.

const FACTION_COLORS = {
  1: "#7ee352",
  2: "#f5d358",
  3: "#5da0ff",
  4: "#baa6e0",
  5: "#cb65ff",
};

function createMinimapPointResolver(nodes, nodePositions) {
  return (nodeId) => {
    const position = nodePositions?.get(String(nodeId));
    if (position) return position;
    const node = (nodes || []).find((item) => String(item.id) === String(nodeId));
    if (node && typeof node.x === "number" && typeof node.y === "number") return { x: node.x, y: node.y };
    return null;
  };
}

function drawMinimapEdges(ctx, nodes, getPoint, scaleX, scaleY) {
  ctx.beginPath();
  ctx.lineWidth = 1.0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  for (const node of nodes || []) {
    const from = getPoint(node.id);
    if (!from) continue;
    for (const nextId of node.next_nodes || node.outgoing || []) {
      const to = getPoint(nextId);
      if (!to) continue;
      ctx.moveTo(from.x * scaleX, from.y * scaleY);
      ctx.lineTo(to.x * scaleX, to.y * scaleY);
    }
  }
  ctx.stroke();
}

function createFactionBuckets() {
  const buckets = new Map();
  for (let branchId = 1; branchId <= 5; branchId += 1) buckets.set(branchId, { dice: [], regular: [] });
  return buckets;
}

function bucketMinimapNodes(nodes, getPoint, scaleX, scaleY, factionBuckets) {
  for (const node of nodes || []) {
    const point = getPoint(node.id);
    if (!point) continue;
    const branchId = Number(node.branch || node.faction || 1) || 1;
    const bucket = factionBuckets.get(branchId) || factionBuckets.get(1);
    const isLarge = Boolean(node.is_base || node.node_type === "DICE" || node.type === "DICE");
    bucket[isLarge ? "dice" : "regular"].push({ x: point.x * scaleX, y: point.y * scaleY });
  }
}

function drawMinimapCircles(ctx, points, radius, color) {
  if (points.length === 0) return;
  ctx.beginPath();
  points.forEach(({ x, y }) => {
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  });
  ctx.fillStyle = color;
  ctx.fill();
}

function drawFactionBuckets(ctx, factionBuckets) {
  factionBuckets.forEach((bucket, branchId) => {
    const color = FACTION_COLORS[branchId] || FACTION_COLORS[1];
    drawMinimapCircles(ctx, bucket.regular, 2.0, color);
    drawMinimapCircles(ctx, bucket.dice, 3.8, "#ffffff");
    drawMinimapCircles(ctx, bucket.dice, 2.6, color);
  });
}

export class MinimapView {
  /**
   * @param {object} dependencies
   * @param {import("../app/store/app_store.js").AppStore} dependencies.store
   * @param {import("../app/usecases/navigate_viewport.js").NavigateViewportUseCase} dependencies.navigateViewportUseCase
   * @param {HTMLElement} [dependencies.minimapElement]
   * @param {HTMLCanvasElement} [dependencies.canvasElement]
   * @param {HTMLElement} [dependencies.windowElement]
   * @param {number} [dependencies.mapWidth]
   * @param {number} [dependencies.mapHeight]
   */
  constructor({
    store,
    navigateViewportUseCase,
    minimapElement,
    canvasElement,
    windowElement,
    mapWidth = 4000,
    mapHeight = 3400
  }) {
    this.store = store;
    this.navigateViewportUseCase = navigateViewportUseCase;
    this.minimapEl = minimapElement;
    this.canvasEl = canvasElement;
    this.windowEl = windowElement;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    this.baseOffscreenCanvas = null;
    this._unsubscribe = null;
    this._initialized = false;
    this._cachedVpWidth = null;
    this._cachedVpHeight = null;
    this._lastWindowTransform = null;
    this._boundClick = (event) => this._handleClick(event);
    this._boundResize = () => this._updateCachedDimensions();
  }

  _updateCachedDimensions() {
    const vpEl = typeof document !== "undefined" ? (document.querySelector("#viewport") || document.body) : null;
    this._cachedVpWidth = vpEl?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1280);
    this._cachedVpHeight = vpEl?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 800);
  }

  /**
   * Initialize minimap.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._updateCachedDimensions();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this._boundResize);
    }
    if (this.minimapEl) {
      this.minimapEl.addEventListener("click", this._boundClick);
    }
    this._unsubscribe = this.store.subscribe((state, action) => {
      if (
        action?.type !== "UPDATE_VIEWPORT" &&
        action?.type !== "SET_VIEWPORT"
      ) {
        return;
      }
      this.render(state);
    });
    const initialState = this.store.getState?.();
    if (initialState?.viewport) {
      this.render(initialState);
    }
  }

  /**
   * Pre-bake static node bitmap and batch-drawn edges onto offscreen canvas (O(1) frame render).
   * @param {Array<object>} nodes
   * @param {Map<string, { x: number, y: number }>} nodePositions
   */
  prebake(nodes, nodePositions) {
    if (typeof document === "undefined" || !this.canvasEl) return;

    const w = this.canvasEl.width || 400;
    const h = this.canvasEl.height || 340;
    const scaleX = w / this.mapWidth;
    const scaleY = h / this.mapHeight;

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = w;
    baseCanvas.height = h;
    const ctx = baseCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0b0d13";
    ctx.fillRect(0, 0, w, h);
    const getPoint = createMinimapPointResolver(nodes, nodePositions);
    drawMinimapEdges(ctx, nodes, getPoint, scaleX, scaleY);
    const factionBuckets = createFactionBuckets();
    bucketMinimapNodes(nodes, getPoint, scaleX, scaleY, factionBuckets);
    drawFactionBuckets(ctx, factionBuckets);

    this.baseOffscreenCanvas = baseCanvas;
    this._drawBaseToCanvas();
  }

  _drawBaseToCanvas() {
    if (!this.canvasEl || !this.baseOffscreenCanvas) return;
    const ctx = this.canvasEl.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      ctx.drawImage(this.baseOffscreenCanvas, 0, 0);
    }
  }

  _handleClick(e) {
    if (!this.minimapEl) return;
    const rect = this.minimapEl.getBoundingClientRect();
    const mapX = ((e.clientX - rect.left) / rect.width) * this.mapWidth;
    const mapY = ((e.clientY - rect.top) / rect.height) * this.mapHeight;

    const vpEl = document.querySelector("#viewport") || document.body;
    const vpWidth = vpEl?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1280);
    const vpHeight = vpEl?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 800);

    const vpState = this.store.getState().viewport || { scale: 1.0 };
    const currentScale = vpState.scale || 1.0;

    // Pan without changing the zoom scale.
    const targetX = vpWidth / 2 - mapX * currentScale;
    const targetY = vpHeight / 2 - mapY * currentScale;

    if (this.navigateViewportUseCase?.viewportController?.panTo) {
      this.navigateViewportUseCase.viewportController.panTo(targetX, targetY, true);
    } else {
      this.navigateViewportUseCase.locateNode(null, { x: mapX, y: mapY }, currentScale);
    }
  }

  /**
   * Update minimap viewport indicator window with exact perspective projection.
   * @param {object} state
   */
  render(state) {
    if (!this.windowEl) return;
    const { viewport } = state;
    if (!viewport) return;

    const scale = viewport.scale || 1.0;
    const panX = viewport.x || 0;
    const panY = viewport.y || 0;

    const vpWidth = this._cachedVpWidth || (typeof window !== "undefined" ? window.innerWidth : 1280);
    const vpHeight = this._cachedVpHeight || (typeof window !== "undefined" ? window.innerHeight : 800);

    const worldLeft = -panX / scale;
    const worldTop = -panY / scale;
    const worldWidth = vpWidth / scale;
    const worldHeight = vpHeight / scale;

    const leftPercent = (worldLeft / this.mapWidth) * 100;
    const topPercent = (worldTop / this.mapHeight) * 100;
    const widthPercent = (worldWidth / this.mapWidth) * 100;
    const heightPercent = (worldHeight / this.mapHeight) * 100;

    // No hard clamping allows smooth rubber-band visual reflection. Keep the
    // indicator on the compositor path: left/top/width/height would invalidate
    // layout on every pinch sample, while transform only repaints this small
    // overlay.
    const nextTransform = `translate3d(${leftPercent}%, ${topPercent}%, 0) scale(${widthPercent / 100}, ${heightPercent / 100})`;
    if (nextTransform !== this._lastWindowTransform) {
      this.windowEl.style.transform = nextTransform;
      this._lastWindowTransform = nextTransform;
    }
  }

  /**
   * Destroy.
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this._boundResize);
    }
    this.minimapEl?.removeEventListener?.("click", this._boundClick);
    this._lastWindowTransform = null;
    this._initialized = false;
  }
}
