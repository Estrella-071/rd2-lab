import { DataRepositoryPort } from "../app/ports/data_repository_port.js";

const FRESH_REQUEST_OPTIONS = Object.freeze({ cache: "no-store" });

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
      throw new Error(`Failed to load monster visuals from ${url}: HTTP status ${response.status}`);
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
    const [treeData, svgText, bossEvents, monsterPosters, metadata, changelog, locales] = await Promise.all([
      this.loadDiceTree(options.diceTreeUrl),
      this.loadDiceTreeSvg(options.diceTreeSvgUrl),
      this.loadBossEvents(options.bossEventsUrl),
      this.loadMonsterPosters(options.monsterPostersUrl),
      this.loadGameMetadata(options.gameMetadataUrl).catch(() => null),
      this.loadChangelog(options.changelogUrl).catch(() => null),
      this.loadLocales(options.localesUrl)
    ]);
    return { treeData, svgText, bossEvents, monsterPosters, metadata, changelog, locales };
  }

  /**
   * Clear cache.
   */
  clearCache() {
    this._cacheGeneration += 1;
    this._cache.clear();
  }
}
