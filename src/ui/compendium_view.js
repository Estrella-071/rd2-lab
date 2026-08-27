export { resolveNode3Icon } from "../domain/dice_icon.js";
import {
  getModalFocusable,
  handleModalKeydown,
  showComingSoonModal,
  hideComingSoonModal,
  restoreModalFocus,
  isCompendiumOpen,
  restoreCompendiumFocus,
  openCompendium,
  closeCompendium,
  openCompactModal,
  closeCompactModal,
} from "./compendium_overlay_controller.js";
import {
  bindCompendiumControls,
  listen,
  syncCategoryTabs,
  syncViewModeButtons,
  syncTabsIndicator,
} from "./compendium_controls.js";
import { renderDice, createDiceCard, createCompactDiceItem, getLinkedRunes } from "./compendium_dice_renderer.js";
import { renderMonsters, createMonsterCompactItem, createMonsterCard, createRankableStatItem } from "./compendium_monster_renderer.js";
import { renderEvents, renderHistoricalEvents, createEventCompactItem, createEventCard, createAugmentTree } from "./compendium_event_renderer.js";
import { attachElasticSlider } from "./compendium_utils.js";

function clearCompendiumTimers(view) {
  for (const timerName of ["_crossFadeTimer", "_openTimer", "_closeTimer", "_comingSoonCloseTimer", "_searchTimer"]) {
    if (view[timerName]) clearTimeout(view[timerName]);
    view[timerName] = null;
  }
}

function removeCompendiumListeners(view) {
  for (const { target, type, handler } of view._controlListeners) target.removeEventListener?.(type, handler);
  view._controlListeners = [];
  if (view.overlay && view._tagClickHandler) view.overlay.removeEventListener("click", view._tagClickHandler);
  if (view.overlay && view._tagKeydownHandler) view.overlay.removeEventListener("keydown", view._tagKeydownHandler);
  if (typeof document !== "undefined" && view._boundModalKeydown) document.removeEventListener("keydown", view._boundModalKeydown);
  view._tagClickHandler = null;
  view._tagKeydownHandler = null;
}

function hideCompendiumSurfaces(view) {
  if (view.overlay) {
    view.overlay.hidden = true;
    view.overlay.setAttribute("aria-hidden", "true");
    view.overlay.setAttribute("inert", "");
    view.overlay.classList.remove("is-entering", "is-exiting");
  }
  for (const element of [view.modalEl, view.comingSoonModal]) {
    if (!element) continue;
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("inert", "");
  }
  if (view.comingSoonModal) view.comingSoonModal.classList.remove("is-visible", "is-exiting");
  if (view.modalCardSlot) view.modalCardSlot.innerHTML = "";
}

/** Coordinates compendium panels and controls. */
export class CompendiumView {
  /**
   * @param {object} dependencies
   * @param {import("../app/store/app_store.js").AppStore} dependencies.store
   * @param {import("../app/usecases/sync_golem_rank.js").SyncGolemRankUseCase} dependencies.syncGolemRankUseCase
   * @param {import("../app/ports/spine_engine_port.js").SpineEnginePort} dependencies.spineEngine
   * @param {HTMLElement} [dependencies.container]
   * @param {Record<string, object>} [dependencies.tagDefinitions]
   * @param {import("../domain/localization.js").LocalizationService} [dependencies.localization]
   * @param {Function} [dependencies.onLocateNode]
   * @param {Function} [dependencies.onShowTagPopover]
   */
  constructor({ store, syncGolemRankUseCase, spineEngine, container, tagDefinitions = {}, localization, onLocateNode, onShowTagPopover } = {}) {
    this.store = store;
    this.syncGolemRankUseCase = syncGolemRankUseCase;
    this.spineEngine = spineEngine;
    this.container = container || (typeof document !== "undefined" ? document.getElementById("compendium-overlay") : null);
    this.tagDefinitions = tagDefinitions || {};
    this.localization = localization || null;
    this.onLocateNode = onLocateNode || null;
    this.onShowTagPopover = onShowTagPopover || null;

    this.category = "dice";
    this.branch = "all";
    this.eventMode = "all";
    this.monsterDifficulty = "normal";
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    this.viewMode = isMobile ? "grid" : "cards";
    this._userChangedViewMode = false;
    this.sort = "default";
    this.search = "";

    this._activeSpineElement = null;
    this._unsubscribe = null;
    this._searchTimer = null;
    this._crossFadeTimer = null;
    this._openTimer = null;
    this._closeTimer = null;
    this._comingSoonCloseTimer = null;
    this._modalReturnFocus = new Map();
    this._returnFocus = null;
    this._spineObserver = null;
    this._tagClickHandler = null;
    this._tagKeydownHandler = null;
    this._initialized = false;
    this._controlListeners = [];
    this._sliderDisposers = new Set();
    this._boundModalKeydown = (event) => this._handleModalKeydown(event);
  }

