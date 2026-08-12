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
  if (view.overlay && view._bonusClickHandler) view.overlay.removeEventListener("click", view._bonusClickHandler);
  if (view.overlay && view._cardClickHandler) view.overlay.removeEventListener("click", view._cardClickHandler);
  if (typeof document !== "undefined" && view._boundModalKeydown) document.removeEventListener("keydown", view._boundModalKeydown);
  view._tagClickHandler = null;
  view._tagKeydownHandler = null;
  view._bonusClickHandler = null;
  view._cardClickHandler = null;
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
   * @param {HTMLElement} [dependencies.container]
   * @param {Record<string, object>} [dependencies.tagDefinitions]
   * @param {import("../domain/localization.js").LocalizationService} [dependencies.localization]
   * @param {Function} [dependencies.onLocateNode]
   * @param {Function} [dependencies.onShowTagPopover]
   * @param {Function} [dependencies.onShowBonusPopover]
   * @param {Function} [dependencies.onHideBonusPopover]
   * @param {Function} [dependencies.onNavigate]
   */
  constructor({ store, syncGolemRankUseCase, container, tagDefinitions = {}, localization, onLocateNode, onShowTagPopover, onShowBonusPopover, onHideBonusPopover, onNavigate } = {}) {
    this.store = store;
    this.syncGolemRankUseCase = syncGolemRankUseCase;
    this.container = container || (typeof document !== "undefined" ? document.getElementById("compendium-overlay") : null);
    this.tagDefinitions = tagDefinitions || {};
    this.localization = localization || null;
    this.onLocateNode = onLocateNode || null;
    this.onShowTagPopover = onShowTagPopover || null;
    this.onShowBonusPopover = onShowBonusPopover || null;
    this.onHideBonusPopover = onHideBonusPopover || null;
    this.onNavigate = onNavigate || null;

    this.category = "dice";
    this.branch = "all";
    this.eventMode = "all";
    this.monsterDifficulty = "normal";
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    this.viewMode = isMobile ? "grid" : "cards";
    this._userChangedViewMode = false;
    this.sort = "default";
    this.search = "";

    this._unsubscribe = null;
    this._searchTimer = null;
    this._crossFadeTimer = null;
    this._openTimer = null;
    this._closeTimer = null;
    this._comingSoonCloseTimer = null;
    this._modalReturnFocus = new Map();
    this._returnFocus = null;
    this._tagClickHandler = null;
    this._tagKeydownHandler = null;
    this._bonusClickHandler = null;
    this._cardClickHandler = null;
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
    this._bonusClickHandler = (event) => this._handleBonusInteraction(event);
    this._cardClickHandler = (event) => this._handleCardNavigation(event);
    this.overlay?.addEventListener("click", this._tagClickHandler);
    this.overlay?.addEventListener("keydown", this._tagKeydownHandler);
    this.overlay?.addEventListener("click", this._bonusClickHandler);
    this.overlay?.addEventListener("click", this._cardClickHandler);
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

  _t(key, values = {}, fallback = "") {
    return this.localization?.t?.(key, values, fallback) || fallback || key;
  }

  _handleTagInteraction(event, isKeyboard = false) {
    if (typeof this.onShowTagPopover !== "function") return;
    const target = event.target?.closest?.(".tooltip-tag-inline, .tooltip-hashtag-chip, [data-tag-key]");
    if (!target || !this.overlay?.contains?.(target)) return;

    if (isKeyboard) event.preventDefault();
    event.stopPropagation();
    this.onShowTagPopover(target.dataset.tagKey, target);
  }

  _handleBonusInteraction(event) {
    const target = event.target?.closest?.(".stat-bonus-combined");
    if (!target || !this.overlay?.contains?.(target)) return;
    if (typeof this.onShowBonusPopover !== "function") return;
    event.stopPropagation();
    this.onShowBonusPopover(target);
  }

  _handleCardNavigation(event) {
    if (event.defaultPrevented || typeof this.onNavigate !== "function") return;
    const target = event.target?.closest?.("[data-compendium-category][data-compendium-id]");
    if (!target || !this.overlay?.contains?.(target)) return;
    if (event.target?.closest?.("button, input, select, textarea, a")) return;
    this.onNavigate({
      kind: "compendium-card",
      category: target.dataset.compendiumCategory,
      id: target.dataset.compendiumId,
      eventMode: target.dataset.eventMode || this.eventMode
    });
  }

  /**
   * Resolve an event from either the active or historical snapshot. This is
   * intentionally ID based so existing shared links remain useful after removal.
   */
  showEvent(eventId, eventMode = "all") {
    return this.showCard("event", eventId, eventMode);
  }

  showCard(category, cardId, eventMode = "all") {
    const normalizedCategory = String(category || "").toLowerCase();
    const id = String(cardId ?? "");
    const state = this.store?.getState?.() || {};
    let cardEntity = null;
    if (normalizedCategory === "dice") {
      cardEntity = state.nodesMap?.get(id) || null;
    } else if (normalizedCategory === "monster") {
      cardEntity = (state.bossEvents?.monsters || []).find((entry) => String(entry?.id ?? entry?.index ?? "") === id) || null;
    } else if (normalizedCategory === "event") {
      const source = [
        ...(Array.isArray(state.bossEvents?.events) ? state.bossEvents.events : []),
        ...(Array.isArray(state.bossEvents?.historical_events) ? state.bossEvents.historical_events : [])
      ];
      cardEntity = source.find((entry) => String(entry?.id ?? entry?.index ?? "") === id) || null;
    }
    if (!cardEntity) return false;
    this.category = normalizedCategory;
    this.eventMode = eventMode;
    this.open(null, { updateUrl: false });
    let card;
    if (normalizedCategory === "dice") card = this._createDiceCard(cardEntity, 0);
    else if (normalizedCategory === "monster") card = this._createMonsterCard(cardEntity, 0);
    else card = cardEntity.eventKind === "AugmentSystem" && Array.isArray(cardEntity.augment_choices) && cardEntity.augment_choices.length > 0
      ? this._createAugmentTree(cardEntity, 0, eventMode)
      : this._createEventCard(cardEntity, 0, eventMode);
    this.openCompactModal(card);
    this.onNavigate?.({ kind: "compendium-card", category: normalizedCategory, id, eventMode });
    return true;
  }

  /**
   * Main render dispatch based on category.
   * @param {object} [options]
   * @param {boolean} [options.animated]
   */
  render(options = {}) {
    if (!this.sectionsWrap) return;

    this.onHideBonusPopover?.();

    const performRender = () => {
      if (!this.sectionsWrap) return;
      this._disposeSliders();
      this.sectionsWrap.innerHTML = "";

      if (this.category === "monster") {
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

  _navigateCollection() {
    this.onNavigate?.({
      kind: "compendium",
      category: this.category,
      eventMode: this.eventMode
    });
  }

  open(triggerElement = null, options = {}) {
    const result = openCompendium(this, triggerElement);
    this._syncCategoryTabs();
    if (options.updateUrl !== false) this._navigateCollection();
    return result;
  }

  openCategory(category = "dice", eventMode = "all") {
    const normalizedCategory = ["dice", "monster", "event"].includes(String(category).toLowerCase())
      ? String(category).toLowerCase()
      : "dice";
    this.category = normalizedCategory;
    this.eventMode = normalizedCategory === "event" && ["all", "coop", "versus"].includes(String(eventMode))
      ? String(eventMode)
      : "all";
    return this.open(null, { updateUrl: false });
  }

  close(...args) {
    this.onHideBonusPopover?.();
    const targetNodeId = args[0] || "";
    const result = closeCompendium(this, ...args);
    if (targetNodeId) this.onNavigate?.({ kind: "tree-node", id: targetNodeId });
    else this.onNavigate?.({ kind: "home" });
    return result;
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
    this.onHideBonusPopover?.();
    const result = closeCompactModal(this, ...args);
    this._navigateCollection();
    return result;
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
    removeCompendiumListeners(this);
    clearCompendiumTimers(this);
    this._disposeSliders();
    hideCompendiumSurfaces(this);
    this._modalReturnFocus.clear();
    this._returnFocus = null;
    this._initialized = false;
  }

}
