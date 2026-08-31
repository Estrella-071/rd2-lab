import { DataRepositoryPort } from "../app/ports/data_repository_port.js";

const FRESH_REQUEST_OPTIONS = Object.freeze({ cache: "no-store" });
const MAP_ATLAS_MAX_TEXTURE_SIZE = 2048;

function fetchFresh(fetchFn, url) {
  return fetchFn(url, FRESH_REQUEST_OPTIONS);
}

function assertSafeSvgHref(value, url) {
  if (/^#[A-Za-z0-9_.:-]+$/.test(value)) return;
  if (/^icons\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(value)) return;

  throw new Error(`Unsafe dice tree SVG received from ${url}`);
}

export function assertSafeDiceTreeSvg(svgText, url = "dice_tree.svg") {
  const trimmed = String(svgText || "").trim();
  if (!trimmed || !/^<svg(?:\s|>)/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) {
    throw new Error(`Invalid dice tree SVG received from ${url}`);
  }
  if (/<script\b|<foreignObject\b|\son[a-z][\w:-]*\s*=|javascript\s*:/i.test(trimmed)) {
    throw new Error(`Unsafe dice tree SVG received from ${url}`);
  }

  const hrefPattern = /(?:^|[\s<])(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of trimmed.matchAll(hrefPattern)) {
    assertSafeSvgHref(match[1] ?? match[2] ?? match[3] ?? "", url);
  }
}

function assertDiceTreeDataShape(data, url) {
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(data) || !Array.isArray(data.nodes)
    || data.nodes.some((node) => !isRecord(node) || typeof node.id !== "string" || node.id.trim().length === 0)) {
    throw new Error(`Invalid dice tree data format received from ${url}`);
  }
  if (data.edges !== undefined) {
    if (!Array.isArray(data.edges) || data.edges.some((edge) => {
      if (!isRecord(edge)) return true;
      const from = edge.from ?? edge.source;
      const to = edge.to ?? edge.target;
      return typeof from !== "string" || from.length === 0 || typeof to !== "string" || to.length === 0;
    })) {
      throw new Error(`Invalid dice tree data format received from ${url}`);
    }
  }
}

function assertBossEventDataShape(data, url) {
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  const arrays = [data?.events, data?.historical_events, data?.monsters].filter((value) => value !== undefined);
  if (!isRecord(data) || !Array.isArray(data.events) || arrays.some((value) => !Array.isArray(value))) {
    throw new Error(`Invalid boss event data format received from ${url}`);
  }
  for (const collection of arrays) {
    if (collection.some((entry) => !isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0)) {
      throw new Error(`Invalid boss event data format received from ${url}`);
    }
  }
}

function assertSafeAssetPath(value, label, url) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240
    || value.startsWith("/") || value.includes("\\") || value.includes("..")
    || value.includes("://") || /[\u0000-\u001f\u007f]/.test(value)
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) {
    throw new Error(`Invalid monster poster data format received from ${url}: unsafe ${label} path`);
  }
}

function assertRenderManifestPath(value, url) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240
    || value.startsWith("/") || value.includes("\\") || value.includes("..")
    || value.includes("://") || /[\u0000-\u001f\u007f]/.test(value)
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.png$/.test(value)) {
    throw new Error(`Invalid map render manifest received from ${url}: unsafe asset path`);
  }
}

function isManifestRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function rejectInvalidManifest(url) {
  throw new Error(`Invalid map render manifest format received from ${url}`);
}

function assertManifest(condition, url) {
  if (!condition) rejectInvalidManifest(url);
}