  /**
   * Initialize DOM listeners and state subscriptions.
   */
  init() {
    if (typeof document === "undefined") return;
    if (this._initialized) return;
    this._initialized = true;

    this.overlay = document.getElementById("compendium-overlay");
    this.sectionsWrap = document.getElementById("compendium-sections-wrap");
    this.emptyEl = document.getElementById("compendium-empty");
    this.countBadge = document.getElementById("compendium-count-badge");

    // Modal elements
    this.modalEl = document.getElementById("compendium-dice-modal");
    this.modalCardSlot = document.getElementById("compendium-modal-card-slot");
    this.modalCloseBtn = document.getElementById("compendium-modal-close");
    this.comingSoonModal = document.getElementById("coming-soon-modal");
    this.comingSoonCloseBtn = document.getElementById("coming-soon-close-btn");

    // Tag explanations are rendered inside cards and runes as sanitized,
    // keyboard-focusable inline elements. Delegate their interaction from
    // the overlay so rerendered cards keep the same behavior.
    this._tagClickHandler = (event) => this._handleTagInteraction(event);
    this._tagKeydownHandler = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      this._handleTagInteraction(event, true);
    };
    this.overlay?.addEventListener("click", this._tagClickHandler);
    this.overlay?.addEventListener("keydown", this._tagKeydownHandler);
    document.addEventListener("keydown", this._boundModalKeydown);

