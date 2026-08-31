import { ActionTypes } from "../app/store/app_store.js";

// Handles search, filters, and keyboard controls.
export class ControlsView {
  /**
   * @param {object} dependencies
   * @param {import("../app/store/app_store.js").AppStore} dependencies.store
   * @param {import("../app/usecases/filter_tree.js").FilterTreeUseCase} dependencies.filterTreeUseCase
   * @param {import("../app/usecases/navigate_viewport.js").NavigateViewportUseCase} [dependencies.navigateViewportUseCase]
   * @param {import("../app/usecases/select_node.js").SelectNodeUseCase} [dependencies.selectNodeUseCase]
   * @param {HTMLElement} [dependencies.container]
   * @param {object} [dependencies.renderer] Canvas tree renderer to refresh
   */
  constructor({ store, filterTreeUseCase, navigateViewportUseCase, selectNodeUseCase, container, localization, renderer = null }) {
    this.store = store;
    this.filterTreeUseCase = filterTreeUseCase;
    this.navigateViewportUseCase = navigateViewportUseCase;
    this.selectNodeUseCase = selectNodeUseCase;
    this.container = container;
    this.localization = localization || null;
    this.renderer = renderer;

    this._unsubscribe = null;
    this._keydownHandler = null;
    this._listeners = [];
    this._initialized = false;
    this._factionButtons = [];
    this._typeButtons = [];
    this._lastZoomReadoutValue = null;
    this._deferredZoomReadoutValue = null;
  }

  setLocalization(localization) {
    this.localization = localization || null;
    const state = this.store?.getState?.();
    if (state?.filters && state?.viewport) this.render(state);
  }

