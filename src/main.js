const isTestMode = () => typeof window !== "undefined" && window.__RD2_TEST_MODE__ === true;

if (isTestMode()) {
  window.__RD2_RUNTIME__ = "ready";
}

const SVG_ASSET_WARMUP_TIMEOUT_MS = 8000;
const FONT_WARMUP_TIMEOUT_MS = 5000;
const LOADER_PROGRESS_STEP_MS = 160;

let loaderProgressValue = 0;
let loaderProgressQueue = [];
let loaderProgressTimer = null;
let loaderProgressActive = null;
const svgImageWarmupCache = new Map();

function processLoaderProgressQueue() {
  if (loaderProgressTimer || loaderProgressQueue.length === 0) return;

  const loaderProgressFill = typeof document !== "undefined"
    ? document.getElementById("loader-progress-fill") || document.getElementById("loading-progress-fill")
    : null;
  const loaderStatusLabel = typeof document !== "undefined"
    ? document.getElementById("loader-status-label") || document.getElementById("loading-status-label")
    : null;
  const next = loaderProgressQueue.shift();
  if (!next) return;
  loaderProgressActive = next;

  if (loaderProgressFill) {
    loaderProgressFill.style.setProperty("--progress", `${next.percent}%`);
    loaderProgressFill.style.width = `${next.percent}%`;
  }
  if (loaderStatusLabel && next.labelText) {
    loaderStatusLabel.textContent = next.labelText;
  }

  const changed = next.percent !== loaderProgressValue;
  loaderProgressValue = next.percent;
  if (!changed) {
    loaderProgressActive = null;
    next.resolve();
    processLoaderProgressQueue();
    return;
  }

  loaderProgressTimer = setTimeout(() => {
    loaderProgressTimer = null;
    loaderProgressActive = null;
    next.resolve();
    processLoaderProgressQueue();
  }, LOADER_PROGRESS_STEP_MS);
}

function finishLoaderProgress(labelText = "") {
  if (loaderProgressTimer) {
    clearTimeout(loaderProgressTimer);
    loaderProgressTimer = null;
  }
  if (loaderProgressActive) {
    loaderProgressActive.resolve();
    loaderProgressActive = null;
  }
  for (const pending of loaderProgressQueue.splice(0)) pending.resolve();

  const loaderProgressFill = typeof document !== "undefined"
    ? document.getElementById("loader-progress-fill") || document.getElementById("loading-progress-fill")
    : null;
  const loaderStatusLabel = typeof document !== "undefined"
    ? document.getElementById("loader-status-label") || document.getElementById("loading-status-label")
    : null;
  if (loaderProgressFill) {
    loaderProgressFill.style.setProperty("--progress", "100%");
    loaderProgressFill.style.width = "100%";
  }
  if (loaderStatusLabel && labelText) loaderStatusLabel.textContent = labelText;
  loaderProgressValue = 100;
}

/** Load tree images before the loading screen closes. */
async function warmupSvgImageAssets(svg) {
  if (
    !svg
    || typeof svg.querySelectorAll !== "function"
    || typeof Image === "undefined"
    || typeof document === "undefined"
  ) return { requested: 0, completed: 0 };

  const urls = new Set();
  const baseUrl = document.baseURI || window.location?.href || "";
  svg.querySelectorAll("image").forEach((image) => {
    for (const attribute of ["href", "xlink:href"]) {
      const value = image.getAttribute(attribute);
      if (!value || value.startsWith("#") || /^(?:data|blob):/i.test(value)) continue;
      try {
        urls.add(new URL(value, baseUrl).href);
      } catch {
        // Ignore optional image errors; the normal SVG fallback can continue.
      }
    }
  });
  if (urls.size === 0) return { requested: 0, completed: 0 };

  let completed = 0;
  const loads = [...urls].map((url) => {
    const cached = svgImageWarmupCache.get(url);
    if (cached) {
      completed += 1;
      return cached.promise;
    }

    const image = new Image();
    image.decoding = "async";
    const load = new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (ok) {
          svgImageWarmupCache.set(url, { image, promise: load });
        } else {
          svgImageWarmupCache.delete(url);
        }
        completed += 1;
        resolve();
      };
      image.onload = async () => {
        try {
          if (typeof image.decode === "function") await image.decode();
          finish(true);
        } catch {
          // The SVG can still render if decoding fails.
          finish(true);
        }
      };
      image.onerror = () => finish(false);
      timeoutId = setTimeout(() => finish(false), SVG_ASSET_WARMUP_TIMEOUT_MS);
      image.src = url;
    });
    svgImageWarmupCache.set(url, { image, promise: load });
    return load;
  });
  await Promise.all(loads);
  return { requested: urls.size, completed };
}