    this._bindControls();
    this._unsubscribe = this.store.subscribe((state, action) => {
      if (action?.type === "SET_GAME_DATA") {
        if (this.isOpen()) {
          this.render();
        }
      }
    });
  }

  setLocalization(localization, tagDefinitions = this.tagDefinitions) {
    this.localization = localization || null;
    if (tagDefinitions) this.tagDefinitions = tagDefinitions;
    if (this.isOpen()) this.render({ animated: false });
  }

  _setupSpineObserver() {
    if (typeof IntersectionObserver === "undefined") return;
    if (this._spineObserver) {
      this._spineObserver.disconnect();
    }
    const rootEl = typeof document !== "undefined" ? document.querySelector(".compendium-content, #compendium-overlay") : null;
    this._spineObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const visual = entry.target;
        const def = visual.__monsterVisualDefinition;
        // Keep posters static until the user focuses or hovers a card. A
        // single shared pool can then release an off-screen animation without
        // creating a burst of browser WebGL contexts during a compendium render.
        if (!entry.isIntersecting && def?.spine && this.spineEngine) {
          if (this.spineEngine) {
            this.spineEngine.releaseCanvas(visual);
          }
        }
      });
    }, { root: rootEl, rootMargin: "200px 0px" });
  }

  _handleTagInteraction(event, isKeyboard = false) {
    if (typeof this.onShowTagPopover !== "function") return;
    const target = event.target?.closest?.(".tooltip-tag-inline, .tooltip-hashtag-chip, [data-tag-key]");
    if (!target || !this.overlay?.contains?.(target)) return;

    if (isKeyboard) event.preventDefault();
    event.stopPropagation();
    this.onShowTagPopover(target.dataset.tagKey, target);
  }

  /**
   * Resolve an event from either the active or historical snapshot. This is
   * intentionally ID based so existing shared links remain useful after removal.
   */
  showEvent(eventId, eventMode = "all") {
    const id = String(eventId ?? "");
    const state = this.store?.getState?.() || {};
    const source = [
      ...(Array.isArray(state.bossEvents?.events) ? state.bossEvents.events : []),
      ...(Array.isArray(state.bossEvents?.historical_events) ? state.bossEvents.historical_events : [])
    ];
    const event = source.find((entry) => String(entry?.id ?? entry?.index ?? "") === id);
    if (!event) return false;
    this.category = "event";
    this.eventMode = eventMode;
    this.open();
    const card = event.eventKind === "AugmentSystem" && Array.isArray(event.augment_choices) && event.augment_choices.length > 0
      ? this._createAugmentTree(event, 0, eventMode)
      : this._createEventCard(event, 0, eventMode);
    this.openCompactModal(card);
    return true;
  }

  /**
   * Main render dispatch based on category.
   * @param {object} [options]
   * @param {boolean} [options.animated]
   */
  render(options = {}) {
    if (!this.sectionsWrap) return;

    if (this._spineObserver) {
      this._spineObserver.disconnect();
    }
    if (this.spineEngine) {
      this.spineEngine.disposeAll();
    }
    this._activeSpineElement = null;

    const performRender = () => {
      if (!this.sectionsWrap) return;
      this._disposeSliders();
      this.sectionsWrap.innerHTML = "";

      if (this.category === "monster") {
        this._setupSpineObserver();
        this._renderMonsters();
      } else if (this.category === "event") {
        this._renderEvents();
      } else {
        this._renderDice();
      }

      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          this.sectionsWrap?.classList.remove("is-switching");
        });
      } else {
        this.sectionsWrap?.classList.remove("is-switching");
      }
    };

    const hasExistingCards = this.sectionsWrap.children.length > 0;
    const shouldAnimate = options.animated !== false && hasExistingCards;

    if (shouldAnimate) {
      this.sectionsWrap.classList.add("is-switching");
      if (this._crossFadeTimer) clearTimeout(this._crossFadeTimer);
      this._crossFadeTimer = setTimeout(() => {
        performRender();
      }, 80);
    } else {
      this.sectionsWrap.classList.remove("is-switching");
      performRender();
    }
  }

  // These delegates keep rendering, controls, overlays, and shared widgets in
  // focused modules while the view owns their shared state.
  _getModalFocusable(...args) {
    return getModalFocusable(this, ...args);
  }

  _handleModalKeydown(...args) {
    return handleModalKeydown(this, ...args);
  }

  _showComingSoonModal(...args) {
    return showComingSoonModal(this, ...args);
  }

  _hideComingSoonModal(...args) {
    return hideComingSoonModal(this, ...args);
  }

  _restoreModalFocus(...args) {
    return restoreModalFocus(this, ...args);
  }

  isOpen(...args) {
    return isCompendiumOpen(this, ...args);
  }

  _restoreCompendiumFocus(...args) {
    return restoreCompendiumFocus(this, ...args);
  }

  open(...args) {
    return openCompendium(this, ...args);
  }

  close(...args) {
    return closeCompendium(this, ...args);
  }

  _bindControls(...args) {
    return bindCompendiumControls(this, ...args);
  }

  _listen(...args) {
    return listen(this, ...args);
  }

  _syncCategoryTabs(...args) {
    return syncCategoryTabs(this, ...args);
  }

  _syncViewModeButtons(...args) {
    return syncViewModeButtons(this, ...args);
  }

  _syncTabsIndicator(...args) {
    return syncTabsIndicator(this, ...args);
  }

  openCompactModal(...args) {
    return openCompactModal(this, ...args);
  }

  closeCompactModal(...args) {
    return closeCompactModal(this, ...args);
  }

  _renderDice(...args) {
    return renderDice(this, ...args);
  }

  _createDiceCard(...args) {
    return createDiceCard(this, ...args);
  }

  _createCompactDiceItem(...args) {
    return createCompactDiceItem(this, ...args);
  }

  _getLinkedRunes(...args) {
    return getLinkedRunes(this, ...args);
  }

  _renderMonsters(...args) {
    return renderMonsters(this, ...args);
  }

  _createMonsterCompactItem(...args) {
    return createMonsterCompactItem(this, ...args);
  }

  _createMonsterCard(...args) {
    return createMonsterCard(this, ...args);
  }

  _createRankableStatItem(...args) {
    return createRankableStatItem(this, ...args);
  }

  _renderEvents(...args) {
    return renderEvents(this, ...args);
  }

  _renderHistoricalEvents(...args) {
    return renderHistoricalEvents(this, ...args);
  }

  _createEventCompactItem(...args) {
    return createEventCompactItem(this, ...args);
  }

  _createEventCard(...args) {
    return createEventCard(this, ...args);
  }

  _createAugmentTree(...args) {
    return createAugmentTree(this, ...args);
  }

  _attachElasticSlider(...args) {
    const dispose = attachElasticSlider(...args);
    this._sliderDisposers.add(dispose);
    return dispose;
  }

  _disposeSliders() {
    for (const dispose of this._sliderDisposers) {
      dispose();
    }
    this._sliderDisposers.clear();
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    if (this._spineObserver) {
      this._spineObserver.disconnect();
      this._spineObserver = null;
    }
    removeCompendiumListeners(this);
    clearCompendiumTimers(this);
    this._disposeSliders();
    this.spineEngine?.disposeAll();
    this._activeSpineElement = null;
    hideCompendiumSurfaces(this);
    this._modalReturnFocus.clear();
    this._returnFocus = null;
    this._initialized = false;
  }

}