  /**
   * Initialize controls event listeners.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    if (this.container) {
      this._addListener(this.container, "input", (e) => this._handleInput(e));
      this._addListener(this.container, "click", (e) => this._handleClick(e));
    }
    const controlsRoot = this.container || document;
    this._factionButtons = Array.from(
      controlsRoot.querySelectorAll?.(
        ".faction-filter-btn, .branch-chip, [data-faction-id], [data-branch]",
      ) || [],
    ).filter(
      (button) =>
        !button.closest(".compendium-overlay") &&
        !button.closest("#compendium-tabs"),
    );
    this._typeButtons = Array.from(
      controlsRoot.querySelectorAll?.(
        ".type-filter-btn, .type-chip, [data-node-type], [data-type]",
      ) || [],
    ).filter((button) => !button.closest(".compendium-overlay"));
    this._bindHudButtons();
    this._setupGlobalShortcuts();
    this._addListener(document, "rd2:viewport-settled", (event) => {
      // Viewport updates intentionally defer the readout while a gesture or
      // camera animation is active. Flush the final value after the motion
      // classes are removed so the control cannot remain on the last moving
      // frame.
      const state = this.store?.getState?.();
      const viewport = event?.detail?.scale !== undefined ? event.detail : state?.viewport;
      if (viewport) this._renderZoomReadout(viewport);
    });
    this._unsubscribe = this.store.subscribe((state, action) => this.render(state, action));
    const initialState = this.store.getState?.();
    if (initialState?.filters && initialState?.viewport) this.render(initialState);
  }

  _addListener(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, listener, options);
    this._listeners.push({ target, type, listener, options });
  }

  _removeListeners() {
    for (const { target, type, listener, options } of this._listeners) {
      target.removeEventListener?.(type, listener, options);
    }
    this._listeners = [];
  }

  _bindHudButtons() {
    const togglePrereqBtn = document.getElementById("toggle-prereq-btn");
    if (togglePrereqBtn) {
      this._addListener(togglePrereqBtn, "click", (e) => {
        e.stopPropagation();
        const state = this.store.getState();
        const next = !state.showPrereqMode;
        this.store.dispatch({ type: ActionTypes.SET_SHOW_PREREQ_MODE, payload: next });
        togglePrereqBtn.classList.toggle("is-active", next);
        togglePrereqBtn.setAttribute("aria-pressed", String(next));

        const updatedState = this.store.getState();
        if (next && updatedState.selectedNodeId && updatedState.activePrereqIds && updatedState.activePrereqIds.size > 0) {
          this.navigateViewportUseCase?.centerOnPrereqPath(updatedState.activePrereqIds, false);
        }
      });
    }

    const toggleNodeNamesBtn = document.getElementById("toggle-node-names-btn");
    const toggleCurrencyBtn = document.getElementById("toggle-currency-btn");

    const setNodeNamesActive = (active) => {
      document.body.classList.toggle("show-node-names", active);
      if (toggleNodeNamesBtn) {
        toggleNodeNamesBtn.classList.toggle("is-active", active);
        toggleNodeNamesBtn.setAttribute("aria-pressed", String(active));
        const box = toggleNodeNamesBtn.querySelector(".hud-checkbox-box");
        if (box) box.classList.toggle("is-checked", active);
      }
    };

    const setCurrencyActive = (active) => {
      document.body.classList.toggle("show-currency-badges", active);
      if (toggleCurrencyBtn) {
        toggleCurrencyBtn.classList.toggle("is-active", active);
        toggleCurrencyBtn.setAttribute("aria-pressed", String(active));
        const box = toggleCurrencyBtn.querySelector(".hud-checkbox-box");
        if (box) box.classList.toggle("is-checked", active);
      }
    };

    const refreshTreeState = () => {
      this.renderer?.render?.(this.store?.getState?.() || {}, { type: "DISPLAY_FLAGS_CHANGED" });
    };

    if (toggleNodeNamesBtn) {
      this._addListener(toggleNodeNamesBtn, "click", (e) => {
        e.stopPropagation();
        const currentlyActive = document.body.classList.contains("show-node-names");
        const nextActive = !currentlyActive;

        if (nextActive) {
          // 開啟名稱時，立即關閉貨幣
          setCurrencyActive(false);
          setNodeNamesActive(true);
        } else {
          // 關閉名稱
          setNodeNamesActive(false);
        }
        refreshTreeState();
      });
    }

    if (toggleCurrencyBtn) {
      this._addListener(toggleCurrencyBtn, "click", (e) => {
        e.stopPropagation();
        const currentlyActive = document.body.classList.contains("show-currency-badges");
        const nextActive = !currentlyActive;

        if (nextActive) {
          // 開啟貨幣時，立即關閉名稱
          setNodeNamesActive(false);
          setCurrencyActive(true);
        } else {
          // 關閉貨幣
          setCurrencyActive(false);
        }
        refreshTreeState();
      });
    }

    // Zoom readout click to reset
    const zoomReadout = document.getElementById("zoom-readout");
    if (zoomReadout && this.navigateViewportUseCase) {
      this._addListener(zoomReadout, "click", (e) => {
        e.stopPropagation();
        this.navigateViewportUseCase.reset();
      });
    }
  }

  _moveSearchHighlight(event, items) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
    event.preventDefault();
    const currentIndex = items.findIndex((item) => item.classList.contains("is-highlighted"));
    const nextIndex = this._getSearchHighlightIndex(event.key, currentIndex, items.length);
    items.forEach((item, index) => item.classList.toggle("is-highlighted", index === nextIndex));
    items[nextIndex]?.scrollIntoView({ block: "nearest" });
    return true;
  }

  _getSearchHighlightIndex(key, currentIndex, itemCount) {
    if (key === "ArrowDown") {
      return currentIndex < itemCount - 1 ? currentIndex + 1 : 0;
    }
    return currentIndex > 0 ? currentIndex - 1 : itemCount - 1;
  }

  _selectSearchNode(nodeId) {
    if (!nodeId || !this.selectNodeUseCase) return;
    const node = this.store.getState().nodesMap.get(String(nodeId));
    const point = node ? { x: node.x, y: node.y } : null;
    this.selectNodeUseCase.execute(nodeId, { point });
    this.navigateViewportUseCase?.centerOnNodeForTooltip(nodeId, false);
  }

  _activateSearchResult(event, items, searchInput, resultsContainer) {
    if (event.key !== "Enter") return false;
    event.preventDefault();
    const highlighted = items.find((item) => item.classList.contains("is-highlighted")) || items[0];
    if (!highlighted) return true;
    const nodeId = highlighted.dataset.searchNodeId || highlighted.dataset.nodeId;
    this._selectSearchNode(nodeId);
    resultsContainer.setAttribute("aria-hidden", "true");
    if ("inert" in resultsContainer) resultsContainer.inert = true;
    document.getElementById("search-widget")?.classList.remove("has-search-results");
    searchInput?.blur();
    return true;
  }

  _handleSearchNavigation(event, searchInput, resultsContainer) {
    if (document.activeElement !== searchInput || !resultsContainer || resultsContainer.getAttribute("aria-hidden") === "true") return false;
    const items = Array.from(resultsContainer.querySelectorAll(".search-result, .search-result-item, [data-search-node-id]"));
    if (items.length === 0) return false;
    return this._moveSearchHighlight(event, items)
      || this._activateSearchResult(event, items, searchInput, resultsContainer);
  }

  _zoomFromShortcut(multiplier) {
    if (!this.navigateViewportUseCase) return;
    const scale = this.store.getState().viewport.scale || 1.0;
    this.navigateViewportUseCase.zoom(scale * multiplier);
  }

  _handleShortcut(event, searchInput) {
    if (document.activeElement?.tagName === "INPUT") return false;
    switch (event.key) {
      case "/":
        event.preventDefault();
        if (typeof document !== "undefined") {
          document.dispatchEvent(new CustomEvent("rd2:open-search"));
        }
        searchInput?.focus();
        return true;
      case "+":
      case "=":
        event.preventDefault();
        this._zoomFromShortcut(1.25);
        return true;
      case "-":
      case "_":
        event.preventDefault();
        this._zoomFromShortcut(1 / 1.25);
        return true;
      case "0":
        event.preventDefault();
        this.navigateViewportUseCase?.reset();
        return true;
      default:
        return false;
    }
  }

  _handleEscape(event, searchInput, resultsContainer) {
    if (event.key !== "Escape") return;
    this.selectNodeUseCase?.deselect();
    if (resultsContainer) {
      resultsContainer.setAttribute("aria-hidden", "true");
      if ("inert" in resultsContainer) resultsContainer.inert = true;
    }
    document.getElementById("search-widget")?.classList.remove("has-search-results");
    if (searchInput && document.activeElement === searchInput) searchInput.blur();
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("rd2:close-search"));
    }
  }

  _setupGlobalShortcuts() {
    if (typeof window === "undefined") return;
    this._keydownHandler = (event) => {
      const searchInput = document.getElementById("search-input") || document.querySelector("[type='search']");
      const resultsContainer = document.getElementById("search-results");
      if (this._handleSearchNavigation(event, searchInput, resultsContainer)) return;
      if (this._handleShortcut(event, searchInput)) return;
      this._handleEscape(event, searchInput, resultsContainer);
    };

    this._addListener(window, "keydown", this._keydownHandler);
  }

  _handleInput(e) {
    // Search input: filter tree without forcing camera jumps (matches shared search behavior)
    if (e.target.matches("#search-input, [type='search']")) {
      this.filterTreeUseCase.setSearch(e.target.value);
    }
  }

  _navigateAfterFilterUpdate() {
    const state = this.store.getState();
    if (!this.navigateViewportUseCase) return;
    if (
      state.filters.search ||
      state.filters.factions.size > 0 ||
      state.filters.nodeTypes.size > 0
    ) {
      this.navigateViewportUseCase.fitCameraToNodes(
        state.matchingNodeIds,
        false,
      );
    } else {
      this.navigateViewportUseCase.reset();
    }
  }

  _handleSearchClear(event) {
    if (!event.target.closest("#search-clear, .search-clear")) return false;
    this._clearSearchInput();
    this.filterTreeUseCase.setSearch("");
    this._navigateAfterFilterUpdate();
    return true;
  }

  _clearSearchInput() {
    const searchInput = document.querySelector("#search-input, [type='search']");
    if (!searchInput) return;
    searchInput.value = "";
    searchInput.focus();
  }

  _handleFilterClear(event) {
    if (!event.target.closest("#filter-clear-btn, .filter-clear-btn")) return false;
    this.filterTreeUseCase.clear();
    this.navigateViewportUseCase?.reset();
    return true;
  }

  _handleFactionClick(event) {
    const button = event.target.closest(".faction-filter-btn, .branch-chip, [data-faction-id], [data-branch]");
    if (!button || button.closest(".compendium-overlay") || button.closest("#compendium-tabs") || button.closest(".tree-semantic-layer, .tree-node-semantic")) return false;
    const branchId = Number(button.dataset.factionId || button.dataset.branch);
    if (branchId) {
      this.filterTreeUseCase.toggleFaction(branchId);
      this._navigateAfterFilterUpdate();
    }
    return true;
  }

  _handleNodeTypeClick(event) {
    const button = event.target.closest(".type-filter-btn, .type-chip, [data-node-type], [data-type]");
    if (!button || button.closest(".compendium-overlay") || button.closest(".tree-semantic-layer, .tree-node-semantic")) return false;
    const nodeType = button.dataset.nodeType || button.dataset.type;
    if (nodeType) {
      this.filterTreeUseCase.toggleNodeType(nodeType);
      this._navigateAfterFilterUpdate();
    }
    return true;
  }

  _handleSearchResultClick(event) {
    const resultItem = event.target.closest(".search-result, [data-search-node-id]");
    if (!resultItem) return false;
    this._selectSearchNode(resultItem.dataset.searchNodeId || resultItem.dataset.nodeId);
    const resultsContainer = document.getElementById("search-results");
    if (resultsContainer) {
      resultsContainer.setAttribute("aria-hidden", "true");
      if ("inert" in resultsContainer) resultsContainer.inert = true;
    }
    document.getElementById("search-widget")?.classList.remove("has-search-results");
    return true;
  }

  _handleLevelClick(event) {
    const powerupButton = event.target.closest("[data-powerup-level]");
    if (powerupButton) {
      this.store.dispatch({ type: ActionTypes.SET_POWERUP_LEVEL, payload: Number(powerupButton.dataset.powerupLevel) });
    }
    const dotButton = event.target.closest("[data-dot-level]");
    if (dotButton) {
      this.store.dispatch({ type: ActionTypes.SET_DOT_LEVEL, payload: Number(dotButton.dataset.dotLevel) });
    }
  }

  _handleClick(event) {
    if (this._handleSearchClear(event) || this._handleFilterClear(event)) return;
    if (this._handleFactionClick(event) || this._handleNodeTypeClick(event)) return;
    if (this._handleSearchResultClick(event)) return;
    this._handleLevelClick(event);
  }

  /**
   * Render state updates to control elements.
   * @param {object} state
   */
  render(state, action = null) {
    const { filters, viewport, showPrereqMode } = state;

    if (action?.type === ActionTypes.UPDATE_VIEWPORT || action?.type === "SET_VIEWPORT") {
      this._renderZoomReadout(viewport);
      return;
    }

    // 1. Update clear button visibility
    const clearBtn = document.querySelector("#search-clear, .search-clear");
    if (clearBtn) {
      clearBtn.hidden = !filters.search;
    }

    const activeFilterCount = (filters.factions?.size || 0) + (filters.nodeTypes?.size || 0);
    const hasAnyFilter = activeFilterCount > 0;
    const filterWidget = document.getElementById("filter-widget");
    if (filterWidget) {
      filterWidget.classList.toggle("has-active-filters", hasAnyFilter);
    }
    const filterActiveCountBadge = document.getElementById("filter-active-count-badge");
    if (filterActiveCountBadge) {
      if (activeFilterCount > 0) {
        filterActiveCountBadge.textContent = String(activeFilterCount);
        filterActiveCountBadge.hidden = false;
      } else {
        filterActiveCountBadge.hidden = true;
      }
    }

    const filterClearBtn = document.getElementById("filter-clear-btn");
    if (filterClearBtn) {
      filterClearBtn.hidden = !hasAnyFilter;
    }

    // 2. Update the search result list. The list is positioned over the map,
    // so its vertical expansion never changes the topbar's flow geometry.
    this._renderSearchResults(state);

    // 3. Update faction button active states
    this._factionButtons.forEach((btn) => {
      const id = Number(btn.dataset.factionId || btn.dataset.branch);
      const isActive = filters.factions.has(id);
      btn.classList.toggle("is-selected", isActive);
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });

    // 4. Update type button active states
    this._typeButtons.forEach((btn) => {
      const type = btn.dataset.nodeType || btn.dataset.type;
      const isActive = filters.nodeTypes.has(type);
      btn.classList.toggle("is-selected", isActive);
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });

    // 5. Update Zoom readout
    this._renderZoomReadout(viewport);

    // 6. Update Prereq button state
    const togglePrereqBtn = document.getElementById("toggle-prereq-btn");
    if (togglePrereqBtn) {
      togglePrereqBtn.classList.toggle("is-active", Boolean(showPrereqMode));
      togglePrereqBtn.setAttribute("aria-pressed", String(Boolean(showPrereqMode)));
    }
  }