/** Wait briefly for fonts before showing the tree. */
async function warmupDocumentFonts() {
  const fontSet = typeof document !== "undefined" ? document.fonts : null;
  if (!fontSet || typeof fontSet.ready?.then !== "function") return false;
  await Promise.race([
    fontSet.ready,
    new Promise((resolve) => setTimeout(resolve, FONT_WARMUP_TIMEOUT_MS))
  ]);
  return true;
}

// Services
import {
  HttpDataRepository,
  SpineWebglEngine,
  ViewportController,
  LocalStorageAdapter,
  HttpShareRepository,
  generateSimulationShareImage
} from "./infra/index.js";

// State and actions
import { AppStore, ActionTypes } from "./app/store/app_store.js";
import {
  LoadGameDataUseCase,
  SelectNodeUseCase,
  SyncGolemRankUseCase,
  FilterTreeUseCase,
  NavigateViewportUseCase,
  SimulationPlanUseCase
} from "./app/usecases/index.js";

// Page components
import {
  TreeView,
  TooltipView,
  CompendiumView,
  MinimapView,
  ControlsView,
  MorphingWidgets,
  ChangelogView,
  SimulationView,
  DetailedStatsView,
  LocaleView,
  applyLocalizationDocument
} from "./ui/index.js";

// Shared calculations
import { shouldPlaceTooltipBelow } from "./domain/tooltip_position.js";
import { resolveGameText } from "./domain/game_text.js";
import { LocalizationService, SUPPORTED_LOCALES } from "./domain/localization.js";

export function setLoaderProgress(percent, labelText = "") {
  if (typeof document === "undefined") return Promise.resolve();
  const target = Math.max(0, Math.min(100, Number(percent) || 0));
  if (target === 100) {
    finishLoaderProgress(labelText);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    loaderProgressQueue.push({ percent: target, labelText, resolve });
    processLoaderProgressQueue();
  });
}

export function dismissLoader(isCurrent = () => true, viewportController = null, owner = null) {
  if (typeof document === "undefined") return;
  const loadingScreen = document.getElementById("loading-screen");
  if (!loadingScreen || (typeof window !== "undefined" && window.__BLOCK_DISMISS_LOADER__)) return;
  const canContinue = () => {
    try {
      return isCurrent();
    } catch {
      return false;
    }
  };
  const ownsLoaderState = () => {
    if (!owner || typeof window === "undefined") return true;
    return window.__RD2_LOADER_OWNER__ === owner;
  };
  const canApply = () => canContinue() && ownsLoaderState();
  if (owner && typeof window !== "undefined") window.__RD2_LOADER_OWNER__ = owner;
  if (!canApply()) return;

  loadingScreen.classList.add("is-loaded");
  if (document.body) {
    document.body.classList.add("app-entering");
  }

  setTimeout(() => {
    if (!canApply()) return;
    loadingScreen.classList.add("is-hidden");
    loadingScreen.hidden = true;
    const targetViewport = viewportController
      || (typeof window !== "undefined" ? window.RD2App?.viewportController : null);
    if (canContinue() && targetViewport) {
      targetViewport.updateCachedDimensions?.();
      targetViewport.resetToCenter(true);
    }
  }, 500);

  setTimeout(() => {
    if (!canApply()) return;
    if (document.body) {
      document.body.classList.remove("app-entering");
    }
  }, 900);
}