function assertManifestRoot(data, url, expectedScales) {
  const viewBox = data?.viewBox;
  const tile = data?.tile;
  assertManifest(isManifestRecord(data), url);
  assertManifest(data.schemaVersion === 1, url);
  assertManifest(isManifestRecord(viewBox), url);
  for (const key of ["x", "y", "width", "height"]) {
    assertManifest(Number.isFinite(Number(viewBox[key])), url);
  }
  assertManifest(Number(viewBox.width) > 0 && Number(viewBox.height) > 0, url);
  assertManifest(isManifestRecord(tile), url);
  assertManifest(tile.logicalSize === 512, url);
  assertManifest(Array.isArray(tile.scales), url);
  assertManifest(JSON.stringify(tile.scales) === JSON.stringify(expectedScales), url);
  assertManifest(Number.isInteger(tile.columns) && tile.columns >= 1, url);
  assertManifest(Number.isInteger(tile.rows) && tile.rows >= 1, url);
  assertManifest(tile.columns === Math.ceil(Number(viewBox.width) / tile.logicalSize), url);
  assertManifest(tile.rows === Math.ceil(Number(viewBox.height) / tile.logicalSize), url);
  assertManifest(Array.isArray(data.nodes) && data.nodes.length === 239, url);
  assertManifest(Array.isArray(data.edges) && data.edges.length === 246, url);
  assertManifest(Array.isArray(data.centerLinks) && data.centerLinks.length === 5, url);
  assertManifest(/^[a-f0-9]{16}$/.test(String(data.assetVersion || "")), url);
}

function assertManifestBounds(value, fields, positiveFields, url) {
  if (value === null || value === undefined) return;
  assertManifest(isManifestRecord(value), url);
  for (const key of fields) assertManifest(Number.isFinite(Number(value[key])), url);
  for (const key of positiveFields) assertManifest(Number(value[key]) > 0, url);
}

function assertManifestFrame(frame, frameKey, data, url) {
  assertManifest(isManifestRecord(frame), url);
  for (const key of ["x", "y", "width", "height"]) {
    assertManifest(Number.isFinite(Number(frame[key])), url);
  }
  assertManifest(Number(frame.x) >= 0 && Number(frame.y) >= 0, url);
  assertManifest(Number(frame.width) > 0 && Number(frame.height) > 0, url);
  const atlas = data.atlas?.[frameKey];
  const pageIndex = Number.isInteger(frame.page) ? frame.page : 0;
  const page = Array.isArray(atlas?.pages) ? atlas.pages[pageIndex] : atlas;
  assertManifest(isManifestRecord(atlas), url);
  assertManifest(isManifestRecord(page), url);
  assertManifest(!Array.isArray(atlas.pages) || (pageIndex >= 0 && pageIndex < atlas.pages.length), url);
  assertManifest(Number(frame.x) + Number(frame.width) <= Number(page.width), url);
  assertManifest(Number(frame.y) + Number(frame.height) <= Number(page.height), url);
}

function assertManifestNode(node, ids, data, expectedScales, url) {
  assertManifest(isManifestRecord(node), url);
  assertManifest(typeof node.id === "string" && !ids.has(node.id), url);
  assertManifest(Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y)), url);
  assertManifest(isManifestRecord(node.hitBox), url);
  for (const key of ["x", "y", "width", "height"]) {
    assertManifest(Number.isFinite(Number(node.hitBox[key])), url);
  }
  assertManifest(Number(node.hitBox.width) > 0 && Number(node.hitBox.height) > 0, url);
  assertManifestBounds(node.labelAnchor, ["offsetX", "offsetY", "width", "height", "scale"], ["width", "height", "scale"], url);
  assertManifestBounds(node.rankAnchor, ["offsetX", "offsetY", "width", "height", "radius", "textOffsetX", "textOffsetY", "textSize", "strokeWidth", "scale"], ["width", "height", "radius", "textSize", "strokeWidth", "scale"], url);
  assertManifestBounds(node.artworkBounds, ["x", "y", "width", "height", "scale"], ["width", "height", "scale"], url);
  assertManifest(isManifestRecord(node.frames), url);
  ids.add(node.id);
  for (const scale of expectedScales) assertManifest(isManifestRecord(node.frames[`normal-${scale}`]), url);
  for (const [frameKey, frame] of Object.entries(node.frames)) assertManifestFrame(frame, frameKey, data, url);
}

