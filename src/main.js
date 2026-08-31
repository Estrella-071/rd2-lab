const isTestMode = () => typeof window !== "undefined" && window.__RD2_TEST_MODE__ === true;

if (isTestMode()) {
  window.__RD2_RUNTIME__ = "ready";
}

const FONT_WARMUP_TIMEOUT_MS = 5000;
const LOADER_PROGRESS_STEP_MS = 40;
const LOADER_READY_DELAY_MS = 80;
const LOADER_HIDE_DELAY_MS = 220;

let loaderProgressValue = 0;
let loaderProgressQueue = [];
let loaderProgressTimer = null;
let loaderProgressActive = null;
let loaderProgressLabel = "";

function findLoaderElement(primaryId, fallbackId) {
  if (typeof document === "undefined") return null;
  return document.getElementById(primaryId) || document.getElementById(fallbackId);
}

function updateLoaderProgressFill(next, loaderProgressFill) {
  if (!loaderProgressFill) return;
  loaderProgressFill.style.setProperty("--progress", `${next.percent}%`);
  loaderProgressFill.style.width = `${next.percent}%`;
}

function updateLoaderStatusLabel(next, loaderStatusLabel) {
  if (loaderStatusLabel && !loaderProgressLabel && loaderStatusLabel.textContent.trim()) {
    loaderProgressLabel = loaderStatusLabel.textContent.trim();
  }
  const changed = Boolean(next.labelText && next.labelText !== loaderProgressLabel);
  if (!changed) return false;

  loaderProgressLabel = next.labelText;
  if (!loaderStatusLabel) return true;
  loaderStatusLabel.classList.add("is-transitioning");
  loaderStatusLabel.textContent = next.labelText;
  const reveal = () => loaderStatusLabel.classList.remove("is-transitioning");
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
  } else {
    setTimeout(reveal, 0);
  }
  return true;
}

function completeLoaderProgressItem(item) {
  loaderProgressActive = null;
  item.resolve();
  processLoaderProgressQueue();
}

function processLoaderProgressQueue() {
  if (loaderProgressTimer || loaderProgressQueue.length === 0) return;

  const loaderProgressFill = findLoaderElement("loader-progress-fill", "loading-progress-fill");
  const loaderStatusLabel = findLoaderElement("loader-status-label", "loading-status-label");
  const next = loaderProgressQueue.shift();
  if (!next) return;
  loaderProgressActive = next;
  updateLoaderProgressFill(next, loaderProgressFill);
  const labelChanged = updateLoaderStatusLabel(next, loaderStatusLabel);
  const changed = next.percent !== loaderProgressValue;
  loaderProgressValue = next.percent;
  if (!changed && !labelChanged) {
    completeLoaderProgressItem(next);
    return;
  }

  loaderProgressTimer = setTimeout(() => {
    loaderProgressTimer = null;
    completeLoaderProgressItem(next);
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
  if (loaderStatusLabel && labelText) {
    loaderStatusLabel.classList.remove("is-transitioning");
    loaderStatusLabel.textContent = labelText;
    loaderProgressLabel = labelText;
  }
  loaderProgressValue = 100;
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
  MapTileRepository,
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
  CanvasTreeRenderer,
  LocaleView,
  applyLocalizationDocument,
  updateSeoMetadata
} from "./ui/index.js";

// Shared calculations
import { shouldPlaceTooltipBelow } from "./domain/tooltip_position.js";
import { resolveGameText } from "./domain/game_text.js";
import { LocalizationService, SUPPORTED_LOCALES } from "./domain/localization.js";
import { buildLocaleUrl, isLocaleFreeShareRoute, parseUrlState, URL_ROUTE_KINDS } from "./domain/url_state.js";

export function setLoaderProgress(percent, labelText = "") {
  if (typeof document === "undefined") return Promise.resolve();
  const target = Math.max(0, Math.min(100, Number(percent) || 0));
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

  // The map can become interactive before the loader hide transition ends.
  // Capture the viewport that was visible when the transition was scheduled;
  // a delayed reset must never overwrite a drag or zoom that started in the
  // meantime.
  const scheduledViewport = viewportController?.getState?.() || null;

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
      const currentViewport = targetViewport.getState?.() || null;
      const unchanged = scheduledViewport && currentViewport
        && Math.abs(Number(currentViewport.x) - Number(scheduledViewport.x)) < 0.01
        && Math.abs(Number(currentViewport.y) - Number(scheduledViewport.y)) < 0.01
        && Math.abs(Number(currentViewport.scale) - Number(scheduledViewport.scale)) < 0.0001;
      if (unchanged) targetViewport.resetToCenter(true);
    }
  }, LOADER_HIDE_DELAY_MS);

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
  application.nodePositions.clear();
  application._localeUnsubscribe?.();
  application._localeUnsubscribe = null;
  application._urlUnsubscribe?.();
  application._urlUnsubscribe = null;
}