  _renderZoomReadout(viewport) {
    const zoomReadout = document.getElementById("zoom-readout");
    if (!zoomReadout || !viewport) return;

    const nextValue = `${Math.round(viewport.scale * 100)}%`;
    const isNavigating = document.body?.classList?.contains("is-navigating")
      || document.body?.classList?.contains("is-zooming");
    if (isNavigating) {
      // The readout is deliberately deferred while the camera is moving.
      // Mutating text during a pinch invalidates the minimap/header layout and
      // creates a visible cadence of long frames on mobile browsers.
      this._deferredZoomReadoutValue = nextValue;
      return;
    }

    const value = nextValue;
    this._deferredZoomReadoutValue = null;
    if (value === this._lastZoomReadoutValue && zoomReadout.textContent === value) return;
    if (zoomReadout.textContent !== value) zoomReadout.textContent = value;
    this._lastZoomReadoutValue = value;
  }

  _renderSearchResults(state) {
    const resultsContainer = document.getElementById("search-results");
    const statusEl = document.getElementById("search-status");
    if (!resultsContainer) return;

    const { filters, matchingNodeIds, nodesMap } = state;
    const searchWidget = document.getElementById("search-widget");
    if (!filters.search) {
      resultsContainer.hidden = false;
      resultsContainer.setAttribute("aria-hidden", "true");
      if ("inert" in resultsContainer) resultsContainer.inert = true;
      searchWidget?.classList.remove("has-search-results");
      resultsContainer.replaceChildren();
      if (statusEl) statusEl.textContent = "";
      return;
    }

    resultsContainer.replaceChildren();

    const matchedNodes = [];
    matchingNodeIds.forEach((id) => {
      const node = nodesMap.get(id);
      if (node) matchedNodes.push(node);
    });

    if (statusEl) {
      statusEl.textContent = this.localization?.t?.("search.count", { count: matchedNodes.length }, `${matchedNodes.length} nodes`) || `${matchedNodes.length} nodes`;
    }

    if (matchedNodes.length === 0) {
      resultsContainer.hidden = false;
      resultsContainer.setAttribute("aria-hidden", "true");
      if ("inert" in resultsContainer) resultsContainer.inert = true;
      searchWidget?.classList.remove("has-search-results");
      return;
    }

    resultsContainer.hidden = false;
    resultsContainer.setAttribute("aria-hidden", "false");
    if ("inert" in resultsContainer) resultsContainer.inert = false;
    searchWidget?.classList.add("has-search-results");
    matchedNodes.slice(0, 10).forEach((node, idx) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `search-result search-result-item ${idx === 0 ? "is-highlighted" : ""}`;
      item.dataset.searchNodeId = String(node.id);
      const name = document.createElement("span");
      name.className = "search-result-name";
      name.textContent = String(node.name_zh || node.name || "");
      const type = document.createElement("span");
      type.className = "search-result-type";
      type.textContent = String(node.node_type_zh || node.node_type || node.type || "");
      item.append(name, type);
      resultsContainer.appendChild(item);
    });
  }

  /**
   * Destroy.
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._removeListeners();
    this._lastZoomReadoutValue = null;
    this._deferredZoomReadoutValue = null;
    this._keydownHandler = null;
    this._factionButtons = [];
    this._typeButtons = [];
    this._initialized = false;
  }
}