function assertManifestNodes(data, ids, expectedScales, url) {
  for (const node of data.nodes) assertManifestNode(node, ids, data, expectedScales, url);
}

function assertGeneratedManifestFiles(generatedFiles, url) {
  assertManifest(Array.isArray(generatedFiles) && generatedFiles.includes("map-render-manifest.json"), url);
  const generatedFileSet = new Set();
  for (const relativePath of generatedFiles) {
    assertManifest(!generatedFileSet.has(relativePath), url);
    generatedFileSet.add(relativePath);
    if (relativePath !== "map-render-manifest.json") assertRenderManifestPath(relativePath, url);
  }
  return generatedFileSet;
}

function assertManifestTileSet(tile, viewBox, scale, generatedFileSet, tilePaths, url) {
  const tileSet = tile.tiles?.[scale];
  const expectedScale = Number.parseInt(scale, 10);
  assertManifest(isManifestRecord(tileSet) && tileSet.scale === expectedScale
    && tileSet.columns === tile.columns && tileSet.rows === tile.rows
    && Array.isArray(tileSet.files) && tileSet.files.length === tile.columns * tile.rows, url);
  const coordinates = new Set();
  for (const entry of tileSet.files) {
    assertManifest(isManifestRecord(entry), url);
    assertManifest(Number.isInteger(entry.column) && Number.isInteger(entry.row)
      && entry.column >= 0 && entry.row >= 0
      && entry.column < tile.columns && entry.row < tile.rows
      && Number.isInteger(Number(entry.width)) && Number(entry.width) > 0
      && Number.isInteger(Number(entry.height)) && Number(entry.height) > 0
      && Number(entry.width) === Math.min(tile.logicalSize, Number(viewBox.width) - entry.column * tile.logicalSize)
      && Number(entry.height) === Math.min(tile.logicalSize, Number(viewBox.height) - entry.row * tile.logicalSize), url);
    assertRenderManifestPath(entry.path, url);
    const coordinate = `${entry.column},${entry.row}`;
    assertManifest(!coordinates.has(coordinate) && !tilePaths.has(entry.path), url);
    coordinates.add(coordinate);
    tilePaths.add(entry.path);
    assertManifest(generatedFileSet.has(entry.path), url);
  }
}

function assertManifestTiles(tile, viewBox, expectedScales, generatedFileSet, tilePaths, url) {
  for (const scale of expectedScales) {
    assertManifestTileSet(tile, viewBox, scale, generatedFileSet, tilePaths, url);
  }
}

function assertManifestAtlasPage(page, expectedScale, generatedFileSet, atlasPaths, url) {
  assertManifest(isManifestRecord(page)
    && Number.isInteger(page.columns) && page.columns >= 1
    && Number.isInteger(page.rows) && page.rows >= 1
    && Number.isInteger(page.width) && page.width === page.columns * 192 * expectedScale
    && Number.isInteger(page.height) && page.height === page.rows * 192 * expectedScale
    && page.width <= MAP_ATLAS_MAX_TEXTURE_SIZE && page.height <= MAP_ATLAS_MAX_TEXTURE_SIZE, url);
  assertRenderManifestPath(page.path, url);
  assertManifest(!atlasPaths.has(page.path) && generatedFileSet.has(page.path), url);
  atlasPaths.add(page.path);
}