function clearOwnedGlobalHooks(globalHooks) {
  if (typeof window === "undefined" || !globalHooks) return;
  const ownedHooks = [
    ["__RD2_CENTER_FOR_TOOLTIP__", globalHooks.center],
    ["__COMPENDIUM_HOOKS__", globalHooks.compendium],
    ["__TEST_HOOKS__", globalHooks.test]
  ];
  for (const [name, hook] of ownedHooks) {
    if (window[name] !== hook) continue;
    try {
      delete window[name];
    } catch {
      window[name] = undefined;
    }
  }
}

function destroyApplicationViews(views) {
  const orderedViews = [
    views.changelogView,
    views.localeView,
    views.morphingWidgets,
    views.controlsView,
    views.minimapView,
    views.compendiumView,
    views.simulationView,
    views.tooltipView,
    views.treeView
  ];
  for (const view of orderedViews) {
    try {
      view?.destroy?.();
    } catch (error) {
      console.warn("Application view cleanup failed:", error);
    }
  }
  for (const key of Object.keys(views)) views[key] = null;
}

function unsubscribeApplicationViewport(application) {
  if (!application._viewportUnsubscribe) return;
  try {
    application._viewportUnsubscribe();
  } catch (error) {
    console.warn("Application viewport subscription cleanup failed:", error);
  }
  application._viewportUnsubscribe = null;
}

function disposeApplicationServices(application) {
  try {
    application.viewportController.destroy();
  } catch (error) {
    console.warn("Application viewport cleanup failed:", error);
  }
  try {
    application.spineEngine.dispose();
  } catch (error) {
    console.warn("Application Spine cleanup failed:", error);
  }
  application.nodePositions.clear();
  application._localeUnsubscribe?.();
  application._localeUnsubscribe = null;
}

export class Application {
  constructor() {
    // Services used by the page.
    this.storage = new LocalStorageAdapter("rd2_");
    this.dataRepo = new HttpDataRepository({
      diceTreeUrl: "data/dice_tree.json",
      diceTreeSvgUrl: "data/dice_tree.svg",
      bossEventsUrl: "boss_event_data.json",
      monsterVisualsUrl: "monster_visuals.json",
      gameMetadataUrl: "data/game_data_metadata.json",
      changelogUrl: "data/changelog.json",
      localesUrl: "data/locales.json"
    });
    this.spineEngine = new SpineWebglEngine({
      maxActiveContexts: 1
    });
    this.viewportController = new ViewportController({
      mapWidth: 4000,
      mapHeight: 3400
    });

    // Shared state.
    this.store = new AppStore();

    // Actions that update the state.
    this.loadGameDataUseCase = new LoadGameDataUseCase({
      store: this.store,
      dataRepository: this.dataRepo
    });
    this.selectNodeUseCase = new SelectNodeUseCase({
      store: this.store
    });
    this.syncGolemRankUseCase = new SyncGolemRankUseCase({
      store: this.store
    });
    this.filterTreeUseCase = new FilterTreeUseCase({
      store: this.store
    });
    this.navigateViewportUseCase = new NavigateViewportUseCase({
      store: this.store,
      viewportController: this.viewportController
    });
    this.simulationPlanUseCase = new SimulationPlanUseCase({
      store: this.store,
      shareImageExporter: { generate: generateSimulationShareImage },
      shareRepository: new HttpShareRepository()
    });

    // Keep view instances together.
    this.views = {
      treeView: null,
      tooltipView: null,
      compendiumView: null,
      minimapView: null,
      controlsView: null,
      morphingWidgets: null,
      changelogView: null,
      simulationView: null,
      localeView: null
    };

    // Node positions used for centering.
    this.nodePositions = new Map();
    this._initialized = false;
    this._initializing = null;
    this._viewportUnsubscribe = null;
    this._localeUnsubscribe = null;
    this._globalHooks = null;
    this._lifecycleGeneration = 0;
    this._loaderDismissTimer = null;
  }

  _t(key, values = {}, fallback = "") {
    return this.localization?.t?.(key, values, fallback) || fallback || key;
  }