export class Application {
  constructor() {
    // Services used by the page.
    this.storage = new LocalStorageAdapter("rd2_");
    this.dataRepo = new HttpDataRepository({
      diceTreeUrl: "data/dice_tree.json",
      renderManifestUrl: "map-render-manifest.json",
      bossEventsUrl: "boss_event_data.json",
      monsterPostersUrl: "monster_posters.json",
      gameMetadataUrl: "data/game_data_metadata.json",
      changelogUrl: "data/changelog.json",
      localesUrl: "data/locales.json"
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
      shareImageExporter: {
        generate: (options = {}) => generateSimulationShareImage({
          ...options,
          prepareRender: (params) => this.mapRenderer?.prepareShare?.(params),
          renderTree: (params) => this.mapRenderer?.renderToCanvas?.({
            ...params,
            state: {
              ...this.store.getState(),
              simulation: options.simulation || this.store.getState().simulation,
              renderUnlockState: params.renderUnlockState || null
            }
          }) || false
        })
      },
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
      detailedStatsView: null,
      localeView: null
    };

    // Node positions used for centering.
    this.nodePositions = new Map();
    this._initialized = false;
    this._initializing = null;
    this._viewportUnsubscribe = null;
    this._localeUnsubscribe = null;
    this._urlUnsubscribe = null;
    this._globalHooks = null;
    this._lifecycleGeneration = 0;
    this._loaderDismissTimer = null;
    this.mapRenderer = null;
    this.initialUrlState = parseUrlState(typeof window !== "undefined" ? window.location.href : "/");
    this._lastUrlKey = "";
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
    this.mapRenderer?.destroy?.();
    this.mapRenderer = null;
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
    const {
      treeData: rawTreeData,
      renderManifest,
      bossEvents: rawBossEvents,
      metadata,
      changelog,
      locales
    } = await this.loadGameDataUseCase.execute({ loadLegacySvg: false });
    if (generation !== this._lifecycleGeneration) return null;
    if (!renderManifest) throw new Error("The Canvas map render manifest is unavailable.");
    if (!locales || locales.schema_version !== 1
      || JSON.stringify(locales.locales || []) !== JSON.stringify(SUPPORTED_LOCALES)) {
      throw new Error("The four-locale catalog is unavailable or invalid.");
    }
    this.rawTreeData = rawTreeData;
    this.rawBossEvents = rawBossEvents;
    this.initialUrlState = parseUrlState(typeof window !== "undefined" ? window.location.href : "/");
    this.localization = new LocalizationService(locales || {}, {
      storage: this.storage,
      locale: this.initialUrlState.locale || undefined
    });
    applyLocalizationDocument(this.localization, document);
    setLoaderProgress(30, this._t("loader.reading", {}, "Reading node data…"));
    const localizedInitial = this.localization.localizeTreeAndEvents(rawTreeData, rawBossEvents);
    const treeData = localizedInitial.treeData;
    const bossEvents = localizedInitial.bossEvents;
    this.store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: treeData });
    this.store.dispatch({ type: ActionTypes.SET_BOSS_EVENTS, payload: bossEvents });
    if (isTestMode()) {
      window.TREE_DATA = treeData;
      window.RD2_RENDER_MANIFEST = renderManifest;
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
    return { renderManifest, metadata, changelog, treeData, bossEvents, cleanNodes, tagDefinitions };
  }