function assertManifestAtlas(atlas, scale, generatedFileSet, atlasPaths, url) {
  const expectedScale = Number.parseInt(scale, 10);
  assertManifest(isManifestRecord(atlas)
    && Number.isInteger(atlas.columns) && atlas.columns >= 1
    && Number.isInteger(atlas.rows) && atlas.rows >= 1
    && Number.isInteger(atlas.width) && atlas.width > 0
    && Number.isInteger(atlas.height) && atlas.height > 0, url);
  if (Array.isArray(atlas.pages)) {
    assertManifest(atlas.pages.length > 0, url);
    for (const page of atlas.pages) {
      assertManifestAtlasPage(page, expectedScale, generatedFileSet, atlasPaths, url);
    }
    return;
  }
  assertRenderManifestPath(atlas.path, url);
  assertManifest(!atlasPaths.has(atlas.path) && generatedFileSet.has(atlas.path), url);
  atlasPaths.add(atlas.path);
}

function assertManifestAtlases(data, expectedVariants, expectedScales, generatedFileSet, atlasPaths, url) {
  for (const variant of expectedVariants) {
    for (const scale of expectedScales) {
      assertManifestAtlas(data.atlas?.[`${variant}-${scale}`], scale, generatedFileSet, atlasPaths, url);
    }
  }
}

function assertManifestCenters(data, expectedVariants, expectedScales, generatedFileSet, url) {
  for (const variant of expectedVariants) {
    for (const scale of expectedScales) {
      const center = data.center?.[variant]?.[scale];
      const expectedScale = Number.parseInt(scale, 10);
      assertManifest(isManifestRecord(center)
        && center.width === 280 * expectedScale && center.height === 220 * expectedScale, url);
      assertRenderManifestPath(center.path, url);
      assertManifest(generatedFileSet.has(center.path), url);
    }
  }
}

function assertManifestEdges(data, ids, url) {
  const edgeKeys = new Set();
  for (const edge of data.edges) {
    assertManifest(isManifestRecord(edge)
      && typeof edge.from === "string" && typeof edge.to === "string"
      && ids.has(edge.from) && ids.has(edge.to)
      && typeof edge.key === "string" && !edgeKeys.has(edge.key), url);
    edgeKeys.add(edge.key);
  }
}

function assertManifestCenterLinks(data, url) {
  const centerLinkKeys = new Set();
  const centerLinkBranches = new Set();
  const hasPoint = (point) => isManifestRecord(point)
    && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
  for (const link of data.centerLinks) {
    const branch = Number(link?.branch);
    assertManifest(isManifestRecord(link)
      && typeof link.key === "string" && !centerLinkKeys.has(link.key)
      && Number.isInteger(branch) && branch >= 1 && branch <= 5
      && !centerLinkBranches.has(branch)
      && hasPoint(link.from) && hasPoint(link.to)
      && typeof link.d === "string"
      && /^M\s*[-\d.]+[ ,]+[-\d.]+\s+L\s*[-\d.]+[ ,]+[-\d.]+$/i.test(link.d), url);
    centerLinkKeys.add(link.key);
    centerLinkBranches.add(branch);
  }
}

export function assertMapRenderManifestShape(data, url = "map-render-manifest.json") {
  const expectedScales = ["1x", "2x", "3x"];
  const expectedVariants = ["normal", "dice-locked", "rune-locked", "passive-locked"];
  const expectedCenterVariants = ["normal", "simulation"];
  assertManifestRoot(data, url, expectedScales);
  const viewBox = data.viewBox;
  const tile = data.tile;
  const ids = new Set();
  assertManifestNodes(data, ids, expectedScales, url);
  const generatedFileSet = assertGeneratedManifestFiles(data.generatedFiles, url);
  const tilePaths = new Set();
  assertManifestTiles(tile, viewBox, expectedScales, generatedFileSet, tilePaths, url);
  const atlasPaths = new Set();
  assertManifestAtlases(data, expectedVariants, expectedScales, generatedFileSet, atlasPaths, url);
  assertManifestCenters(data, expectedCenterVariants, expectedScales, generatedFileSet, url);
  assertManifestEdges(data, ids, url);
  assertManifestCenterLinks(data, url);
  return data;
}