  // Start once and reuse an in-flight start.
  async init() {
    if (this._initialized) return true;
    if (this._initializing !== null) return this._initializing;

    const generation = this._lifecycleGeneration;
    const bootstrapPromise = this._bootstrap(generation);
    this._initializing = bootstrapPromise;
    try {
      const initialized = await bootstrapPromise;
      if (initialized && generation === this._lifecycleGeneration) {
        this._initialized = true;
        return true;
      }
      return false;
    } finally {
      if (this._initializing === bootstrapPromise) this._initializing = null;
    }
  }

  // Release startup resources so a retry starts cleanly.
  _cleanupBootstrap() {
    if (this._loaderDismissTimer) {
      clearTimeout(this._loaderDismissTimer);
      this._loaderDismissTimer = null;
    }
    clearOwnedGlobalHooks(this._globalHooks);
    this._globalHooks = null;

    if (typeof window !== "undefined" && window.__RD2_LOADER_OWNER__ === this) {
      try {
        delete window.__RD2_LOADER_OWNER__;
      } catch {
        window.__RD2_LOADER_OWNER__ = undefined;
      }
      if (typeof document !== "undefined" && document.body) {
        document.body.classList.remove("app-entering", "is-minimap-active");
      }
    }

    destroyApplicationViews(this.views);
    unsubscribeApplicationViewport(this);
    disposeApplicationServices(this);
  }

  // Stop the app and release its listeners and rendering resources.
  destroy() {
    this._lifecycleGeneration += 1;
    this._initializing = null;
    this._cleanupBootstrap();
    this._initialized = false;
  }

  _queryBootstrapElements() {
    return {
      mapViewport: document.querySelector("#viewport, .map-viewport"),
      mapScene: document.querySelector("#scene, .map-scene"),
      tooltipEl: document.querySelector("#tooltip, .tree-node-tooltip"),
      compendiumEl: document.querySelector("#compendium-overlay, #compendium-panel, .compendium-content"),
      minimapEl: document.querySelector("#minimap, .minimap-panel"),
      minimapCanvas: document.querySelector("#minimap-canvas"),
      minimapWindow: document.querySelector("#minimap-window"),
      controlsContainer: document.querySelector(".topbar, .app-shell") || document.body,
      searchWidgetEl: document.querySelector("#search-widget"),
      filterWidgetEl: document.querySelector("#filter-widget"),
      disclaimerWidgetEl: document.querySelector("#disclaimer-widget"),
      localeWidgetEl: document.querySelector("#locale-widget"),
      searchStatus: document.querySelector("#search-status"),
      dataVersionBadge: document.querySelector("#data-version-badge"),
      changelogModal: document.querySelector("#changelog-modal"),
      changelogOpenButton: document.querySelector("#changelog-open-btn"),
      loadingScreen: document.querySelector("#loading-screen"),
      loaderRetryButton: document.querySelector("#loader-retry-btn")
    };
  }