  _cacheBootstrapPositions(renderManifest, cleanNodes) {
    this.nodePositions.clear();
    for (const node of renderManifest?.nodes || []) {
      if (Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))) {
        this.nodePositions.set(String(node.id), { x: Number(node.x), y: Number(node.y) });
      }
    }
    cleanNodes.forEach((node) => {
      if (!this.nodePositions.has(String(node.id)) && typeof node.x === "number" && typeof node.y === "number") {
        this.nodePositions.set(String(node.id), { x: node.x, y: node.y });
      }
    });
  }

  _prepareBootstrapMap(data, elements) {
    const { mapScene } = elements;
    const { treeData, renderManifest, cleanNodes } = data;
    setLoaderProgress(60, this._t("loader.rendering", {}, "Rendering the dice tree…"));
    if (!mapScene) throw new Error("Canvas map container is unavailable.");
    mapScene.innerHTML = "";
    mapScene.setAttribute("aria-hidden", "false");
    this._cacheBootstrapPositions(renderManifest, cleanNodes);
    this.store.dispatch({ type: ActionTypes.SET_NODE_POSITIONS, payload: this.nodePositions });
    this.mapRenderer = new CanvasTreeRenderer({
      store: this.store,
      tileRepository: new MapTileRepository({ manifest: renderManifest }),
      onReady: () => { mapScene.dataset.canvasReady = "true"; },
      onError: (error) => this._handleBootstrapError(error, elements, this._lifecycleGeneration)
    });
    const rendererReady = this.mapRenderer.init({
      container: mapScene,
      treeData,
      renderManifest,
      localization: this.localization
    });
    const fontWarmup = warmupDocumentFonts();
    setLoaderProgress(65, this._t("loader.edges", {}, "Linking node paths…"));
    setLoaderProgress(75, this._t("loader.prerequisites", {}, "Computing prerequisite paths…"));
    setLoaderProgress(82, this._t("loader.search", {}, "Building the search index…"));
    setLoaderProgress(88, this._t("loader.geometry", {}, "Computing node geometry…"));
    return { renderer: this.mapRenderer, rendererReady, fontWarmup, treeData };
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

  _initializeTreeView(elements, renderer) {
    this.views.treeView = new TreeView({
      store: this.store,
      selectNodeUseCase: this.selectNodeUseCase,
      navigateViewportUseCase: this.navigateViewportUseCase,
      container: elements.mapViewport,
      mapScene: elements.mapScene,
      renderer,
      localization: this.localization
    });
    this.views.treeView.setNodePositions(this.nodePositions);
    this.views.treeView.init();
  }

  _initializeTooltipView(elements, tagDefinitions, renderer) {
    this.views.tooltipView = new TooltipView({
      store: this.store,
      selectNodeUseCase: this.selectNodeUseCase,
      navigateViewportUseCase: this.navigateViewportUseCase,
      tooltipElement: elements.tooltipEl,
      nodePositions: this.nodePositions,
      renderer,
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
      localization: this.localization,
      onShareUrl: (url) => {
        const route = parseUrlState(url);
        if (route.kind === URL_ROUTE_KINDS.SIMULATION) this._navigateUrl(route);
      }
    });
    this.views.simulationView.init();
  }

  _initializeCompendiumView(elements, tagDefinitions) {
    this.views.compendiumView = new CompendiumView({
      store: this.store,
      syncGolemRankUseCase: this.syncGolemRankUseCase,
      container: elements.compendiumEl,
      tagDefinitions,
      localization: this.localization,
      onLocateNode: (nodeId) => {
        const pos = this.nodePositions.get(String(nodeId));
        this.selectNodeUseCase.execute(nodeId, { point: pos, nodePositions: this.nodePositions });
        if (pos) this.navigateViewportUseCase.locateNode(nodeId, pos, 1.0);
      },
      onShowTagPopover: (tagKey, targetElement) => this.views.tooltipView?.showTagPopover(tagKey, targetElement),
      onShowBonusPopover: (targetElement) => this.views.tooltipView?.showBonusPopover(targetElement),
      onHideBonusPopover: () => this.views.tooltipView?.hideBonusPopover(),
      onNavigate: (route) => this._navigateUrl(route)
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
      localization: this.localization,
      renderer: this.mapRenderer
    });
    this.views.controlsView.init();
    const changelogWidgetEl = document.getElementById("changelog-widget");
    this.views.morphingWidgets = new MorphingWidgets({
      searchWidgetElement: elements.searchWidgetEl,
      filterWidgetElement: elements.filterWidgetEl,
      disclaimerWidgetElement: elements.disclaimerWidgetEl,
      changelogWidgetElement: changelogWidgetEl,
      localeWidgetElement: elements.localeWidgetEl,
      filterTreeUseCase: this.filterTreeUseCase,
      navigateViewportUseCase: this.navigateViewportUseCase
    });
    this.views.morphingWidgets.init();
    this.views.localeView = new LocaleView({
      localization: this.localization,
      widgetElement: elements.localeWidgetEl,
      morphingWidgets: this.views.morphingWidgets,
      onLocaleChange: (locale) => this._replaceLocaleUrl(locale)
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

  _initializeSecondaryViews(elements, data, renderer, generation) {
    this._initializeTreeView(elements, renderer);
    this._initializeTooltipView(elements, data.tagDefinitions, renderer);
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

  _resolveUrlEntity(urlState, state = this.store.getState()) {
    if (urlState?.kind === URL_ROUTE_KINDS.TREE_NODE
      || (urlState?.kind === URL_ROUTE_KINDS.COMPENDIUM_CARD && urlState.category === "dice")) {
      return state.nodesMap?.get(String(urlState.id)) || null;
    }
    if (urlState?.kind !== URL_ROUTE_KINDS.COMPENDIUM_CARD) return null;
    const collection = urlState.category === "monster"
      ? state.bossEvents?.monsters
      : [...(state.bossEvents?.events || []), ...(state.bossEvents?.historical_events || [])];
    return (Array.isArray(collection) ? collection : [])
      .find((entry) => String(entry?.id ?? entry?.index ?? "") === String(urlState.id)) || null;
  }

  _refreshSeo(urlState = null) {
    if (!this.localization || typeof window === "undefined") return null;
    const nextState = urlState || parseUrlState(window.location.href);
    return updateSeoMetadata({
      localization: this.localization,
      urlState: nextState,
      entity: this._resolveUrlEntity(nextState),
      origin: window.location.origin
    });
  }

  _routeUrlState(route = {}) {
    return {
      kind: route.kind || URL_ROUTE_KINDS.HOME,
      category: route.category || "",
      id: route.id || "",
      share: route.share || "",
      shareKind: route.shareKind || "code",
      eventMode: route.eventMode || "all"
    };
  }

  _navigateUrl(route = {}) {
    if (typeof window === "undefined" || !window.history?.replaceState) return null;
    const nextRoute = this._routeUrlState(route);
    const locale = this.localization?.getLocale?.() || parseUrlState(window.location.href).locale || "zh-tw";
    const nextPath = buildLocaleUrl({
      locale,
      includeLocale: !isLocaleFreeShareRoute(nextRoute),
      ...nextRoute
    });
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextPath) window.history.replaceState({}, "", nextPath);
    const nextState = parseUrlState(window.location.href);
    this.initialUrlState = nextState;
    this._lastUrlKey = `${nextState.kind}:${nextState.category || ""}:${nextState.id || ""}:${nextState.share || ""}:${nextState.eventMode || "all"}`;
    this._refreshSeo(nextState);
    return nextState;
  }

  _replaceLocaleUrl(locale) {
    if (typeof window === "undefined") return null;
    const current = parseUrlState(window.location.href);
    return this._navigateUrl({
      ...current,
      locale,
      kind: current.kind,
      eventMode: current.eventMode
    });
  }

  _subscribeUrlState() {
    this._urlUnsubscribe?.();
    this._urlUnsubscribe = this.store.subscribe((state, action) => {
      if (typeof window === "undefined") return;
      if (action?.type === ActionTypes.UPDATE_VIEWPORT || action?.type === "SET_VIEWPORT") return;
      const current = parseUrlState(window.location.href);
      if (state.simulation?.active) {
        if (current.kind !== URL_ROUTE_KINDS.SIMULATION) this._navigateUrl({ kind: URL_ROUTE_KINDS.SIMULATION });
        else this._refreshSeo(current);
        return;
      }
      if (action?.type === ActionTypes.SELECT_NODE && state.selectedNodeId) {
        this._navigateUrl({ kind: URL_ROUTE_KINDS.TREE_NODE, id: state.selectedNodeId });
        return;
      }
      if (action?.type === ActionTypes.DESELECT_NODE && current.kind === URL_ROUTE_KINDS.TREE_NODE) {
        this._navigateUrl({ kind: URL_ROUTE_KINDS.HOME });
      }
    });
  }

  _openInitialRoute(route, centerOnNodeForTooltip) {
    if (route.kind === URL_ROUTE_KINDS.TREE_NODE) {
      const node = this._resolveUrlEntity(route);
      if (node) {
        const point = this.nodePositions.get(String(route.id));
        this.selectNodeUseCase.execute(route.id, { point, nodePositions: this.nodePositions });
        centerOnNodeForTooltip(route.id, true);
      }
      return;
    }
    if (route.kind === URL_ROUTE_KINDS.COMPENDIUM) {
      this.views.compendiumView.openCategory(route.category, route.eventMode || "all");
      return;
    }
    if (route.kind === URL_ROUTE_KINDS.COMPENDIUM_CARD) {
      const opened = this.views.compendiumView.showCard(route.category, route.id, route.eventMode || "all");
      if (!opened) this._navigateUrl({ kind: URL_ROUTE_KINDS.HOME });
      return;
    }
    if (route.kind === URL_ROUTE_KINDS.SIMULATION && !this.store.getState().simulation?.active) {
      this.simulationPlanUseCase.enter();
    }
  }

  _normalizeInitialUrl() {
    const current = parseUrlState(typeof window !== "undefined" ? window.location.href : "/");
    if (current.kind === URL_ROUTE_KINDS.HOME && !current.hasLocalePath) {
      this._navigateUrl({ kind: URL_ROUTE_KINDS.HOME });
    } else if (current.kind === URL_ROUTE_KINDS.SIMULATION && !current.hasLocalePath && !current.share) {
      this._navigateUrl({ kind: URL_ROUTE_KINDS.SIMULATION });
    } else if ((current.kind === URL_ROUTE_KINDS.COMPENDIUM || current.kind === URL_ROUTE_KINDS.COMPENDIUM_CARD)
      && current.locale !== this.localization?.getLocale?.()) {
      this._navigateUrl({ ...current });
    }
  }

  _openInitialUrlState(centerOnNodeForTooltip) {
    const route = this.initialUrlState || parseUrlState(typeof window !== "undefined" ? window.location.href : "/");
    this._openInitialRoute(route, centerOnNodeForTooltip);
    this._normalizeInitialUrl();
    this._refreshSeo(parseUrlState(typeof window !== "undefined" ? window.location.href : "/"));
  }

  _bindCompendiumCenterButton() {
    const button = document.querySelector("#tree-center-compendium-btn");
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

  async _finishBootstrap(generation, cleanNodes, warmups) {
    this.viewportController.resetToCenter(true);
    await warmups.rendererReady;
    // Font loading is allowed to finish in the background. Canvas labels are
    // redrawn by the renderer when the requested web font becomes available;
    // the network response must not hold the first interactive map hostage.
    void warmups.fontWarmup.catch(() => {});
    await setLoaderProgress(100, this._t("loader.complete", {}, "Ready"));
    if (this._loaderDismissTimer) clearTimeout(this._loaderDismissTimer);
    this._loaderDismissTimer = setTimeout(() => {
      this._loaderDismissTimer = null;
      if (generation === this._lifecycleGeneration) dismissLoader(() => generation === this._lifecycleGeneration, this.viewportController, this);
    }, LOADER_READY_DELAY_MS);
    return cleanNodes;
  }

  _handleBootstrapError(error, elements, generation) {
    if (generation !== this._lifecycleGeneration) return;
    console.error("Application bootstrap failed:", error);
    this._cleanupBootstrap();
    const isCanvasFailure = /canvas|raster|render manifest|map render/i.test(String(error?.message || ""));
    const failureMessage = isCanvasFailure
      ? this._t("loader.canvasSupport", {}, "The map requires Canvas support. Check the browser and try again.")
      : this._t("loader.failed", {}, "Data loading failed. Reload to try again.");
    finishLoaderProgress(failureMessage);
    const { loadingScreen, loaderRetryButton } = elements;
    if (loadingScreen) {
      loadingScreen.hidden = false;
      loadingScreen.classList.remove("is-loaded", "is-hidden");
      loadingScreen.classList.add("is-error");
      loadingScreen.setAttribute("aria-label", failureMessage);
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
      this._initializeViewport(elements);
      // Establish the final viewport scale before the Canvas renderer starts
      // its first asset decode.  On mobile the controller uses a 0.5 base
      // scale; letting the renderer observe the store's desktop default of 1
      // first can commit a low-density frame and leave the transformed scene
      // soft even after the correct bucket is ready.
      const initialViewport = this.viewportController.getState?.();
      if (initialViewport) {
        this.store.dispatch({ type: ActionTypes.UPDATE_VIEWPORT, payload: initialViewport });
      }
      const map = this._prepareBootstrapMap(data, elements);
      this._initializeSecondaryViews(elements, data, map.renderer, generation);
      this._subscribeUrlState();
      this._bindCompendiumCenterButton();
      const centerOnNodeForTooltip = this._createTooltipCenterHandler(elements.tooltipEl);
      this._installTestHooks(centerOnNodeForTooltip);
      this._openInitialUrlState(centerOnNodeForTooltip);
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