function assertMonsterPosterDataShape(data, url) {
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(data) || !isRecord(data.monsters)) {
    throw new Error(`Invalid monster poster data format received from ${url}`);
  }

  for (const [id, poster] of Object.entries(data.monsters)) {
    if (!id || !isRecord(poster) || typeof poster.poster !== "string") {
      throw new Error(`Invalid monster poster data format received from ${url}`);
    }
    assertSafeAssetPath(poster.poster, "poster", url);
  }
}

/**
 * HttpDataRepository
 * 
 * Concrete adapter for loading game JSON data via HTTP fetch.
 * Features in-memory caching, fallback path resolution, and response validation.
 */
export class HttpDataRepository extends DataRepositoryPort {
  /**
   * @param {object} [options]
   * @param {string} [options.diceTreeUrl]
   * @param {string} [options.bossEventsUrl]
   * @param {typeof fetch} [options.fetchFn]
   */
  constructor(options = {}) {
    super();
    this.diceTreeUrl = options.diceTreeUrl || "data/dice_tree.json";
    this.diceTreeSvgUrl = options.diceTreeSvgUrl || "data/dice_tree.svg";
    this.renderManifestUrl = options.renderManifestUrl || "map-render-manifest.json";
    this.bossEventsUrl = options.bossEventsUrl || "boss_event_data.json";
    this.monsterPostersUrl = options.monsterPostersUrl || "monster_posters.json";
    this.gameMetadataUrl = options.gameMetadataUrl || "data/game_data_metadata.json";
    this.changelogUrl = options.changelogUrl || "data/changelog.json";
    this.localesUrl = options.localesUrl || "data/locales.json";
    this.fetchFn = options.fetchFn || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    this._cache = new Map();
    this._cacheGeneration = 0;
  }