  async _loadBootstrapData(generation) {
    setLoaderProgress(15);
    setLoaderProgress(30);
    const { treeData: rawTreeData, svgText, bossEvents: rawBossEvents, metadata, changelog, locales } = await this.loadGameDataUseCase.execute();
    if (generation !== this._lifecycleGeneration) return null;
    if (!locales || locales.schema_version !== 1
      || JSON.stringify(locales.locales || []) !== JSON.stringify(SUPPORTED_LOCALES)) {
      throw new Error("The four-locale catalog is unavailable or invalid.");
    }
    this.rawTreeData = rawTreeData;
    this.rawBossEvents = rawBossEvents;
    this.localization = new LocalizationService(locales || {}, { storage: this.storage });
    applyLocalizationDocument(this.localization, document);
    this.spineEngine.setStatusLabels?.({
      loading: this._t("common.loading", {}, "Loading"),
      static: this._t("compendium.static", {}, "STATIC"),
      live: "SPINE",
      error: this._t("loader.failed", {}, "Error")
    });
    setLoaderProgress(30, this._t("loader.reading", {}, "Reading node data…"));
    const localizedInitial = this.localization.localizeTreeAndEvents(rawTreeData, rawBossEvents);
    const treeData = localizedInitial.treeData;
    const bossEvents = localizedInitial.bossEvents;
    this.store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: treeData });
    this.store.dispatch({ type: ActionTypes.SET_BOSS_EVENTS, payload: bossEvents });
    if (isTestMode()) {
      window.TREE_DATA = treeData;
      window.DICE_TREE_SVG = svgText;
      window.RD2_DATA_METADATA = metadata || null;
      window.RD2_DATA_VERSION = metadata?.canonical?.game_version || "unknown";
      window.RD2_CHANGELOG = changelog || null;
    }
    const tagDefinitions = treeData.tag_definitions || {};
    setLoaderProgress(45, this._t("loader.parsing", { count: (treeData.nodes || []).length }, "Parsing nodes…"));
    const cleanNodes = (treeData.nodes || []).map((node) => ({
      ...node,
      _nameClean: resolveGameText(node.name_zh || node.name || "", node, { tagDefinitions }),
      _descClean: resolveGameText(node.description_zh || node.desc || "", node, { tagDefinitions }),
      _awakenClean: resolveGameText(node.dice_awaken || "", node, { tagDefinitions }),
      _unlockClean: resolveGameText(node.unlock_condition_zh || "", node, { tagDefinitions })
    }));
    return { svgText, metadata, changelog, treeData, bossEvents, cleanNodes, tagDefinitions };
  }

  _cacheBootstrapPositions(mapSvg, cleanNodes) {
    this.nodePositions.clear();
    if (mapSvg) {
      mapSvg.querySelectorAll("g.node[data-node-id]").forEach((element) => {
        const id = element.dataset?.nodeId || element.getAttribute?.("data-node-id");
        const transform = element.getAttribute?.("transform") || "";
        const match = /translate\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/.exec(transform);
        if (id && match) {
          this.nodePositions.set(String(id), {
            x: Number.parseFloat(match[1]),
            y: Number.parseFloat(match[2])
          });
        }
      });
    }
    cleanNodes.forEach((node) => {
      if (!this.nodePositions.has(String(node.id)) && typeof node.x === "number" && typeof node.y === "number") {
        this.nodePositions.set(String(node.id), { x: node.x, y: node.y });
      }
    });
  }

  _prepareBootstrapMap(data, elements) {
    const { mapScene } = elements;
    const { treeData, svgText, cleanNodes } = data;
    setLoaderProgress(60, this._t("loader.rendering", {}, "Rendering the dice tree…"));
    if (mapScene && svgText) {
      mapScene.innerHTML = svgText;
      mapScene.setAttribute("aria-hidden", "false");
      mapScene.querySelector("svg")?.setAttribute("aria-label", this._t("map.label", {}, "Interactive dice tree"));
    }
    const mapSvg = document.querySelector("#scene svg") || document.querySelector("svg.dice-tree-svg") || mapScene?.querySelector("svg");
    const svgAssetWarmup = warmupSvgImageAssets(mapSvg);
    const fontWarmup = warmupDocumentFonts();
    setLoaderProgress(65, this._t("loader.edges", {}, "Linking node paths…"));
    this._cacheBootstrapPositions(mapSvg, cleanNodes);
    this.store.dispatch({ type: ActionTypes.SET_NODE_POSITIONS, payload: this.nodePositions });
    setLoaderProgress(75, this._t("loader.prerequisites", {}, "Computing prerequisite paths…"));
    setLoaderProgress(82, this._t("loader.search", {}, "Building the search index…"));
    setLoaderProgress(88, this._t("loader.geometry", {}, "Computing node geometry…"));
    return { mapSvg, svgAssetWarmup, fontWarmup, treeData };
  }

  _initializeViewport(elements) {
    const { mapViewport, mapScene } = elements;
    if (!mapViewport || !mapScene) return;
    this._viewportUnsubscribe?.();
    this._viewportUnsubscribe = null;
    this.viewportController.init(mapViewport, mapScene);
    this._viewportUnsubscribe = this.viewportController.subscribe((viewportState) => {
      this.store.dispatch({ type: ActionTypes.UPDATE_VIEWPORT, payload: viewportState });
    });
  }

  _initializeTreeView(elements, mapSvg) {
    this.views.treeView = new TreeView({
      store: this.store,
      selectNodeUseCase: this.selectNodeUseCase,
      navigateViewportUseCase: this.navigateViewportUseCase,
      container: elements.mapViewport,
      svgElement: mapSvg,
      localization: this.localization
    });
    this.views.treeView.setNodePositions(this.nodePositions);
    this.views.treeView.init(mapSvg);
  }

  _initializeTooltipView(elements, tagDefinitions) {
    this.views.tooltipView = new TooltipView({
      store: this.store,
      selectNodeUseCase: this.selectNodeUseCase,
      navigateViewportUseCase: this.navigateViewportUseCase,
      tooltipElement: elements.tooltipEl,
      nodePositions: this.nodePositions,
      tagDefinitions,
      localization: this.localization
    });
    this.views.tooltipView.init();
  }

  _initializeSimulationView(elements) {
    this.views.simulationView = new SimulationView({
      store: this.store,
      simulationUseCase: this.simulationPlanUseCase,
      container: document.body,
      tooltipElement: elements.tooltipEl,
      localization: this.localization
    });
    this.views.simulationView.init();
  }

  _initializeCompendiumView(elements, tagDefinitions) {
    this.views.compendiumView = new CompendiumView({
      store: this.store,
      syncGolemRankUseCase: this.syncGolemRankUseCase,
      spineEngine: this.spineEngine,
      container: elements.compendiumEl,
      tagDefinitions,
      localization: this.localization,
      onLocateNode: (nodeId) => {
        const pos = this.nodePositions.get(String(nodeId));
        this.selectNodeUseCase.execute(nodeId, { point: pos, nodePositions: this.nodePositions });
        if (pos) this.navigateViewportUseCase.locateNode(nodeId, pos, 1.0);
      },
      onShowTagPopover: (tagKey, targetElement) => this.views.tooltipView?.showTagPopover(tagKey, targetElement)
    });
    this.views.compendiumView.init();
  }

  _initializeMinimapView(elements, treeData) {
    setLoaderProgress(98, this._t("loader.minimap", {}, "Preparing the minimap…"));
    this.views.minimapView = new MinimapView({
      store: this.store,
      navigateViewportUseCase: this.navigateViewportUseCase,
      minimapElement: elements.minimapEl,
      canvasElement: elements.minimapCanvas,
      windowElement: elements.minimapWindow
    });
    this.views.minimapView.init();
    this.views.minimapView.prebake(treeData.nodes, this.nodePositions);
  }

  _initializeControlViews(elements) {
    this.views.controlsView = new ControlsView({
      store: this.store,
      filterTreeUseCase: this.filterTreeUseCase,
      navigateViewportUseCase: this.navigateViewportUseCase,
      selectNodeUseCase: this.selectNodeUseCase,
      container: elements.controlsContainer,
      localization: this.localization
    });
    this.views.controlsView.init();
    const changelogWidgetEl = document.getElementById("changelog-widget");
    this.views.morphingWidgets = new MorphingWidgets({
      searchWidgetElement: elements.searchWidgetEl,
      filterWidgetElement: elements.filterWidgetEl,
      disclaimerWidgetElement: elements.disclaimerWidgetEl,
      changelogWidgetElement: changelogWidgetEl,
      localeWidgetElement: elements.localeWidgetEl,
      filterTreeUseCase: this.filterTreeUseCase
    });
    this.views.morphingWidgets.init();
    this.views.localeView = new LocaleView({
      localization: this.localization,
      widgetElement: elements.localeWidgetEl,
      morphingWidgets: this.views.morphingWidgets
    });
    this.views.localeView.init();
    return changelogWidgetEl;
  }

  _handleLocaleChange(generation) {
    if (generation !== this._lifecycleGeneration) return;
    applyLocalizationDocument(this.localization, document);
    const localized = this.localization.localizeTreeAndEvents(this.rawTreeData, this.rawBossEvents);
    this.store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: localized.treeData });
    this.store.dispatch({ type: ActionTypes.SET_BOSS_EVENTS, payload: localized.bossEvents });
    this.views.treeView?.refreshLocalizedLabels(this.localization);
    this.views.tooltipView?.setLocalization(this.localization, localized.treeData.tag_definitions);
    this.views.simulationView?.setLocalization?.(this.localization);
    this.views.controlsView?.setLocalization?.(this.localization);
    this.views.detailedStatsView?.setLocalization?.(this.localization);
    this.views.compendiumView?.setLocalization?.(this.localization, localized.treeData.tag_definitions || {});
    this.views.changelogView?.render?.();
    this.views.localeView?.render?.();
  }

  _subscribeBootstrapLocale(generation) {
    this._localeUnsubscribe?.();
    this._localeUnsubscribe = this.localization.subscribe(() => this._handleLocaleChange(generation));
  }

  _initializeSecondaryViews(elements, data, mapSvg, generation) {
    this._initializeTreeView(elements, mapSvg);
    this._initializeTooltipView(elements, data.tagDefinitions);
    this._initializeSimulationView(elements);
    this._initializeCompendiumView(elements, data.tagDefinitions);
    this._initializeMinimapView(elements, data.treeData);
    const changelogWidgetEl = this._initializeControlViews(elements);
    this._subscribeBootstrapLocale(generation);
    this.views.changelogView = new ChangelogView({
      container: changelogWidgetEl || elements.changelogModal,
      openButton: elements.changelogOpenButton,
      versionBadge: elements.dataVersionBadge,
      morphingWidgets: this.views.morphingWidgets,
      localization: this.localization
    });
    this.views.changelogView.init();
    this.views.changelogView.setData({ metadata: data.metadata, changelog: data.changelog });
    this.views.detailedStatsView = new DetailedStatsView({ store: this.store, container: document.body, localization: this.localization });
    this.views.detailedStatsView.init();
  }

  _bindCompendiumCenterButton(mapSvg) {
    const button = document.querySelector("#tree-center-compendium-btn") || mapSvg?.querySelector("#tree-center-compendium-btn");
    if (!button) return;
    button.style.cursor = "pointer";
    const openCompendium = (triggerElement = null) => {
      if (!this.store.getState().simulation?.active) this.views.compendiumView.open(triggerElement);
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openCompendium(event.currentTarget);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      openCompendium(event.currentTarget);
    });
  }

  _createTooltipCenterHandler(tooltipEl) {
    return (nodeId, immediate = false) => {
      const pos = this.nodePositions.get(String(nodeId));
      if (!pos) return;
      const state = this.store.getState();
      const node = state.nodesMap?.get(String(nodeId));
      const isBelow = shouldPlaceTooltipBelow({
        nodeId,
        pt: pos,
        activePrereqNodeIds: state.showPrereqMode ? state.activePrereqIds : null,
        nodePositions: this.nodePositions
      });
      this.viewportController.centerOnNodeForTooltip({
        pt: pos,
        node,
        isBelow,
        tipHeight: tooltipEl?.offsetHeight || 320,
        immediate
      });
    };
  }

  _installTestHooks(centerOnNodeForTooltip) {
    if (typeof window === "undefined") return;
    const compendiumHooks = {
      open: () => this.views.compendiumView.open(),
      close: () => this.views.compendiumView.close(),
      render: () => this.views.compendiumView.render(),
      showEvent: (eventId, eventMode = "all") => this.views.compendiumView.showEvent(eventId, eventMode)
    };
    const testHooks = {
      centerOnNode: (nodeId, immediate = false) => centerOnNodeForTooltip(nodeId, immediate),
      showTooltip: (nodeId) => {
        const pos = this.nodePositions.get(String(nodeId));
        this.selectNodeUseCase.execute(nodeId, { point: pos, nodePositions: this.nodePositions });
        centerOnNodeForTooltip(nodeId, true);
      },
      closeTooltip: (immediate = false) => {
        this.selectNodeUseCase.deselect();
        this.views.tooltipView.close(immediate);
      },
      getSimulationPlan: () => this.store.getState().simulation,
      enterSimulation: () => this.simulationPlanUseCase.enter(),
      exitSimulation: () => this.simulationPlanUseCase.exit(),
      resetSimulation: () => this.simulationPlanUseCase.reset(),
      importSimulationShare: (value) => this.simulationPlanUseCase.importShare(value),
      openDetailedStats: () => this.views.detailedStatsView.open(),
      closeDetailedStats: () => this.views.detailedStatsView.close(),
      getState: () => {
        const state = this.store.getState();
        return { ...state, scale: state.viewport.scale, panX: state.viewport.x, panY: state.viewport.y, nodePositions: this.nodePositions };
      }
    };
    if (!isTestMode()) return;
    window.__RD2_CENTER_FOR_TOOLTIP__ = centerOnNodeForTooltip;
    window.__COMPENDIUM_HOOKS__ = compendiumHooks;
    window.__TEST_HOOKS__ = testHooks;
    this._globalHooks = { center: centerOnNodeForTooltip, compendium: compendiumHooks, test: testHooks };
  }

  _openSharedEventFromUrl() {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const sharedEventId = query.get("event") || query.get("event_id") || hash.get("event") || hash.get("event_id");
    const sharedEventMode = query.get("event_mode") || hash.get("event_mode") || "all";
    if (sharedEventId) this.views.compendiumView.showEvent(sharedEventId, sharedEventMode);
  }

  async _finishBootstrap(generation, cleanNodes, warmups) {
    this.viewportController.resetToCenter(true);
    void warmups.svgAssetWarmup.catch(() => {});
    void warmups.fontWarmup.catch(() => {});
    await setLoaderProgress(100, this._t("loader.complete", {}, "Ready"));
    if (this._loaderDismissTimer) clearTimeout(this._loaderDismissTimer);
    this._loaderDismissTimer = setTimeout(() => {
      this._loaderDismissTimer = null;
      if (generation === this._lifecycleGeneration) dismissLoader(() => generation === this._lifecycleGeneration, this.viewportController, this);
    }, 280);
    return cleanNodes;
  }

  _handleBootstrapError(error, elements, generation) {
    if (generation !== this._lifecycleGeneration) return;
    console.error("Application bootstrap failed:", error);
    this._cleanupBootstrap();
    setLoaderProgress(100, this._t("loader.failed", {}, "Data loading failed. Reload to try again."));
    const { loadingScreen, loaderRetryButton } = elements;
    if (loadingScreen) {
      loadingScreen.hidden = false;
      loadingScreen.classList.remove("is-loaded", "is-hidden");
      loadingScreen.classList.add("is-error");
      loadingScreen.setAttribute("aria-label", this._t("loader.failed", {}, "Data loading failed"));
    }
    const loaderStatusLabel = document.getElementById("loader-status-label");
    if (loaderStatusLabel) loaderStatusLabel.setAttribute("role", "alert");
    if (loaderRetryButton) {
      loaderRetryButton.hidden = false;
      loaderRetryButton.disabled = false;
      loaderRetryButton.textContent = this._t("loader.retry", {}, "Reload");
      loaderRetryButton.onclick = () => {
        loaderRetryButton.disabled = true;
        loaderRetryButton.textContent = this._t("loader.retrying", {}, "Reloading…");
        window.location.reload();
      };
      loaderRetryButton.focus?.({ preventScroll: true });
    }
  }

  async _bootstrap(generation = this._lifecycleGeneration) {
    const elements = this._queryBootstrapElements();
    try {
      const data = await this._loadBootstrapData(generation);
      if (!data) return false;
      const map = this._prepareBootstrapMap(data, elements);
      this._initializeViewport(elements);
      this._initializeSecondaryViews(elements, data, map.mapSvg, generation);
      this._bindCompendiumCenterButton(map.mapSvg);
      const centerOnNodeForTooltip = this._createTooltipCenterHandler(elements.tooltipEl);
      this._installTestHooks(centerOnNodeForTooltip);
      this._openSharedEventFromUrl();
      if (elements.searchStatus) {
        elements.searchStatus.textContent = this._t("search.count", { count: data.cleanNodes.length }, `${data.cleanNodes.length} nodes`);
      }
      await this._finishBootstrap(generation, data.cleanNodes, map);
      return true;
    } catch (error) {
      this._handleBootstrapError(error, elements, generation);
      return false;
    }
  }

}

// Start in a browser.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.RD2App = new Application();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.RD2App.init());
  } else {
    window.RD2App.init();
  }
}
