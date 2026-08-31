// Keep the complete 1x coverage set (56 map tiles plus the normal atlas
// pages) available after the first paint.  The cache is still bounded and
// higher-resolution promotion naturally evicts the least-recently-used 1x
// entries when device memory is constrained.
const DEFAULT_TILE_CACHE_LIMIT = 96;
import { selectMapResolution } from "../domain/map_resolution.js";
import { assertMapRenderManifestShape } from "./http_data_repository.js";

const DEFAULT_IMAGE_TIMEOUT_MS = 10000;

function normalizeScale(value) {
  return Math.max(1, Math.min(3, Math.round(Number(value) || 1)));
}

function appendVersion(url, releaseId) {
  if (!releaseId) return url;
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(releaseId)}`;
}

export { selectMapResolution } from "../domain/map_resolution.js";

export class LruCache {
  constructor(limit = DEFAULT_TILE_CACHE_LIMIT) {
    this.limit = Math.max(1, Math.floor(Number(limit) || DEFAULT_TILE_CACHE_LIMIT));
    this.entries = new Map();
  }

  get(key) {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    return value;
  }

  has(key) { return this.entries.has(key); }
  delete(key) { return this.entries.delete(key); }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
  values() { return this.entries.values(); }
}

function getTileSet(manifest, scale) {
  return manifest?.tile?.tiles?.[`${normalizeScale(scale)}x`] || null;
}

export class MapTileRepository {
  constructor({ manifest = null, manifestUrl = "map-render-manifest.json", fetchFn = null, imageFactory = null, cacheLimit = DEFAULT_TILE_CACHE_LIMIT, imageTimeoutMs = DEFAULT_IMAGE_TIMEOUT_MS } = {}) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.fetchFn = fetchFn || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    this.imageFactory = imageFactory || (() => (typeof Image === "undefined" ? null : new Image()));
    this.imageTimeoutMs = imageTimeoutMs;
    this.cache = new LruCache(cacheLimit);
    this.pending = new Map();
    this.preloadLinks = new Map();
    this.prefetched = new Set();
    this.tileIndexes = new Map();
    this.currentResolution = null;
    this._destroyed = false;
  }

  async loadManifest() {
    if (this.manifest) return assertMapRenderManifestShape(this.manifest, this.manifestUrl);
    if (!this.fetchFn) throw new Error("MapTileRepository: fetch API is not available.");
    const response = await this.fetchFn(this.manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load map render manifest: HTTP status ${response.status}`);
    this.manifest = await response.json();
    this.tileIndexes.clear();
    return assertMapRenderManifestShape(this.manifest, this.manifestUrl);
  }

  _resolveImageUrl(relativePath) {
    if (typeof document !== "undefined" && document.baseURI) {
      return appendVersion(new URL(relativePath, document.baseURI).href, this.manifest?.assetVersion || this.manifest?.releaseId);
    }
    return appendVersion(relativePath, this.manifest?.assetVersion || this.manifest?.releaseId);
  }

  async loadImage(relativePath) {
    const key = String(relativePath || "");
    if (!key) throw new Error("Map raster image path is empty.");
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.pending.has(key)) return this.pending.get(key);
    const image = this.imageFactory();
    if (!image) throw new Error("Map raster images are not supported by this browser.");
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error = null, value = image) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (error) reject(error);
        else {
          this.cache.set(key, value);
          resolve(value);
        }
      };
      const timeoutId = setTimeout(() => finish(new Error(`Timed out loading map raster: ${key}`)), this.imageTimeoutMs);
      image.onload = async () => {
        try {
          // Decode and transfer the bitmap away from the HTMLImageElement when
          // the browser supports it.  Awaiting image.decode() for every atlas
          // page in one Promise.all can make several 120 Hz frames spend their
          // entire budget in one microtask. ImageBitmap keeps that work off the
          // main rendering task; the Image fallback is retained for WebKit and
          // older embedded browsers that do not expose the API.
          if (typeof globalThis.createImageBitmap === "function") {
            try {
              const bitmap = await globalThis.createImageBitmap(image);
              image.onload = null;
              image.onerror = null;
              finish(null, bitmap);
              return;
            } catch {
              // Fall through to the browser's native image decode path.
            }
          }
          if (typeof image.decode === "function") await image.decode();
          finish();
        } catch (error) {
          finish(error);
        }
      };
      image.onerror = () => finish(new Error(`Failed to load map raster: ${key}`));
      image.decoding = "async";
      image.src = this._resolveImageUrl(key);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Warm decoded images during idle time without making a gesture wait for a
   * large Promise.all decode burst. The renderer can stop between images when
   * a camera gesture begins; a single already-running image load is the only
   * work that can cross that boundary.
   */
  prefetchImage(relativePath) {
    const key = String(relativePath || "");
    if (!key || this.cache.has(key) || this.prefetched.has(key)) return Promise.resolve();
    const existing = this.preloadLinks.get(key);
    if (existing) return existing;
    if (typeof document === "undefined" || !document.head) return Promise.resolve();
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.dataset.rd2MapPrefetch = "true";
    link.href = this._resolveImageUrl(key);
    link.fetchPriority = "low";
    const promise = new Promise((resolve, reject) => {
      link.onload = () => {
        this.preloadLinks.delete(key);
        this.prefetched.add(key);
        // Keep the preload link in <head> until the repository is destroyed.
        // Removing a large-image preload as it completes can trigger a style
        // recalculation at exactly the wrong time (for example during a
        // 120Hz pinch gesture).  It is inert and has no layout footprint.
        resolve();
      };
      link.onerror = () => {
        this.preloadLinks.delete(key);
        link.remove();
        reject(new Error(`Failed to prefetch map raster: ${key}`));
      };
    });
    this.preloadLinks.set(key, promise);
    document.head.appendChild(link);
    return promise;
  }

  prefetchImages(paths = []) {
    return Promise.all([...new Set(paths.map(String))].map((pathname) => this.prefetchImage(pathname)));
  }

  /**
   * Decode a small, viewport-scoped set before the camera settles. The
   * preload links above only warm the HTTP cache; a resolution change still
   * needs decoded images before the renderer can atomically promote a frame.
   * `shouldContinue` is checked before every image so a new gesture stops the
   * idle queue instead of competing with pointer RAFs.
   */
  async warmImages(paths = [], { shouldContinue = null } = {}) {
    const uniquePaths = [...new Set(paths.map(String))]
      .filter((pathname) => pathname && !this.cache.has(pathname));
    for (const pathname of uniquePaths) {
      if (typeof shouldContinue === "function" && !shouldContinue()) return false;
      await this.loadImage(pathname);
      if (uniquePaths.at(-1) !== pathname) {
        await new Promise((resolve) => {
          if (typeof globalThis.requestIdleCallback === "function") {
            globalThis.requestIdleCallback(resolve, { timeout: 80 });
          } else if (typeof globalThis.requestAnimationFrame === "function") {
            globalThis.requestAnimationFrame(resolve);
          } else {
            setTimeout(resolve, 0);
          }
        });
      }
    }
    return true;
  }

  releaseImage(relativePath) {
    const key = String(relativePath || "");
    if (!key || this.pending.has(key)) return false;
    const image = this.cache.get(key);
    if (!image) return false;
    this.cache.delete(key);
    image.close?.();
    return true;
  }

  _getTileIndex(scale) {
    const selectedScale = normalizeScale(scale);
    const key = `${selectedScale}x`;
    if (this.tileIndexes.has(key)) return this.tileIndexes.get(key);
    const tileSet = getTileSet(this.manifest, selectedScale);
    const index = new Map((tileSet?.files || []).map((entry) => [
      `${Number(entry.column)}:${Number(entry.row)}`,
      entry
    ]));
    this.tileIndexes.set(key, index);
    return index;
  }

  getTileEntries(scale, bounds = null, { prefetchRadius = 1 } = {}) {
    const tileSet = getTileSet(this.manifest, scale);
    if (!tileSet) return [];
    const tileSize = Math.max(1, Number(this.manifest?.tile?.logicalSize) || 512);
    const radius = Math.max(0, Math.min(2, Math.floor(Number(prefetchRadius) || 0)));
    const tileIndex = this._getTileIndex(scale);
    const maxColumn = Math.max(0, Number(tileSet.columns || 1) - 1);
    const maxRow = Math.max(0, Number(tileSet.rows || 1) - 1);
    const minColumn = Math.max(0, Math.min(maxColumn, Math.floor(Number(bounds?.left ?? 0) / tileSize)));
    const minRow = Math.max(0, Math.min(maxRow, Math.floor(Number(bounds?.top ?? 0) / tileSize)));
    const maxVisibleColumn = Math.max(minColumn, Math.min(maxColumn, Math.floor(Math.max(0, Number(bounds?.right ?? (this.manifest?.viewBox?.width || 0)) - 1) / tileSize)));
    const maxVisibleRow = Math.max(minRow, Math.min(maxRow, Math.floor(Math.max(0, Number(bounds?.bottom ?? (this.manifest?.viewBox?.height || 0)) - 1) / tileSize)));
    const entries = [];
    for (let row = Math.max(0, minRow - radius); row <= Math.min(maxRow, maxVisibleRow + radius); row += 1) {
      for (let column = Math.max(0, minColumn - radius); column <= Math.min(maxColumn, maxVisibleColumn + radius); column += 1) {
        const entry = tileIndex.get(`${column}:${row}`);
        if (entry) entries.push(entry);
      }
    }
    return entries;
  }

  getVisibleTileEntries(scale, bounds = null) {
    return this.getTileEntries(scale, bounds, { prefetchRadius: 0 });
  }

  async preloadVisible({ scale = 1, bounds = null, prefetchRadius = 1 } = {}) {
    await this.loadManifest();
    const selectedScale = normalizeScale(scale);
    const entries = this.getTileEntries(selectedScale, bounds, { prefetchRadius });
    const results = await Promise.all(entries.map(async (entry) => ({ entry, image: await this.loadImage(entry.path) })));
    if (!this._destroyed) this.currentResolution = selectedScale;
    return results;
  }

  async preloadAll(scale = 1) {
    await this.loadManifest();
    const selectedScale = normalizeScale(scale);
    const entries = getTileSet(this.manifest, selectedScale)?.files || [];
    const results = await Promise.all(entries.map(async (entry) => ({ entry, image: await this.loadImage(entry.path) })));
    if (!this._destroyed) this.currentResolution = selectedScale;
    return results;
  }

  async ensureResolution({ scale = 1, devicePixelRatio = 1, bounds = null, motion = false, prefetchRadius = 1 } = {}) {
    await this.loadManifest();
    const available = (this.manifest?.tile?.scales || ["1x", "2x", "3x"]).map((value) => Number.parseInt(value, 10));
    const desired = selectMapResolution({ scale, devicePixelRatio, available });
    const selected = motion && this.currentResolution ? this.currentResolution : desired;
    return this.preloadVisible({ scale: selected, bounds, prefetchRadius });
  }

  getCachedImage(pathname) { return this.cache.get(pathname); }

  destroy() {
    this._destroyed = true;
    this.pending.clear();
    if (typeof document !== "undefined") {
      // The link element is removed by the event handlers on normal
      // completion; destroy also handles in-flight links.
      document.querySelectorAll("link[data-rd2-map-prefetch]").forEach((link) => link.remove());
    }
    this.preloadLinks.clear();
    this.prefetched.clear();
    for (const image of this.cache.values()) image?.close?.();
    this.cache.clear();
    this.tileIndexes.clear();
    this.currentResolution = null;
  }
}