  /**
   * Load dice tree data via HTTP.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadDiceTree(url = this.diceTreeUrl) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    const response = await fetchFresh(this.fetchFn, url);
    if (!response.ok) {
      throw new Error(`Failed to load dice tree from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    assertDiceTreeDataShape(data, url);
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load dice tree SVG text via HTTP.
   * @param {string} [url]
   * @returns {Promise<string>}
   */
  async loadDiceTreeSvg(url = this.diceTreeSvgUrl) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    const response = await fetchFresh(this.fetchFn, url);
    if (!response.ok) {
      throw new Error(`Failed to load dice tree SVG from ${url}: HTTP status ${response.status}`);
    }
    const svgText = await response.text();
    assertSafeDiceTreeSvg(svgText, url);
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, svgText);
    return svgText;
  }

  /**
   * Load the build-generated Canvas tile/sprite manifest. The canonical SVG
   * remains available as a reviewed source artifact, but it is not part of
   * the normal runtime load path.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadRenderManifest(url = this.renderManifestUrl) {
    if (this._cache.has(url)) return this._cache.get(url);
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    const response = await fetchFresh(this.fetchFn, url);
    if (!response.ok) {
      throw new Error(`Failed to load map render manifest from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    assertMapRenderManifestShape(data, url);
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load boss & wave event data via HTTP.
   * Supports automatic fallback between 'boss_event_data.json' and 'data/boss_event_data.json'.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadBossEvents(url = this.bossEventsUrl) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    let response = await fetchFresh(this.fetchFn, url);
    // Dynamic relative path fallback if requested default path fails
    if (!response.ok && (url === "boss_event_data.json" || url === "data/boss_event_data.json")) {
      const fallbackUrl = url === "boss_event_data.json" ? "data/boss_event_data.json" : "boss_event_data.json";
      try {
        const fallbackRes = await fetchFresh(this.fetchFn, fallbackUrl);
        if (fallbackRes.ok) {
          response = fallbackRes;
        }
      } catch {
        // Keep original failed response
      }
    }
    if (!response.ok) {
      throw new Error(`Failed to load boss events from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    assertBossEventDataShape(data, url);
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load the static monster poster manifest via HTTP.
   * Supports automatic fallback between 'monster_posters.json' and 'data/monster_posters.json'.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadMonsterPosters(url = this.monsterPostersUrl) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    let response = await fetchFresh(this.fetchFn, url);
    if (!response.ok && (url === "monster_posters.json" || url === "data/monster_posters.json")) {
      const fallbackUrl = url === "monster_posters.json" ? "data/monster_posters.json" : "monster_posters.json";
      try {
        const fallbackRes = await fetchFresh(this.fetchFn, fallbackUrl);
        if (fallbackRes.ok) {
          response = fallbackRes;
        }
      } catch {
        // Keep original failed response
      }
    }
    if (!response.ok) {
      throw new Error(`Failed to load monster posters from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    assertMonsterPosterDataShape(data, url);
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load the single canonical game-data metadata document.  This is a
   * non-critical companion document, so callers can safely catch failures
   * when running fixture data that predates version metadata.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadGameMetadata(url = this.gameMetadataUrl) {
    if (this._cache.has(url)) return this._cache.get(url);
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    const response = await fetchFresh(this.fetchFn, url);
    if (!response.ok) {
      throw new Error(`Failed to load game metadata from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error(`Invalid game metadata format received from ${url}`);
    }
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load structured changelog data generated from version diffs.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadChangelog(url = this.changelogUrl) {
    if (this._cache.has(url)) return this._cache.get(url);
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    const response = await fetchFresh(this.fetchFn, url);
    if (!response.ok) {
      throw new Error(`Failed to load changelog from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error(`Invalid changelog format received from ${url}`);
    }
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load the four-locale runtime catalog.  The catalog is treated as a
   * required companion: rendering a partially translated tree would make a
   * locale switch appear successful while leaving stale source text behind.
   * @param {string} [url]
   * @returns {Promise<object>}
   */
  async loadLocales(url = this.localesUrl) {
    if (this._cache.has(url)) return this._cache.get(url);
    if (!this.fetchFn) {
      throw new Error("HttpDataRepository: fetch API is not available in the current environment.");
    }
    const cacheGeneration = this._cacheGeneration;
    const response = await fetchFresh(this.fetchFn, url);
    if (!response.ok) {
      throw new Error(`Failed to load locale catalog from ${url}: HTTP status ${response.status}`);
    }
    const data = await response.json();
    const locales = Array.isArray(data?.locales) ? data.locales : [];
    if (!data || typeof data !== "object" || data.schema_version !== 1
      || JSON.stringify(locales) !== JSON.stringify(["zh-tw", "en", "ja", "ko"])) {
      throw new Error(`Invalid locale catalog format received from ${url}`);
    }
    if (cacheGeneration === this._cacheGeneration) this._cache.set(url, data);
    return data;
  }

  /**
   * Load all datasets.
   * @param {object} [options]
   * @returns {Promise<{ treeData: object, svgText: string, bossEvents: object, monsterPosters: object, metadata?: object, changelog?: object, locales?: object }>}
   */
  async loadAll(options = {}) {
    const [treeData, svgText, renderManifest, bossEvents, monsterPosters, metadata, changelog, locales] = await Promise.all([
      this.loadDiceTree(options.diceTreeUrl),
      this.loadDiceTreeSvg(options.diceTreeSvgUrl),
      this.loadRenderManifest(options.renderManifestUrl).catch(() => null),
      this.loadBossEvents(options.bossEventsUrl),
      this.loadMonsterPosters(options.monsterPostersUrl),
      this.loadGameMetadata(options.gameMetadataUrl).catch(() => null),
      this.loadChangelog(options.changelogUrl).catch(() => null),
      this.loadLocales(options.localesUrl)
    ]);
    return { treeData, svgText, renderManifest, bossEvents, monsterPosters, metadata, changelog, locales };
  }

  /**
   * Clear cache.
   */
  clearCache() {
    this._cacheGeneration += 1;
    this._cache.clear();
  }
}
