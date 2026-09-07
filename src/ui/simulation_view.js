import {
  getRank,
  getMaxRank,
  getRunesForDiceNode,
  calculateQuickUnlockState
} from "../domain/simulation_plan.js";
import {
  listSimulationSlots,
  saveSimulationSlot,
  loadSimulationSlot,
  deleteSimulationSlot,
  sanitizeSlotName
} from "../domain/simulation_save.js";
import { ActionTypes } from "../app/store/app_store.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";
import { FACTION_DATA } from "../domain/faction_data.js";
import { parseUrlState, URL_ROUTE_KINDS } from "../domain/url_state.js";
import { attachElasticSlider } from "./compendium_utils.js";

export function getNodeIconPath(node, fallback = "icons/TreeShadow_sprite-186.png") {
  if (!node) return fallback;
  if (node.node_type === "DICE") {
    const dice3 = resolveNode3Icon(node);
    if (dice3) return `icons/${dice3}`;
  }
  if (node.icon_file) {
    return node.icon_file.startsWith("icons/") ? node.icon_file : `icons/${node.icon_file}`;
  }
  const dice3 = resolveNode3Icon(node);
  if (dice3) return `icons/${dice3}`;
  return fallback;
}

export const SUPPORT_NODE_IDS = ["1114", "2114", "3114", "4114", "5114"];

function formatNumber(value, localization) {
  return Number(value || 0).toLocaleString(localization?.getIntlLocale?.() || "zh-TW");
}

function forceReflow(element) {
  return element?.offsetWidth;
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof atob !== "function") return null;
  try {
    const [header, base64Data] = dataUrl.split(",");
    if (!base64Data) return null;
    const colonIndex = header.indexOf(":");
    const semiIndex = header.indexOf(";");
    const mime = (colonIndex !== -1 && semiIndex > colonIndex)
      ? header.slice(colonIndex + 1, semiIndex)
      : "image/png";
    const bstr = atob(base64Data);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      u8arr[i] = bstr.codePointAt(i);
    }
    return new Blob([u8arr], { type: mime });
  } catch (error) {
    // 轉換資料 URL 為二進位 Blob 失敗時安全返回 null
    console.warn("dataUrlToBlob failed:", error);
    return null;
  }
}

function updateSimulationToggle(active, localization) {
  const toggle = document.getElementById("simulation-toggle-btn");
  if (!toggle) return;
  toggle.setAttribute("aria-pressed", String(active));
  const exitWidget = document.getElementById("simulation-exit-widget");
  toggle.setAttribute("aria-expanded", String(Boolean(active && exitWidget?.classList.contains("is-expanded"))));
  const actionLabel = localization?.t?.(
    active ? "simulation.modeOn" : "simulation.modeOff",
    {},
    active ? "Exit build simulation mode" : "Open build simulation mode"
  ) || (active ? "Exit build simulation mode" : "Open build simulation mode");
  toggle.setAttribute("aria-label", actionLabel);
  toggle.title = actionLabel;
  const label = toggle.querySelector("span:last-child");
  if (label) {
    label.textContent = localization?.t?.(
      active ? "simulation.modeOnLabel" : "simulation.modeOffLabel",
      {},
      active ? "Exit simulation" : "Build simulation"
    ) || (active ? "Exit simulation" : "Build simulation");
  }
}

function updateSimulationModeChrome(active, localization) {
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("simulation-mode", active);
  }
  updateSimulationToggle(active, localization);
  const topCapsule = document.getElementById("simulation-top-capsule-group");
  if (topCapsule) topCapsule.hidden = !active;
}

function updateSimulationCenterLabels(center, active, localization = null) {
  center.classList.toggle("is-simulation-disabled", active);
  center.setAttribute("aria-disabled", String(active));
  center.setAttribute("tabindex", active ? "-1" : "0");
  center.toggleAttribute("disabled", active);
  const label = localization?.t?.(
    active ? "compendium.simulationCenterTitle" : "compendium.centerTitle",
    {},
    active ? "Dice tree" : "Compendium"
  ) || (active ? "Dice tree" : "Compendium");
  center.setAttribute("aria-label", label);
  center.dataset.renderedLabel = label;
  center.dataset.simulationActive = String(active);
}

export class SimulationView {
  constructor({ store, simulationUseCase, container, tooltipElement, localization, storagePort, onShareUrl } = {}) {
    this.store = store;
    this.simulationUseCase = simulationUseCase;
    this.container = container || (typeof document !== "undefined" ? document.body : null);
    this.tooltipElement = tooltipElement || (typeof document !== "undefined" ? document.getElementById("tooltip") : null);
    this.localization = localization || null;
    this.storagePort = storagePort || (typeof window !== "undefined" ? window.localStorage : null);
    this.onShareUrl = typeof onShareUrl === "function" ? onShareUrl : null;

    this._unsubscribe = null;
    this._lastSpent = { gold: 0, core: 0, solar: 0 };
    this._tooltipRefreshTimer = null;

    // Team dice picker in share widget
    this._draftDiceIds = [];
    this._pickerReturnTeamIndex = null;

    // Quick Unlock state
    this._quickUnlockDraft = {
      diceIds: [null, null, null, null, null],
      supportId: null,
      excludedNodeIds: new Set(),
      rankOverrides: {}
    };
    this._activeQuickSlotIndex = null;

    // Share controls & images cache
    this._shareShowNames = false;
    this._shareShowTeam = true;
    this._shareSplitEnabled = true;
    this._shareSplitMode = "auto";
    this._shareMode = "tree"; // "tree" | "details"
    this._shareDetailsTitle = "配點配置詳情";
    this._shareImageCache = null;
    this._shareImagePromise = null;
    this._cachedSplitResult = null;
    this._cachedDetailsResult = null;
    this._shareUrlCache = new Map();
    this._shareUrlPromise = null;
    this._currentLocale = "zh-tw";
    this._shareLoadGeneration = 0;
    this._shareRenderGeneration = 0;

    // Confirm dialog resolver
    this._confirmResolver = null;

    this._initialized = false;
    this._boundClick = (event) => this._handleClick(event);
    this._boundKeydown = (event) => this._handleKeydown(event);
  }

  setLocalization(localization) {
    this.localization = localization || null;
    this._currentLocale = this.localization?.getLocale?.() || this.store?.getState?.()?.locale || "zh-tw";
    this._shareUrlCache.clear();
    this._clearShareImageCaches();
    const state = this.store?.getState?.();
    if (!state) return;
    updateSimulationModeChrome(Boolean(state.simulation?.active), this.localization);
    const center = typeof document !== "undefined" ? document.getElementById("tree-center-compendium-btn") : null;
    if (center) updateSimulationCenterLabels(center, Boolean(state.simulation?.active), this.localization);
    this._refreshLocalizedPicker(state);
    const shareWidget = typeof document !== "undefined" ? document.getElementById("simulation-share-widget") : null;
    if (shareWidget?.classList.contains("is-expanded")) {
      this._refreshShareUrl({ showLoading: true });
      this._renderShareImagePreview();
    }
  }

  _t(key, values = {}, fallback = "") {
    return this.localization?.t?.(key, values, fallback) || fallback || key;
  }

  _refreshLocalizedPicker(state) {
    if (!state.simulation?.active) return;
    this._updateCostHud(state.simulation);
    const shareWidget = typeof document !== "undefined" ? document.getElementById("simulation-share-widget") : null;
    if (!shareWidget?.classList.contains("is-expanded")) return;
    const pickerTitle = document.getElementById("simulation-picker-title");
    if (pickerTitle) pickerTitle.textContent = this._t("simulation.pickerTitle", {}, "Choose team dice");
    this._renderTeamSlots(1);
    this._renderDicePickerGrid((state.treeData?.nodes || []).filter((node) => node.node_type === "DICE" && getRank(state.simulation, node.id) > 0));
    if (!shareWidget.classList.contains("is-picker-mode")) this._renderShareImagePreview();
  }

  init() {
    if (!this.container || !this.store || !this.simulationUseCase || this._initialized) return;
    this._initialized = true;
    this.container.addEventListener("click", this._boundClick);
    if (typeof window !== "undefined") window.addEventListener("keydown", this._boundKeydown);

    this._bindShareOptionEvents();

    this._unsubscribe = this.store.subscribe((state, action) => {
      if (action?.type === "UPDATE_VIEWPORT" || action?.type === "SET_VIEWPORT") return;
      this.render(state);
    });
    this.render(this.store.getState());

    // Share link resolution
    const urlState = typeof window !== "undefined" ? parseUrlState(window.location.href) : null;
    const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const hashParams = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.replace(/^#/, "")) : null;
    const routeShare = urlState?.kind === URL_ROUTE_KINDS.SIMULATION ? urlState.share : "";
    const remoteCode = /^[0-9A-Za-z]{6}$/.exec(routeShare)?.[0]
      || /^[0-9A-Za-z]{6}$/.exec(searchParams?.get("s") || "")?.[0]
      || /^[0-9A-Za-z]{6}$/.exec(hashParams?.get("s") || "")?.[0]
      || "";
    if (remoteCode) {
      this._importRemoteShare(remoteCode);
    } else if (routeShare || searchParams?.has("s") || searchParams?.has("sim") || hashParams?.has("s") || hashParams?.has("sim")) {
      this.simulationUseCase.importShare(window.location.href, { active: true });
    }
  }

  _bindShareOptionEvents() {
    const showNamesToggle = document.getElementById("simulation-share-show-names");
    if (showNamesToggle) {
      showNamesToggle.checked = this._shareShowNames;
      showNamesToggle.addEventListener("change", (e) => {
        this._shareShowNames = Boolean(e.target.checked);
        this._clearShareImageCaches();
        this._renderShareImagePreview();
      });
    }

    const showTeamToggle = document.getElementById("simulation-share-show-team");
    if (showTeamToggle) {
      showTeamToggle.checked = this._shareShowTeam;
      showTeamToggle.addEventListener("change", (e) => {
        this._shareShowTeam = Boolean(e.target.checked);
        this._clearShareImageCaches();
        this._renderShareImagePreview();
      });
    }

    const splitToggle = document.getElementById("simulation-share-split-toggle");
    if (splitToggle) {
      splitToggle.checked = this._shareSplitEnabled;
      splitToggle.addEventListener("change", (e) => {
        this._shareSplitEnabled = Boolean(e.target.checked);
        this._clearShareImageCaches();
        this._renderShareImagePreview();
      });
    }

    const titleInput = document.getElementById("simulation-share-title-input");
    if (titleInput) {
      titleInput.value = this._shareDetailsTitle;
      titleInput.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        this._shareDetailsTitle = val || "配點配置詳情";
        this._cachedDetailsResult = null;
        if (this._shareMode === "details") {
          this._renderShareImagePreview();
        }
      });
    }
  }

  _clearShareImageCaches() {
    this._shareImageCache = null;
    this._shareImagePromise = null;
    this._cachedSplitResult = null;
    this._cachedDetailsResult = null;
  }

  async _importRemoteShare(code) {
    const generation = this._shareLoadGeneration;
    const result = await this.simulationUseCase.loadShareCode(code);
    if (generation !== this._shareLoadGeneration || !this._initialized || !result?.ok) return result;
    return this.simulationUseCase.importShare(result.encoded, { active: true });
  }

  render(state) {
    const nextLocale = state?.locale || this.localization?.getLocale?.() || "zh-tw";
    if (this._currentLocale && this._currentLocale !== nextLocale) {
      this._shareUrlCache.clear();
      this._clearShareImageCaches();
    }
    this._currentLocale = nextLocale;

    const simulation = state?.simulation || { active: false, spent: { gold: 0, core: 0, solar: 0 }, team: { dice: [], commonNodes: [] } };
    const active = Boolean(simulation.active);
    updateSimulationModeChrome(active, this.localization);

    if (active) {
      this._updateCostHud(simulation);
      const shareWidget = document.getElementById("simulation-share-widget");
      if (shareWidget?.classList.contains("is-expanded") && !shareWidget.classList.contains("is-picker-mode")) {
        this._refreshShareUrl();
      }
    } else {
      this._closeShareWidget();
      this._closeExitWidget();
      this._closeQuickUnlockModal();
      this._closeSaveModal();
      this._closeConfirmModal();
      this._setCenterSimulationState(false);
    }
    this._setCenterSimulationState(active);
  }

  _updateCostHud(simulation) {
    const spent = simulation.spent || { gold: 0, core: 0, solar: 0 };
    const goldEl = document.getElementById("simulation-gold-total");
    const coreEl = document.getElementById("simulation-core-total");
    const solarEl = document.getElementById("simulation-solar-total");
    if (goldEl) goldEl.textContent = formatNumber(spent.gold, this.localization);
    if (coreEl) coreEl.textContent = formatNumber(spent.core, this.localization);
    if (solarEl) solarEl.textContent = formatNumber(spent.solar || 0, this.localization);

    const goldCapsule = goldEl?.closest(".simulation-currency-capsule");
    const coreCapsule = coreEl?.closest(".simulation-currency-capsule");
    const solarCapsule = solarEl?.closest(".simulation-currency-capsule");

    if (solarCapsule) solarCapsule.hidden = !spent.solar;

    if (this._lastSpent !== null) {
      const triggerPop = (capsule) => {
        if (!capsule) return;
        capsule.classList.remove("is-popping");
        if (typeof capsule.offsetWidth === "number") forceReflow(capsule);
        capsule.classList.add("is-popping");
        capsule.addEventListener("animationend", () => capsule.classList.remove("is-popping"), { once: true });
      };

      if (spent.gold !== this._lastSpent.gold) triggerPop(goldCapsule);
      if (spent.core !== this._lastSpent.core) triggerPop(coreCapsule);
      if ((spent.solar || 0) !== (this._lastSpent.solar || 0)) triggerPop(solarCapsule);
    }
    this._lastSpent = { gold: spent.gold || 0, core: spent.core || 0, solar: spent.solar || 0 };
  }

  /* -------------------------------------------------------------
   * Event Handling
   * ------------------------------------------------------------- */
  _handleBackdropSlider(clickedEl) {
    if (!clickedEl.closest(".quick-unlock-slider-popover") && !clickedEl.closest(".quick-unlock-rune-rank-tag")) {
      const isButton = Boolean(clickedEl.closest("button:not(.quick-unlock-rune-rank-tag)"));
      const closed = this._closeQuickUnlockSliderPopovers();
      if (closed && !isButton) {
        return true;
      }
    }
    return false;
  }

  _handleBackdropConfirm(clickedEl) {
    const confirmModal = document.getElementById("simulation-confirm-modal");
    if (confirmModal && !confirmModal.hasAttribute("hidden")) {
      const confirmCard = confirmModal.querySelector(".simulation-confirm-card");
      if (confirmCard && !confirmCard.contains(clickedEl)) {
        this._closeConfirmModal();
        return true;
      }
    }
    return false;
  }

  _handleBackdropSave(clickedEl) {
    const saveModal = document.getElementById("simulation-save-modal");
    if (saveModal && !saveModal.hasAttribute("hidden")) {
      const saveCard = saveModal.querySelector(".simulation-save-card");
      if (saveCard && !saveCard.contains(clickedEl)) {
        this._closeSaveModal();
        return true;
      }
    }
    return false;
  }

  _handleBackdropQuickUnlock(clickedEl) {
    const quickModal = document.getElementById("simulation-quick-unlock-modal");
    if (quickModal && !quickModal.hasAttribute("hidden")) {
      const quickCard = quickModal.querySelector(".quick-unlock-card");
      if (quickCard && !quickCard.contains(clickedEl)) {
        const pickerPane = document.getElementById("quick-unlock-picker-pane");
        if (pickerPane && !pickerPane.hidden) {
          this._switchToQuickUnlockMainView();
        } else {
          this._closeQuickUnlockModal();
        }
        return true;
      }
    }
    return false;
  }

  _handleBackdropShare(clickedEl) {
    const shareWidget = document.getElementById("simulation-share-widget");
    if (shareWidget?.classList.contains("is-expanded")) {
      const shareCard = document.getElementById("simulation-share-card");
      const shareTrigger = document.getElementById("simulation-share-trigger-btn");
      if (shareCard && !shareCard.contains(clickedEl) && !shareTrigger?.contains(clickedEl)) {
        const pickerPane = document.getElementById("simulation-picker-pane");
        if (pickerPane && !pickerPane.hidden) {
          this._switchToShareView();
        } else {
          this._closeShareWidget();
        }
        return true;
      }
    }
    return false;
  }

  _handleBackdropClick(event) {
    const clickedEl = event.target;
    if (!clickedEl) return false;

    return (
      this._handleBackdropSlider(clickedEl) ||
      this._handleBackdropConfirm(clickedEl) ||
      this._handleBackdropSave(clickedEl) ||
      this._handleBackdropQuickUnlock(clickedEl) ||
      this._handleBackdropShare(clickedEl)
    );
  }

  _handleClick(event) {
    if (this._handleBackdropClick(event)) return;

    const target = event.target?.closest?.("button, [data-simulation-close], .simulation-picker-card, .quick-unlock-main-slot, .quick-unlock-rune-card, .quick-unlock-support-slot, .simulation-split-tool-btn, .simulation-download-popover-item");
    if (!target) {
      if (!event.target?.closest?.(".simulation-download-popover")) {
        this._closeDownloadPopovers();
      }
      this._closeQuickUnlockSliderPopovers();
      return;
    }
    const id = target.id;

    if (this._handleTopControls(target, id)) return;
    if (this._handleExitToolbarClicks(target, id)) return;
    if (this._handleQuickUnlockClicks(target, id)) return;
    if (this._handleSaveModalClicks(target, id)) return;
    if (this._handleConfirmModalClicks(target, id)) return;
    if (this._handleShareControlClicks(target, id)) return;
    if (this._handleTeamSlotClicks(target)) return;
    if (this._handlePickerControlClicks(target, id)) return;

    if (!target.closest("#simulation-share-widget")) this._closeShareWidget();
    if (!target.closest("#simulation-exit-widget")) this._closeExitWidget();

    this._handleSimulationAction(target, event);
  }

  _handleTopControls(target, id) {
    if (id === "simulation-toggle-btn") {
      if (this.store.getState()?.simulation?.active) {
        this._toggleExitWidget();
      } else {
        this.simulationUseCase.enter();
        this._openQuickUnlockModal();
      }
      return true;
    }
    if (id === "simulation-active-top-toggle") {
      this.simulationUseCase.toggle();
      return true;
    }
    if (id === "simulation-reset-top-btn") {
      this._openResetConfirmModal();
      return true;
    }
    if (id === "simulation-save-top-btn") {
      this._openSaveModal();
      return true;
    }
    if (id === "simulation-share-top-btn") {
      this._openShareWidget();
      return true;
    }
    if (id === "simulation-quick-unlock-top-btn") {
      this._openQuickUnlockModal();
      return true;
    }
    return false;
  }

  _openResetConfirmModal() {
    return this._showConfirmModal({
      title: this._t("simulation.resetTitle", {}, "重置模擬配點"),
      message: this._t("simulation.resetConfirm", {}, "確定要清空所有模擬配點嗎？已分配的強化將被還原。"),
      okText: this._t("simulation.resetAction", {}, "重置"),
      cancelText: this._t("common.cancel", {}, "取消")
    }).then((ok) => {
      if (ok) {
        this.simulationUseCase.reset();
        this._closeExitWidget();
      }
      return ok;
    });
  }

  _handleExitToolbarClicks(target, id) {
    if (id === "simulation-quick-unlock-trigger-btn") {
      this._closeExitWidget();
      this._openQuickUnlockModal();
      return true;
    }
    if (id === "simulation-save-trigger-btn") {
      this._closeExitWidget();
      this._openSaveModal();
      return true;
    }
    if (id === "simulation-reset-btn" || id === "simulation-reset-exit-btn") {
      this._openResetConfirmModal();
      return true;
    }
    if (id === "simulation-pause-btn") {
      this._pauseSimulation();
      return true;
    }
    if (id === "simulation-exit-confirm-btn") {
      this._closeExitWidget();
      this.simulationUseCase.toggle();
      return true;
    }
    if (id === "simulation-exit-cancel-btn" || target.dataset.simulationClose === "exit-widget") {
      this._closeExitWidget();
      return true;
    }
    return false;
  }

  _handleShareBaseButtonClicks(target, id) {
    if (id === "simulation-share-trigger-btn" || target.closest("#simulation-share-trigger-btn")) {
      this._toggleShareWidget(target);
      return true;
    }
    if (id === "simulation-share-close-btn" || target.dataset.simulationClose === "share-widget") {
      this._closeDownloadPopovers();
      this._closeShareWidget({ restoreFocus: true });
      return true;
    }
    if (id === "simulation-copy-share-btn") {
      this._copyShareUrl();
      return true;
    }
    if (id === "simulation-image-share-btn") {
      this._downloadShareImage();
      return true;
    }
    if (id === "simulation-image-download-all-btn") {
      this._downloadAllSplitImages();
      return true;
    }
    if (id === "simulation-share-mode-tree-btn") {
      this._closeDownloadPopovers();
      this._switchShareMode("tree");
      return true;
    }
    if (id === "simulation-share-mode-details-btn") {
      this._closeDownloadPopovers();
      this._switchShareMode("details");
      return true;
    }
    if (id === "simulation-details-settings-btn") {
      this._closeDownloadPopovers();
      this._closeShareWidget();
      this._openQuickUnlockModal();
      return true;
    }
    return false;
  }

  _handleSharePopoverItemClicks(target) {
    const popoverItem = target.closest(".simulation-download-popover-item");
    if (!popoverItem) return false;

    const idx = Number(popoverItem.dataset.partIndex || 0);
    if (popoverItem.classList.contains("is-popover-download-single")) {
      if (this._shareMode === "details" || !this._shareSplitEnabled) {
        this._downloadShareImage();
      } else {
        this._downloadSplitPartImage(idx);
      }
    } else if (popoverItem.classList.contains("is-popover-download-all")) {
      this._downloadAllSplitImages();
    } else if (popoverItem.classList.contains("is-popover-copy")) {
      this._copySplitPartImage(idx, popoverItem);
    }
    this._closeDownloadPopovers();
    return true;
  }

  _handleShareSplitButtonClicks(target) {
    const splitBtn = target.closest(".simulation-split-tool-btn");
    if (!splitBtn) return false;

    const idx = Number(splitBtn.dataset.partIndex || 0);
    if (splitBtn.classList.contains("is-copy")) {
      this._copySplitPartImage(idx, splitBtn);
      return true;
    }
    if (splitBtn.classList.contains("is-download")) {
      this._toggleDownloadPopover(splitBtn, idx);
      return true;
    }
    return false;
  }

  _handleShareControlClicks(target, id) {
    if (this._handleShareBaseButtonClicks(target, id)) return true;
    if (this._handleSharePopoverItemClicks(target)) return true;
    if (this._handleShareSplitButtonClicks(target)) return true;

    if (!target.closest(".simulation-download-popover") && !target.closest(".simulation-split-tool-btn.is-download")) {
      this._closeDownloadPopovers();
    }

    return false;
  }

  _handleTeamSlotClicks(target) {
    const teamCard = target.closest(".simulation-team-dice-card");
    if (teamCard) {
      this._switchToPickerView(0, target);
      return true;
    }
    if (target.closest("#simulation-team-slots-1")) {
      this._switchToPickerView(0, target);
      return true;
    }
    return false;
  }

  _handlePickerControlClicks(target, id) {
    if (id === "simulation-picker-back-btn" || target.closest("#simulation-picker-back-btn") || id === "simulation-picker-cancel") {
      this._switchToShareView({ restoreFocus: true });
      return true;
    }
    if (id === "simulation-picker-save") {
      this._saveDicePicker();
      this._switchToShareView({ restoreFocus: true });
      return true;
    }
    if (target.classList.contains("simulation-picker-card") || target.closest(".simulation-picker-card")) {
      const card = target.classList.contains("simulation-picker-card") ? target : target.closest(".simulation-picker-card");
      const diceId = card?.dataset?.diceId;
      if (diceId) this._toggleDicePickerSelection(diceId);
      return true;
    }
    return false;
  }

  _handleSimulationAction(target, event) {
    const simulationAction = target.dataset.simAction;
    if (!simulationAction) return;
    event.stopPropagation();
    const nodeId = target.dataset.simNodeId;
    const actions = {
      unlock: () => this.simulationUseCase.unlock(nodeId),
      upgrade: () => this.simulationUseCase.unlock(nodeId),
      batch: () => this.simulationUseCase.batchUnlock(nodeId),
      revoke: () => this.simulationUseCase.revoke(nodeId),
      max: () => this.simulationUseCase.maxRank(nodeId)
    };
    actions[simulationAction]?.();
  }

  _handleEscapePopovers() {
    const popovers = document.querySelectorAll(".simulation-download-popover");
    if (popovers.length > 0) {
      this._closeDownloadPopovers();
      return true;
    }
    return Boolean(this._closeQuickUnlockSliderPopovers());
  }

  _handleEscapeModals() {
    const confirmModal = document.getElementById("simulation-confirm-modal");
    if (confirmModal && !confirmModal.hasAttribute("hidden")) {
      this._closeConfirmModal(false);
      return true;
    }

    const saveModal = document.getElementById("simulation-save-modal");
    if (saveModal && !saveModal.hasAttribute("hidden")) {
      this._closeSaveModal();
      return true;
    }

    const quickModal = document.getElementById("simulation-quick-unlock-modal");
    if (quickModal && !quickModal.hasAttribute("hidden")) {
      const card = quickModal.querySelector(".quick-unlock-card");
      if (card?.classList.contains("is-picker-mode")) {
        this._switchToQuickUnlockMainView();
      } else {
        this._closeQuickUnlockModal();
      }
      return true;
    }
    return false;
  }

  _handleEscapeWidgets() {
    const exitWidget = document.getElementById("simulation-exit-widget");
    if (exitWidget?.classList.contains("is-expanded")) {
      this._closeExitWidget({ restoreFocus: true });
      return true;
    }

    const shareWidget = document.getElementById("simulation-share-widget");
    if (shareWidget?.classList.contains("is-picker-mode")) {
      this._switchToShareView();
      return true;
    }
    if (shareWidget?.classList.contains("is-expanded")) {
      this._closeShareWidget({ restoreFocus: true });
      return true;
    }
    return false;
  }

  _handleKeydown(event) {
    if (event.key === "Escape") {
      if (this._handleEscapePopovers() || this._handleEscapeModals() || this._handleEscapeWidgets()) {
        event.preventDefault();
      }
    }
  }

  /* -------------------------------------------------------------
   * Quick Unlock Modal Logic
   * ------------------------------------------------------------- */
  _openQuickUnlockModal() {
    const modal = document.getElementById("simulation-quick-unlock-modal");
    if (!modal) return;

    this._closeExitWidget();
    this._closeShareWidget();

    const card = modal.querySelector(".quick-unlock-card");
    const mainPane = document.getElementById("quick-unlock-main-pane");
    const pickerPane = document.getElementById("quick-unlock-picker-pane");
    if (card) card.classList.remove("is-picker-mode");
    if (mainPane) mainPane.hidden = false;
    if (pickerPane) pickerPane.hidden = true;

    // Populate draft from current simulation state
    const state = this.store.getState();
    const sim = state.simulation || {};
    const teamDice = sim.team?.dice || [];
    const draftDice = [null, null, null, null, null];
    for (let i = 0; i < 5; i += 1) {
      draftDice[i] = teamDice[i] ? String(teamDice[i].id || teamDice[i]) : null;
    }

    // Support perk check
    let activeSupport = null;
    for (const perkId of SUPPORT_NODE_IDS) {
      if (getRank(sim, perkId) > 0) {
        activeSupport = perkId;
        break;
      }
    }

    // Rank overrides & excluded runes
    const rankOverrides = {};
    const excludedNodeIds = new Set();
    const ranksMap = sim.ranks instanceof Map
      ? sim.ranks
      : new Map(Object.entries(sim.ranks || {}));

    ranksMap.forEach((rank, id) => {
      if (Number(rank) > 1) rankOverrides[String(id)] = Number(rank);
    });

    this._quickUnlockDraft = {
      diceIds: draftDice,
      supportId: activeSupport,
      excludedNodeIds,
      rankOverrides
    };

    this._activePickerTarget = null;
    this._activeQuickSlotIndex = null;
    this._renderQuickUnlockSlots();
    this._renderQuickUnlockSupportSlot();

    modal.removeAttribute("hidden");
    modal.removeAttribute("inert");
    modal.setAttribute("aria-hidden", "false");
  }

  _closeQuickUnlockModal() {
    const modal = document.getElementById("simulation-quick-unlock-modal");
    if (modal) {
      const card = modal.querySelector(".quick-unlock-card");
      if (card) card.classList.remove("is-picker-mode");
      const mainPane = document.getElementById("quick-unlock-main-pane");
      const pickerPane = document.getElementById("quick-unlock-picker-pane");
      if (mainPane) mainPane.hidden = false;
      if (pickerPane) pickerPane.hidden = true;
      modal.setAttribute("hidden", "");
      modal.setAttribute("inert", "");
      modal.setAttribute("aria-hidden", "true");
    }
    this._closeQuickUnlockSliderPopovers();
    this._activePickerTarget = null;
    this._activeQuickSlotIndex = null;
  }

  _closeQuickUnlockSliderPopovers() {
    let closedAny = false;
    document.querySelectorAll(".quick-unlock-slider-popover").forEach((p) => {
      if (!p.hidden) {
        p.hidden = true;
        closedAny = true;
      }
    });
    return closedAny;
  }

  _createQuickUnlockDiceSlotBtn(i, diceNode) {
    const slotBtn = document.createElement("button");
    slotBtn.type = "button";
    slotBtn.className = `quick-unlock-main-slot ${diceNode ? "is-filled" : ""}`;
    slotBtn.dataset.slotIndex = String(i);
    if (diceNode) {
      const faction = FACTION_DATA[diceNode.faction || diceNode.branch] || FACTION_DATA[1];
      slotBtn.style.setProperty("--node-faction", faction.color);

      const img = document.createElement("img");
      img.className = "quick-unlock-slot-img";
      img.src = `icons/${resolveNode3Icon(diceNode) || "Dice_Fire3.png"}`;
      img.alt = diceNode.name_zh || diceNode.name;
      slotBtn.appendChild(img);

      const label = document.createElement("span");
      label.className = "quick-unlock-slot-name";
      label.textContent = (diceNode.name_zh || diceNode.name || "").replace(/骰子$/, "");
      slotBtn.appendChild(label);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "quick-unlock-slot-placeholder";
      placeholder.textContent = String(i + 1);
      slotBtn.appendChild(placeholder);

      const hint = document.createElement("span");
      hint.className = "quick-unlock-slot-hint";
      hint.textContent = this._t("simulation.position", { slot: i + 1 }, `位置 ${i + 1}`);
      slotBtn.appendChild(hint);
    }
    return slotBtn;
  }

  _createQuickUnlockRunePopover(rune, runeId, maxRank, currentRank, rankTag, card) {
    const popover = document.createElement("div");
    popover.className = "quick-unlock-slider-popover";
    popover.hidden = true;
    popover.innerHTML = `
      <div class="popover-header">
        <span class="popover-title">${rune.name_zh || rune.name || ""}</span>
        <span class="popover-rank-val">${currentRank}/${maxRank}</span>
      </div>
      <div class="popover-slider-wrap rank-slider-wrap">
        <input class="rank-slider-input" type="range" min="1" max="${maxRank}" value="${currentRank}" step="1" aria-label="Level slider" />
      </div>
    `;

    const popoverRankVal = popover.querySelector(".popover-rank-val");
    const sliderInput = popover.querySelector(".rank-slider-input");

    attachElasticSlider(sliderInput, {
      maxRank,
      onUpdate: (rank) => {
        this._quickUnlockDraft.rankOverrides[runeId] = rank;
        rankTag.textContent = `Lv.${rank}`;
        if (popoverRankVal) popoverRankVal.textContent = `${rank}/${maxRank}`;
        // 調級時若原本被排除，自動解除排除
        if (this._quickUnlockDraft.excludedNodeIds.has(runeId)) {
          this._quickUnlockDraft.excludedNodeIds.delete(runeId);
          card.classList.remove("is-excluded");
        }
      }
    });

    popover.addEventListener("click", (e) => e.stopPropagation());
    popover.addEventListener("pointerdown", (e) => e.stopPropagation());

    rankTag.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = Boolean(popover.hidden);
      document.querySelectorAll(".quick-unlock-slider-popover").forEach((p) => {
        p.hidden = true;
      });
      popover.hidden = !willOpen;
    });

    return popover;
  }

  _createQuickUnlockRuneCard(rune) {
    const runeId = String(rune.id);
    const isExcluded = this._quickUnlockDraft.excludedNodeIds.has(runeId);
    const maxRank = getMaxRank(rune);
    const currentRank = this._quickUnlockDraft.rankOverrides[runeId] || 1;

    const card = document.createElement("div");
    card.className = `quick-unlock-rune-card ${isExcluded ? "is-excluded" : ""}`;
    card.dataset.runeId = runeId;

    const icon = document.createElement("img");
    icon.className = "quick-unlock-rune-icon";
    icon.src = getNodeIconPath(rune);
    icon.alt = rune.name_zh || rune.name;
    card.appendChild(icon);

    const info = document.createElement("div");
    info.className = "quick-unlock-rune-info";

    const name = document.createElement("span");
    name.className = "quick-unlock-rune-name";
    name.textContent = rune.name_zh || rune.name || `#${runeId}`;
    info.appendChild(name);

    if (maxRank > 1) {
      const rankTag = document.createElement("button");
      rankTag.type = "button";
      rankTag.className = "quick-unlock-rune-rank-tag";
      rankTag.dataset.runeId = runeId;
      rankTag.dataset.maxRank = String(maxRank);
      rankTag.textContent = `Lv.${currentRank}`;
      info.appendChild(rankTag);

      const popover = this._createQuickUnlockRunePopover(rune, runeId, maxRank, currentRank, rankTag, card);
      card.appendChild(popover);
    }

    card.appendChild(info);
    return card;
  }

  _renderQuickUnlockDiceColumn(i, diceId, nodesMap) {
    const diceNode = diceId ? nodesMap.get(diceId) : null;
    const column = document.createElement("div");
    column.className = "quick-unlock-dice-column";

    const slotBtn = this._createQuickUnlockDiceSlotBtn(i, diceNode);
    column.appendChild(slotBtn);

    if (diceNode) {
      const runes = getRunesForDiceNode(diceNode, nodesMap);
      if (runes.length > 0) {
        const runesList = document.createElement("div");
        runesList.className = "quick-unlock-runes-list";
        for (const rune of runes) {
          runesList.appendChild(this._createQuickUnlockRuneCard(rune));
        }
        column.appendChild(runesList);
      }
    }

    return column;
  }

  _renderQuickUnlockSlots() {
    const container = document.getElementById("quick-unlock-dice-columns");
    if (!container) return;
    container.innerHTML = "";

    const nodesMap = this.store.getState().nodesMap;
    for (let i = 0; i < 5; i += 1) {
      const diceId = this._quickUnlockDraft.diceIds[i];
      const column = this._renderQuickUnlockDiceColumn(i, diceId, nodesMap);
      container.appendChild(column);
    }
  }

  _renderQuickUnlockSupportSlot() {
    const container = document.getElementById("quick-unlock-support-column");
    if (!container) return;
    container.innerHTML = "";

    const nodesMap = this.store.getState().nodesMap;
    const supportId = this._quickUnlockDraft.supportId;
    const supportNode = supportId ? nodesMap.get(supportId) : null;

    const slotBtn = document.createElement("button");
    slotBtn.type = "button";
    slotBtn.className = `quick-unlock-support-slot ${supportNode ? "is-filled" : ""}`;
    slotBtn.dataset.action = "pick-support";

    if (supportNode) {
      const img = document.createElement("img");
      img.className = "quick-unlock-slot-img";
      img.src = getNodeIconPath(supportNode);
      img.alt = supportNode.name_zh || supportNode.name;
      slotBtn.appendChild(img);

      const label = document.createElement("span");
      label.className = "quick-unlock-slot-name";
      label.textContent = supportNode.name_zh || supportNode.name || "支援夥伴";
      slotBtn.appendChild(label);
    } else {
      const add = document.createElement("span");
      add.className = "quick-unlock-slot-placeholder";
      add.textContent = "+";
      slotBtn.appendChild(add);

      const hint = document.createElement("span");
      hint.className = "quick-unlock-slot-hint";
      hint.textContent = this._t("simulation.supportPartner", {}, "支援夥伴");
      slotBtn.appendChild(hint);
    }
    container.appendChild(slotBtn);

    // Support rune node item below slot (if selected)
    if (supportNode) {
      const isExcluded = this._quickUnlockDraft.excludedNodeIds.has(String(supportNode.id));
      const card = document.createElement("div");
      card.className = `quick-unlock-rune-card ${isExcluded ? "is-excluded" : ""}`;
      card.dataset.runeId = String(supportNode.id);

      const icon = document.createElement("img");
      icon.className = "quick-unlock-rune-icon";
      icon.src = getNodeIconPath(supportNode);
      card.appendChild(icon);

      const info = document.createElement("div");
      info.className = "quick-unlock-rune-info";
      const name = document.createElement("span");
      name.className = "quick-unlock-rune-name";
      name.textContent = supportNode.name_zh || supportNode.name;
      info.appendChild(name);
      card.appendChild(info);

      container.appendChild(card);
    }
  }

  _switchToQuickUnlockPickerView() {
    this._closeQuickUnlockSliderPopovers();
    const modal = document.getElementById("simulation-quick-unlock-modal");
    const card = modal?.querySelector(".quick-unlock-card");
    const mainPane = document.getElementById("quick-unlock-main-pane");
    const pickerPane = document.getElementById("quick-unlock-picker-pane");
    if (!card || !mainPane || !pickerPane) return;

    this._activePickerTarget = "dice";
    this._draftDiceIds = this._quickUnlockDraft.diceIds.filter(Boolean).map(String);

    const title = document.getElementById("quick-unlock-picker-title");
    const count = document.getElementById("quick-unlock-picker-count");
    const saveBtn = document.getElementById("quick-unlock-picker-save");

    if (title) title.textContent = this._t("simulation.pickerTitle", {}, "選擇隊伍骰子");
    if (count) count.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `已選擇 ${this._draftDiceIds.length}/5`);
    if (saveBtn) {
      saveBtn.textContent = this._t("simulation.saveTeam", {}, "儲存隊伍");
      saveBtn.disabled = false;
    }

    const state = this.store.getState();
    const allDice = (state.treeData?.nodes || []).filter((n) => n.node_type === "DICE");
    this._renderQuickUnlockPickerGrid(allDice);

    card.classList.add("is-picker-mode");
    card.classList.remove("is-support-picker");
    mainPane.hidden = true;
    pickerPane.hidden = false;
  }

  _switchToQuickUnlockSupportPickerView() {
    this._closeQuickUnlockSliderPopovers();
    const modal = document.getElementById("simulation-quick-unlock-modal");
    const card = modal?.querySelector(".quick-unlock-card");
    const mainPane = document.getElementById("quick-unlock-main-pane");
    const pickerPane = document.getElementById("quick-unlock-picker-pane");
    if (!card || !mainPane || !pickerPane) return;

    this._activePickerTarget = "support";
    this._draftSupportId = this._quickUnlockDraft.supportId || null;

    const badge = document.getElementById("quick-unlock-picker-badge");
    const title = document.getElementById("quick-unlock-picker-title");
    const count = document.getElementById("quick-unlock-picker-count");
    const saveBtn = document.getElementById("quick-unlock-picker-save");

    if (badge) badge.textContent = "SUPPORT";
    if (title) title.textContent = this._t("simulation.pickSupportTitle", {}, "選擇支援夥伴");
    if (count) count.textContent = this._draftSupportId ? "已選擇 1/1" : "已選擇 0/1";
    if (saveBtn) {
      saveBtn.textContent = this._t("simulation.saveSupport", {}, "儲存夥伴");
      saveBtn.disabled = false;
    }

    this._renderQuickUnlockSupportPickerGrid();

    card.classList.add("is-picker-mode", "is-support-picker");
    mainPane.hidden = true;
    pickerPane.hidden = false;
  }

  _renderQuickUnlockSupportPickerGrid() {
    const grid = document.getElementById("quick-unlock-picker-grid");
    const countEl = document.getElementById("quick-unlock-picker-count");
    if (countEl) countEl.textContent = this._draftSupportId ? "已選擇 1/1" : "已選擇 0/1";
    if (!grid) return;
    grid.classList.add("is-support-grid");
    grid.innerHTML = "";

    const nodesMap = this.store.getState().nodesMap;
    SUPPORT_NODE_IDS.forEach((perkId, idx) => {
      const perkNode = nodesMap.get(perkId);
      if (!perkNode) return;

      const isSelected = this._draftSupportId === perkId;
      const item = document.createElement("button");
      item.type = "button";
      item.className = `compendium-compact-item simulation-picker-card ${isSelected ? "is-selected" : ""}`;
      item.dataset.supportId = perkId;
      item.style.animationDelay = `${idx * 30}ms`;

      const slot = document.createElement("div");
      slot.className = "compact-dice-slot";

      if (isSelected) {
        const badge = document.createElement("span");
        badge.className = "simulation-picker-card-badge";
        badge.textContent = "✓";
        slot.appendChild(badge);
      }

      const img = document.createElement("img");
      img.className = "compact-dice-img";
      img.src = getNodeIconPath(perkNode);
      img.alt = perkNode.name_zh || perkNode.name;
      img.loading = "lazy";
      slot.appendChild(img);

      const label = document.createElement("span");
      label.className = "compact-dice-label";
      label.textContent = perkNode.name_zh || perkNode.name || "";

      item.appendChild(slot);
      item.appendChild(label);
      grid.appendChild(item);
    });
  }

  _toggleQuickUnlockSupportSelection(supportId) {
    if (this._draftSupportId === supportId) {
      this._draftSupportId = null;
    } else {
      this._draftSupportId = supportId;
    }
    this._updateQuickUnlockSupportPickerState();
  }

  _updateQuickUnlockSupportPickerState() {
    const grid = document.getElementById("quick-unlock-picker-grid");
    const countEl = document.getElementById("quick-unlock-picker-count");
    if (countEl) countEl.textContent = this._draftSupportId ? "已選擇 1/1" : "已選擇 0/1";
    if (!grid) return;

    const cards = grid.querySelectorAll(".simulation-picker-card");
    for (const card of cards) {
      const id = card.dataset.supportId;
      const isSelected = this._draftSupportId === id;
      const slot = card.querySelector(".compact-dice-slot");

      card.classList.toggle("is-selected", isSelected);
      let badge = slot ? slot.querySelector(".simulation-picker-card-badge") : null;
      if (isSelected) {
        if (!badge && slot) {
          badge = document.createElement("span");
          badge.className = "simulation-picker-card-badge";
          badge.textContent = "✓";
          slot.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    }
  }

  _switchToQuickUnlockMainView() {
    const modal = document.getElementById("simulation-quick-unlock-modal");
    const card = modal?.querySelector(".quick-unlock-card");
    const mainPane = document.getElementById("quick-unlock-main-pane");
    const pickerPane = document.getElementById("quick-unlock-picker-pane");
    if (!card || !mainPane || !pickerPane) return;

    this._activePickerTarget = null;
    card.classList.remove("is-picker-mode", "is-support-picker");
    pickerPane.hidden = true;
    mainPane.hidden = false;

    this._renderQuickUnlockSlots();
    this._renderQuickUnlockSupportSlot();
  }

  _saveQuickUnlockPicker() {
    if (this._activePickerTarget === "support") {
      this._quickUnlockDraft.supportId = this._draftSupportId;
    } else {
      const newDice = [null, null, null, null, null];
      for (let i = 0; i < 5; i += 1) {
        newDice[i] = this._draftDiceIds[i] || null;
      }
      this._quickUnlockDraft.diceIds = newDice;
    }
    this._switchToQuickUnlockMainView();
  }

  _toggleQuickUnlockDiceSelection(diceId) {
    const index = this._draftDiceIds.indexOf(diceId);
    if (index !== -1) {
      this._draftDiceIds.splice(index, 1);
    } else {
      if (this._draftDiceIds.length >= 5) return;
      this._draftDiceIds.push(diceId);
    }
    this._updateQuickUnlockPickerGridState();
  }

  _updatePickerCardBadge(slot, isSelected, selectedIndex) {
    let badge = slot ? slot.querySelector(".simulation-picker-card-badge") : null;
    if (isSelected) {
      if (!badge && slot) {
        badge = document.createElement("span");
        badge.className = "simulation-picker-card-badge";
        slot.appendChild(badge);
      }
      if (badge) badge.textContent = String(selectedIndex + 1);
    } else if (badge) {
      badge.remove();
    }
  }

  _updateQuickUnlockPickerGridState() {
    const grid = document.getElementById("quick-unlock-picker-grid");
    const countEl = document.getElementById("quick-unlock-picker-count");
    const saveBtn = document.getElementById("quick-unlock-picker-save");

    if (countEl) countEl.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `已選擇 ${this._draftDiceIds.length}/5`);
    if (saveBtn) saveBtn.disabled = false;
    if (!grid) return;

    const isFull = this._draftDiceIds.length >= 5;
    const cards = grid.querySelectorAll(".simulation-picker-card");
    for (const card of cards) {
      const id = card.dataset.diceId;
      const selectedIndex = this._draftDiceIds.indexOf(id);
      const isSelected = selectedIndex !== -1;
      const slot = card.querySelector(".compact-dice-slot");

      card.classList.toggle("is-selected", isSelected);
      card.disabled = isFull && !isSelected;

      this._updatePickerCardBadge(slot, isSelected, selectedIndex);
    }
  }

  _renderQuickUnlockPickerGrid(allDice) {
    const grid = document.getElementById("quick-unlock-picker-grid");
    const countEl = document.getElementById("quick-unlock-picker-count");
    const saveBtn = document.getElementById("quick-unlock-picker-save");

    if (countEl) countEl.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `已選擇 ${this._draftDiceIds.length}/5`);
    if (saveBtn) saveBtn.disabled = false;

    if (!grid) return;
    grid.classList.remove("is-support-grid");
    grid.innerHTML = "";

    const factionOrder = new Set([1, 2, 3, 4, 5]);
    let cardIdx = 0;

    const renderCard = (node) => {
      const id = String(node.id);
      const selectedIndex = this._draftDiceIds.indexOf(id);
      const isSelected = selectedIndex !== -1;

      const item = document.createElement("button");
      item.type = "button";
      item.className = `compendium-compact-item simulation-picker-card ${isSelected ? "is-selected" : ""}`;
      item.dataset.diceId = id;
      item.dataset.pickerTarget = "quick-unlock";
      item.disabled = this._draftDiceIds.length >= 5 && !isSelected;
      item.style.animationDelay = `${Math.min(300, cardIdx * 20)}ms`;
      cardIdx += 1;

      const fData = FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1];
      if (typeof item.style?.setProperty === "function") item.style.setProperty("--node-faction", fData.color);

      const slot = document.createElement("div");
      slot.className = "compact-dice-slot";

      if (isSelected) {
        const badge = document.createElement("span");
        badge.className = "simulation-picker-card-badge";
        badge.textContent = String(selectedIndex + 1);
        slot.appendChild(badge);
      }

      const iconFilename = resolveNode3Icon(node) || "Dice_Fire3.png";
      const img = document.createElement("img");
      img.className = "compact-dice-img";
      img.src = `icons/${iconFilename}`;
      img.alt = node.name_zh || node.name;
      img.loading = "lazy";
      slot.appendChild(img);

      const label = document.createElement("span");
      label.className = "compact-dice-label";
      label.textContent = (node.name_zh || node.name || "").replace(/骰子$/, "");

      item.appendChild(slot);
      item.appendChild(label);
      grid.appendChild(item);
    };

    factionOrder.forEach((factionId) => {
      const factionDice = allDice.filter((n) => Number(n.faction || n.branch) === factionId);
      if (factionDice.length === 0) return;

      const fData = FACTION_DATA[factionId] || FACTION_DATA[1];
      const header = document.createElement("div");
      header.className = "simulation-picker-faction-header";
      if (typeof header.style?.setProperty === "function") {
        header.style.setProperty("--faction-color", fData.color);
      }
      const dot = document.createElement("span");
      dot.className = "faction-dot";
      const nameSpan = document.createElement("span");
      nameSpan.className = "faction-name";
      nameSpan.textContent = fData.name;
      header.appendChild(dot);
      header.appendChild(nameSpan);
      grid.appendChild(header);

      factionDice.forEach(renderCard);
    });

    const remainingDice = allDice.filter((n) => !factionOrder.has(Number(n.faction || n.branch)));
    if (remainingDice.length > 0) {
      remainingDice.forEach(renderCard);
    }
  }

  _handleQuickUnlockButtonClicks(target, id) {
    if (id === "quick-unlock-close-btn" || id === "quick-unlock-skip-btn") {
      this._closeQuickUnlockModal();
      return true;
    }
    if (id === "quick-unlock-confirm-btn") {
      this._applyQuickUnlock();
      return true;
    }
    if (id === "quick-unlock-picker-back-btn" || target.closest("#quick-unlock-picker-back-btn") || id === "quick-unlock-picker-cancel") {
      this._switchToQuickUnlockMainView();
      return true;
    }
    if (id === "quick-unlock-picker-save") {
      this._saveQuickUnlockPicker();
      return true;
    }
    return false;
  }

  _handleQuickUnlockPickerClicks(target) {
    const pickerDiceCard = target.closest("#quick-unlock-picker-grid .simulation-picker-card[data-dice-id]");
    if (pickerDiceCard) {
      const diceId = pickerDiceCard.dataset.diceId;
      if (diceId) this._toggleQuickUnlockDiceSelection(diceId);
      return true;
    }
    const pickerSupportCard = target.closest("#quick-unlock-picker-grid .simulation-picker-card[data-support-id]");
    if (pickerSupportCard) {
      const supportId = pickerSupportCard.dataset.supportId;
      if (supportId) this._toggleQuickUnlockSupportSelection(supportId);
      return true;
    }
    return false;
  }

  _handleQuickUnlockSlotClicks(target) {
    const mainSlot = target.closest(".quick-unlock-main-slot");
    if (mainSlot) {
      this._switchToQuickUnlockPickerView();
      return true;
    }
    if (target.closest(".quick-unlock-support-slot")) {
      this._switchToQuickUnlockSupportPickerView();
      return true;
    }
    return false;
  }

  _handleQuickUnlockRuneClicks(target) {
    if (target.closest(".quick-unlock-rune-rank-tag") || target.closest(".quick-unlock-slider-popover")) {
      return true;
    }
    const runeCard = target.closest(".quick-unlock-rune-card");
    if (runeCard) {
      const runeId = runeCard.dataset.runeId;
      if (runeId) {
        if (this._quickUnlockDraft.excludedNodeIds.has(runeId)) {
          this._quickUnlockDraft.excludedNodeIds.delete(runeId);
          runeCard.classList.remove("is-excluded");
        } else {
          this._quickUnlockDraft.excludedNodeIds.add(runeId);
          runeCard.classList.add("is-excluded");
          const popover = runeCard.querySelector(".quick-unlock-slider-popover");
          if (popover) popover.hidden = true;
        }
      }
      return true;
    }
    return false;
  }

  _handleQuickUnlockClicks(target, id) {
    if (this._handleQuickUnlockButtonClicks(target, id)) return true;
    if (this._handleQuickUnlockPickerClicks(target)) return true;
    if (this._handleQuickUnlockSlotClicks(target)) return true;
    if (this._handleQuickUnlockRuneClicks(target)) return true;

    // Dismiss popovers when clicking outside rune cards
    if (!target.closest(".quick-unlock-rune-card")) {
      document.querySelectorAll(".quick-unlock-slider-popover").forEach((p) => {
        p.hidden = true;
      });
    }

    return false;
  }

  async _applyQuickUnlock() {
    const state = this.store.getState();
    const sim = state.simulation || {};
    const spent = sim.spent || { gold: 0, core: 0 };
    const hasExistingAllocation = (spent.gold > 0 || spent.core > 0);

    if (hasExistingAllocation) {
      const confirmed = await this._showConfirmModal({
        title: this._t("simulation.overwriteTitle", {}, "覆蓋模擬配點"),
        message: this._t("simulation.overwriteConfirm", {}, "這將覆蓋現有的模擬配點，確定要繼續嗎？"),
        okText: this._t("common.confirm", {}, "確定"),
        cancelText: this._t("common.cancel", {}, "取消")
      });
      if (!confirmed) return;
    }

    const newState = calculateQuickUnlockState({
      diceIds: this._quickUnlockDraft.diceIds.filter(Boolean),
      supportId: this._quickUnlockDraft.supportId,
      excludedNodeIds: [...this._quickUnlockDraft.excludedNodeIds],
      rankOverrides: this._quickUnlockDraft.rankOverrides,
      nodesMap: state.nodesMap
    });

    this.store.dispatch({ type: ActionTypes.SET_SIMULATION_STATE, payload: newState });
    this._closeQuickUnlockModal();
    this._clearShareImageCaches();
    this._refreshShareUrl({ showLoading: true });
    this._renderTeamSlots(1);
    this._renderShareImagePreview();
  }

  /* -------------------------------------------------------------
   * Secondary Confirmation Dialog
   * ------------------------------------------------------------- */
  _showConfirmModal({ title, message, okText, cancelText } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById("simulation-confirm-modal");
      const titleEl = document.getElementById("confirm-modal-heading");
      const msgEl = document.getElementById("simulation-confirm-message");
      const okBtn = document.getElementById("simulation-confirm-ok-btn");
      const cancelBtn = document.getElementById("simulation-confirm-cancel-btn");

      if (titleEl) titleEl.textContent = title || "確認操作";
      if (msgEl) msgEl.textContent = message || "確定要執行此操作嗎？";
      if (okBtn) okBtn.textContent = okText || "確定";
      if (cancelBtn) cancelBtn.textContent = cancelText || "取消";

      this._confirmResolver = resolve;

      if (modal) {
        modal.removeAttribute("hidden");
        modal.removeAttribute("inert");
        modal.setAttribute("aria-hidden", "false");
      }
    });
  }

  _closeConfirmModal(result = false) {
    const modal = document.getElementById("simulation-confirm-modal");
    if (modal) {
      modal.setAttribute("hidden", "");
      modal.setAttribute("inert", "");
      modal.setAttribute("aria-hidden", "true");
    }
    if (this._confirmResolver) {
      this._confirmResolver(result);
      this._confirmResolver = null;
    }
  }

  _handleConfirmModalClicks(target, id) {
    if (id === "simulation-confirm-ok-btn") {
      this._closeConfirmModal(true);
      return true;
    }
    if (id === "simulation-confirm-cancel-btn") {
      this._closeConfirmModal(false);
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------
   * Save Slots Modal
   * ------------------------------------------------------------- */
  _openSaveModal() {
    const modal = document.getElementById("simulation-save-modal");
    if (!modal) return;
    this._renderSaveSlotsList();
    modal.removeAttribute("hidden");
    modal.removeAttribute("inert");
    modal.setAttribute("aria-hidden", "false");
  }

  _closeSaveModal() {
    const modal = document.getElementById("simulation-save-modal");
    if (modal) {
      modal.setAttribute("hidden", "");
      modal.setAttribute("inert", "");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  _renderSaveSlotsList() {
    const container = document.getElementById("simulation-save-slots-list");
    if (!container) return;
    container.innerHTML = "";

    const slots = listSimulationSlots(this.storagePort);

    slots.forEach((slot, index) => {
      const slotId = index + 1;
      const row = document.createElement("div");
      row.className = "simulation-save-slot-row";

      const idxBadge = document.createElement("div");
      idxBadge.className = "simulation-save-slot-idx";
      idxBadge.textContent = String(slotId);
      row.appendChild(idxBadge);

      const info = document.createElement("div");
      info.className = "simulation-save-slot-info";

      if (slot) {
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "simulation-save-name-input";
        nameInput.maxLength = 10;
        nameInput.value = slot.name || `配點方案 ${slotId}`;
        nameInput.addEventListener("change", (e) => {
          const clean = sanitizeSlotName(e.target.value, `配點方案 ${slotId}`);
          nameInput.value = clean;
          saveSimulationSlot(this.storagePort, slotId, {
            name: clean,
            simulation: slot
          });
        });
        info.appendChild(nameInput);

        const meta = document.createElement("div");
        meta.className = "simulation-save-meta-text";
        const dateStr = slot.updatedAt ? new Date(slot.updatedAt).toLocaleDateString() : "";
        const spent = slot.spent || {};
        meta.textContent = `${dateStr} · 金幣: ${formatNumber(spent.gold, this.localization)} · 核心: ${formatNumber(spent.core, this.localization)}`;
        info.appendChild(meta);
      } else {
        const emptyLabel = document.createElement("span");
        emptyLabel.className = "simulation-save-meta-text";
        emptyLabel.textContent = "未使用的存檔槽位";
        info.appendChild(emptyLabel);
      }
      row.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "simulation-save-row-actions";

      if (slot) {
        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "simulation-slot-btn is-load";
        loadBtn.textContent = "讀取";
        loadBtn.dataset.slotAction = "load";
        loadBtn.dataset.slotId = String(slotId);
        actions.appendChild(loadBtn);

        const overwriteBtn = document.createElement("button");
        overwriteBtn.type = "button";
        overwriteBtn.className = "simulation-slot-btn is-save";
        overwriteBtn.textContent = "覆蓋";
        overwriteBtn.dataset.slotAction = "overwrite";
        overwriteBtn.dataset.slotId = String(slotId);
        actions.appendChild(overwriteBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "simulation-slot-btn is-delete";
        deleteBtn.textContent = "刪除";
        deleteBtn.dataset.slotAction = "delete";
        deleteBtn.dataset.slotId = String(slotId);
        actions.appendChild(deleteBtn);
      } else {
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "simulation-slot-btn is-save";
        saveBtn.textContent = "儲存至此";
        saveBtn.dataset.slotAction = "save-new";
        saveBtn.dataset.slotId = String(slotId);
        actions.appendChild(saveBtn);
      }

      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  _handleSaveModalClicks(target, id) {
    if (id === "simulation-save-close-btn") {
      this._closeSaveModal();
      return true;
    }

    const slotBtn = target.closest(".simulation-slot-btn");
    if (slotBtn) {
      const action = slotBtn.dataset.slotAction;
      const slotId = Number(slotBtn.dataset.slotId);

      if (action === "load") {
        this._showConfirmModal({
          title: "讀取存檔",
          message: "確定要讀取此配點方案嗎？現有模擬配點將被覆蓋。",
          okText: "確定",
          cancelText: "取消"
        }).then((ok) => {
          if (!ok) return;
          const loaded = loadSimulationSlot(this.storagePort, slotId);
          if (loaded) {
            const nodesMap = this.store.getState().nodesMap;
            const filledDice = (loaded.teamDiceIds || []).map((id) => nodesMap.get(id)).filter(Boolean);
            const newState = {
              active: true,
              spent: loaded.spent || { gold: 0, core: 0, solar: 0 },
              ranks: new Map(Object.entries(loaded.ranks || {})),
              team: { dice: filledDice, commonNodes: [] }
            };
            this.store.dispatch({ type: ActionTypes.SET_SIMULATION_STATE, payload: newState });
            this._closeSaveModal();
            this._clearShareImageCaches();
            this._refreshShareUrl({ showLoading: true });
            this._renderTeamSlots(1);
            this._renderShareImagePreview();
          }
        });
        return true;
      }

      if (action === "overwrite") {
        this._showConfirmModal({
          title: "覆蓋存檔",
          message: "確定要將目前配點覆蓋至此槽位嗎？",
          okText: "確定",
          cancelText: "取消"
        }).then((ok) => {
          if (!ok) return;
          const current = loadSimulationSlot(this.storagePort, slotId);
          saveSimulationSlot(this.storagePort, slotId, {
            name: current?.name || `配點方案 ${slotId}`,
            simulation: this.store.getState().simulation
          });
          this._renderSaveSlotsList();
        });
        return true;
      }

      if (action === "delete") {
        this._showConfirmModal({
          title: "刪除存檔",
          message: "確定要刪除此槽位的存檔嗎？刪除後無法復原。",
          okText: "刪除",
          cancelText: "取消"
        }).then((ok) => {
          if (!ok) return;
          deleteSimulationSlot(this.storagePort, slotId);
          this._renderSaveSlotsList();
        });
        return true;
      }

      if (action === "save-new") {
        saveSimulationSlot(this.storagePort, slotId, {
          name: `配點方案 ${slotId}`,
          simulation: this.store.getState().simulation
        });
        this._renderSaveSlotsList();
        return true;
      }
    }

    return false;
  }

  /* -------------------------------------------------------------
   * Share Widget & View Modes
   * ------------------------------------------------------------- */
  _toggleShareWidget(opener = null) {
    const widget = document.getElementById("simulation-share-widget");
    if (!widget) return;
    if (widget.classList.contains("is-expanded")) {
      this._closeShareWidget();
    } else {
      this._openShareWidget(opener);
    }
  }

  _openShareWidget(opener = null) {
    const widget = document.getElementById("simulation-share-widget");
    const triggerBtn = document.getElementById("simulation-share-trigger-btn");
    const card = document.getElementById("simulation-share-card");
    if (!widget) return;

    this._closeExitWidget();
    this.store?.dispatch?.({ type: "SELECT_NODE", payload: { nodeId: null } });
    widget.classList.add("is-expanded");
    if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "true");
    if (card) card.setAttribute("aria-hidden", "false");

    const namesWrap = document.getElementById("simulation-share-names-wrap");
    if (namesWrap) namesWrap.hidden = this._shareMode === "details";
    const splitWrap = document.getElementById("simulation-share-split-wrap");
    if (splitWrap) splitWrap.hidden = this._shareMode === "details";
    const titleWrap = document.getElementById("simulation-share-title-wrap");
    if (titleWrap) titleWrap.hidden = this._shareMode !== "details";

    this._refreshShareUrl({ showLoading: true });
    this._setShareActionLabel("simulation-copy-share-btn", this._t("simulation.copy", {}, "Copy"));
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.download", {}, "Download image"));

    this._renderTeamSlots(1);
    this._renderShareImagePreview();
  }

  _closeShareWidget({ restoreFocus = false } = {}) {
    const widget = document.getElementById("simulation-share-widget");
    const triggerBtn = document.getElementById("simulation-share-trigger-btn");
    const card = document.getElementById("simulation-share-card");
    const mainPane = document.getElementById("simulation-share-main-pane");
    const pickerPane = document.getElementById("simulation-picker-pane");
    if (!widget?.classList.contains("is-expanded")) return;

    widget.classList.remove("is-expanded", "is-picker-mode");
    if (pickerPane) pickerPane.hidden = true;
    if (mainPane) mainPane.hidden = false;
    if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "false");
    if (card) card.setAttribute("aria-hidden", "true");
    if (restoreFocus && triggerBtn && !triggerBtn.closest("[hidden]")) triggerBtn.focus?.();
  }

  _updateShareModeUI(isDetails) {
    document.getElementById("simulation-share-mode-tree-btn")?.classList.toggle("is-active", !isDetails);
    document.getElementById("simulation-share-mode-details-btn")?.classList.toggle("is-active", isDetails);

    const setHidden = (id, hidden) => {
      const el = document.getElementById(id);
      if (el) el.hidden = hidden;
    };

    setHidden("simulation-share-names-wrap", isDetails);
    setHidden("simulation-share-team-wrap", isDetails);
    setHidden("simulation-share-split-wrap", isDetails);
    setHidden("simulation-share-title-wrap", !isDetails);
    setHidden("simulation-details-settings-btn", true);
  }

  _switchShareMode(mode) {
    if (this._shareMode === mode) return;
    this._shareMode = mode;
    this._updateShareModeUI(mode === "details");
    this._renderShareImagePreview();
  }

  _createTeamSlot(teamNum, slotIndex, entry, nodesMap) {
    const rawNode = entry ? nodesMap?.get(String(entry.id || entry)) : null;
    const rank = rawNode ? getRank(this.store.getState()?.simulation, rawNode.id) : 0;
    const node = rank > 0 ? rawNode : null;
    const slotBtn = document.createElement("button");
    slotBtn.type = "button";
    slotBtn.className = `simulation-team-dice-card ${node ? "is-filled" : "is-empty"}`;
    slotBtn.dataset.teamIndex = "0";
    slotBtn.dataset.slotIndex = String(slotIndex);
    const nodeName = node ? (node.name_zh || node.name) : "";
    slotBtn.setAttribute("aria-label", node
      ? this._t("simulation.slotEdit", { team: teamNum, name: nodeName }, `Team: ${nodeName}; click to edit`)
      : this._t("simulation.slotEmpty", { team: teamNum, slot: slotIndex + 1 }, `Empty slot ${slotIndex + 1}; click to edit`));
    const faction = node ? (FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1]) : null;
    if (faction && typeof slotBtn.style?.setProperty === "function") slotBtn.style.setProperty("--node-faction", faction.color);

    const slot = document.createElement("div");
    slot.className = "compact-dice-slot simulation-team-compact-slot";
    if (node) {
      const img = document.createElement("img");
      img.className = "compact-dice-img";
      img.src = `icons/${resolveNode3Icon(node) || "Dice_Fire3.png"}`;
      img.alt = node.name_zh || node.name || this._t("simulation.diceFallback", {}, "Dice");
      img.loading = "lazy";
      slot.appendChild(img);
    } else {
      const emptyNum = document.createElement("span");
      emptyNum.className = "simulation-team-slot-empty-num";
      emptyNum.textContent = String(slotIndex + 1);
      slot.appendChild(emptyNum);
    }
    const label = document.createElement("span");
    label.className = "compact-dice-label simulation-team-compact-label";
    label.textContent = node
      ? (node.name_zh || node.name || "").replace(/骰子$/, "")
      : this._t("simulation.position", { slot: slotIndex + 1 }, `Slot ${slotIndex + 1}`);
    slotBtn.appendChild(slot);
    slotBtn.appendChild(label);
    return slotBtn;
  }

  _renderTeamSlots(teamNum = 1) {
    const state = this.store.getState();
    const nodesMap = state.nodesMap;
    const rawDice = state.simulation?.team?.dice || [];
    const teamDice = rawDice.slice(0, 5);
    const container = document.getElementById("simulation-team-slots-1");

    if (!container) return;
    container.innerHTML = "";

    for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
      container.appendChild(this._createTeamSlot(teamNum, slotIndex, teamDice[slotIndex], nodesMap));
    }
  }

  _buildSinglePreviewItemHtml(url, alt) {
    return `
      <div class="simulation-split-item-wrap is-single">
        <img id="simulation-share-image-preview" class="simulation-share-image-preview" src="${url}" alt="${alt}" />
        <div class="simulation-split-overlay-actions">
          <button type="button" class="simulation-split-tool-btn is-copy" data-part-index="0" title="複製此張圖片">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button type="button" class="simulation-split-tool-btn is-download" data-part-index="0" title="下載">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>
      </div>
    `;
  }

  _buildSplitGridHtml(images, modeClass) {
    let html = `<div class="simulation-split-grid ${modeClass}">`;
    images.forEach((part, idx) => {
      const url = part.dataUrl || (part.blob ? URL.createObjectURL(part.blob) : "");
      const idAttr = idx === 0 ? 'id="simulation-share-image-preview"' : '';
      html += `
        <div class="simulation-split-item-wrap">
          <img ${idAttr} class="simulation-split-item-img" src="${url}" alt="分割圖 ${idx + 1}" />
          <div class="simulation-split-overlay-actions">
            <button type="button" class="simulation-split-tool-btn is-copy" data-part-index="${idx}" title="複製此張圖片">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button type="button" class="simulation-split-tool-btn is-download" data-part-index="${idx}" title="下載">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>
        </div>
      `;
    });
    html += `</div>`;
    return html;
  }

  _showPreviewError(loading) {
    if (loading) {
      loading.hidden = false;
      loading.textContent = this._t("simulation.imageError", {}, "Image generation failed");
    }
  }

  _updateSplitPreviewContainer(splitResult, previewContainer, downloadAllBtn) {
    if (splitResult.images.length > 1) {
      if (downloadAllBtn) downloadAllBtn.hidden = false;
      const modeClass = splitResult.layout?.mode === "split-quad" ? "is-quad" : "is-horizontal";
      previewContainer.innerHTML = this._buildSplitGridHtml(splitResult.images, modeClass);
      return;
    }
    if (downloadAllBtn) downloadAllBtn.hidden = true;
    const singleUrl = splitResult.images[0]?.dataUrl || (splitResult.images[0]?.blob ? URL.createObjectURL(splitResult.images[0]?.blob) : "");
    previewContainer.innerHTML = this._buildSinglePreviewItemHtml(singleUrl, "模擬配點圖片預覽");
  }

  async _renderDetailsPreview(generation, loading, previewContainer, downloadAllBtn) {
    if (downloadAllBtn) downloadAllBtn.hidden = true;
    const locale = this._currentLocale || this.localization?.getLocale?.() || "zh-tw";
    const result = await this.simulationUseCase.generateDetailsCardImage({
      title: this._shareDetailsTitle,
      scale: 2,
      locale
    });
    if (this._shareRenderGeneration !== generation) return;
    if (loading) loading.hidden = true;
    if (!result.ok) {
      this._showPreviewError(loading);
      return;
    }
    this._cachedDetailsResult = result;
    const detailsUrl = result.dataUrl || (result.blob ? URL.createObjectURL(result.blob) : "");
    previewContainer.innerHTML = this._buildSinglePreviewItemHtml(detailsUrl, "模擬配點詳情預覽");
  }

  async _renderSplitTreePreview(generation, loading, previewContainer, downloadAllBtn) {
    const locale = this._currentLocale || this.localization?.getLocale?.() || "zh-tw";
    const splitResult = await this.simulationUseCase.generateSplitShareImages({
      showNames: this._shareShowNames,
      showTeam: this._shareShowTeam,
      splitMode: this._shareSplitMode,
      scale: 2,
      locale
    });
    if (this._shareRenderGeneration !== generation) return;
    if (loading) loading.hidden = true;
    if (!splitResult.ok) {
      this._showPreviewError(loading);
      return;
    }

    this._cachedSplitResult = splitResult;
    this._updateSplitPreviewContainer(splitResult, previewContainer, downloadAllBtn);
    if (loading) loading.hidden = true;
  }

  async _renderSingleTreePreview(generation, loading, previewContainer, downloadAllBtn) {
    if (downloadAllBtn) downloadAllBtn.hidden = true;
    const locale = this._currentLocale || this.localization?.getLocale?.() || this.store?.getState?.()?.locale || "zh-tw";
    const result = await this.simulationUseCase.generateShareImage({
      showNames: this._shareShowNames,
      showTeam: this._shareShowTeam,
      scale: 2,
      locale
    });
    if (this._shareRenderGeneration !== generation) return;
    if (!result.ok) {
      this._showPreviewError(loading);
      return;
    }
    this._shareImageCache = { result };
    const singleTreeUrl = result.dataUrl || (result.blob ? URL.createObjectURL(result.blob) : "");
    previewContainer.innerHTML = this._buildSinglePreviewItemHtml(singleTreeUrl, "模擬配點圖片預覽");
    if (loading) loading.hidden = true;
  }

  async _renderShareImagePreview() {
    const generation = (this._shareRenderGeneration || 0) + 1;
    this._shareRenderGeneration = generation;

    const loading = document.getElementById("simulation-image-loading");
    const previewContainer = document.getElementById("simulation-share-preview-container");
    const downloadAllBtn = document.getElementById("simulation-image-download-all-btn");

    if (loading) {
      loading.hidden = false;
      loading.textContent = this._t("simulation.imageLoading", {}, "正在生成圖片…");
    }
    if (!previewContainer) return;
    previewContainer.innerHTML = "";

    try {
      if (this._shareMode === "details") {
        await this._renderDetailsPreview(generation, loading, previewContainer, downloadAllBtn);
      } else if (this._shareSplitEnabled) {
        await this._renderSplitTreePreview(generation, loading, previewContainer, downloadAllBtn);
      } else {
        await this._renderSingleTreePreview(generation, loading, previewContainer, downloadAllBtn);
      }
    } catch (err) {
      // 圖片生成失敗或被後續渲染覆蓋，記錄錯誤並向使用者提示失敗
      console.error?.("[SimulationView] Share image rendering failed:", err);
      if (this._shareRenderGeneration !== generation) return;
      if (loading) {
        loading.hidden = false;
        loading.textContent = this._t("simulation.imageError", {}, "Image generation failed");
      }
    }
  }

  _closeDownloadPopovers() {
    if (typeof document === "undefined") return;
    const popovers = document.querySelectorAll(".simulation-download-popover");
    popovers.forEach((p) => p.remove());
  }

  _toggleDownloadPopover(btn, partIndex = 0) {
    if (typeof document === "undefined") return;
    const parent = btn.closest(".simulation-split-overlay-actions") || btn.parentElement;
    if (!parent) return;
    const existing = parent.querySelector(".simulation-download-popover");
    if (existing) {
      existing.remove();
      return;
    }
    this._closeDownloadPopovers();

    const isSplitMulti = Boolean(this._shareSplitEnabled && this._shareMode === "tree" && (this._cachedSplitResult?.images?.length > 1));
    const popover = document.createElement("div");
    popover.className = "simulation-download-popover";
    popover.setAttribute("role", "menu");

    let itemsHtml = `
      <button type="button" class="simulation-download-popover-item is-popover-download-single" data-part-index="${partIndex}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>下載此張圖片</span>
      </button>
    `;

    if (isSplitMulti) {
      itemsHtml += `
        <button type="button" class="simulation-download-popover-item is-popover-download-all">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>下載全部圖片</span>
        </button>
      `;
    }

    itemsHtml += `
      <button type="button" class="simulation-download-popover-item is-popover-copy" data-part-index="${partIndex}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        <span>複製此張圖片</span>
      </button>
    `;

    popover.innerHTML = itemsHtml;
    parent.appendChild(popover);
  }

  async _copySplitPartImage(idx, btn) {
    let blob = null;
    if (this._shareMode === "details") {
      blob = this._cachedDetailsResult?.blob;
    } else if (this._shareSplitEnabled && this._cachedSplitResult?.images?.[idx]) {
      blob = this._cachedSplitResult.images[idx].blob;
    } else {
      blob = this._shareImageCache?.result?.blob;
    }
    if (!blob) return;
    try {
      if (navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
        if (btn) btn.classList.add("is-copied");
        setTimeout(() => { if (btn) btn.classList.remove("is-copied"); }, 1200);
      }
    } catch {
      // Fallback
    }
  }

  _downloadSplitPartImage(idx) {
    const part = this._cachedSplitResult?.images?.[idx];
    if (!part) return;
    const blob = part.blob || dataUrlToBlob(part.dataUrl);
    const href = blob ? URL.createObjectURL(blob) : (part.dataUrl || "");
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.download = `random-dice-2-lab-part-${idx + 1}.png`;
    link.addEventListener("click", (e) => e.stopPropagation());
    if (typeof document !== "undefined" && document.body) {
      document.body.appendChild(link);
    }
    link.click();
    if (typeof link.remove === "function") link.remove();
    if (blob) setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  _downloadAllSplitImages() {
    const images = this._cachedSplitResult?.images || [];
    images.forEach((part, idx) => {
      setTimeout(() => this._downloadSplitPartImage(idx), idx * 200);
    });
  }

  async _downloadShareImage() {
    const button = document.getElementById("simulation-image-share-btn");
    if (button) button.disabled = true;
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageGenerating", {}, "Generating…"));

    if (this._shareMode === "details") {
      const res = this._cachedDetailsResult || await this.simulationUseCase.generateDetailsCardImage({
        title: this._shareDetailsTitle,
        scale: 2
      });
      if (res?.ok) {
        this._downloadImageHref(res, "random-dice-2-lab-details.png");
      }
      if (button) button.disabled = false;
      this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageDownloaded", {}, "Downloaded"));
      return;
    }

    const locale = this._currentLocale || this.localization?.getLocale?.() || this.store?.getState?.()?.locale || "zh-tw";
    const result = await this.simulationUseCase.generateShareImage({
      showNames: this._shareShowNames,
      showTeam: this._shareShowTeam,
      scale: 2,
      locale
    });

    if (!result?.ok) {
      if (button) button.disabled = false;
      this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageError", {}, "Image generation failed"));
      return;
    }

    this._downloadImageHref(result);
    if (button) button.disabled = false;
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageDownloaded", {}, "Downloaded"));
  }

  _downloadImageHref(result, filename = "random-dice-2-lab-planning.png") {
    const blob = result?.blob || dataUrlToBlob(result?.dataUrl);
    const href = blob ? URL.createObjectURL(blob) : (result?.dataUrl || "");
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.addEventListener("click", (e) => e.stopPropagation());
    if (typeof document !== "undefined" && document.body) {
      document.body.appendChild(link);
    }
    link.click();
    if (typeof link.remove === "function") link.remove();
    if (blob) setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  /* -------------------------------------------------------------
   * Dice Picker Drawer (Inside Share Widget)
   * ------------------------------------------------------------- */
  _switchToPickerView(teamIndex, opener = null) {
    const state = this.store.getState();
    const nodes = state.treeData?.nodes || [];
    const unlockedDice = nodes.filter((n) => n.node_type === "DICE" && getRank(state.simulation, n.id) > 0);

    if (unlockedDice.length === 0) return;

    this._pickerReturnTeamIndex = 0;
    const currentTeamDice = (state.simulation?.team?.dice || []).slice(0, 5);
    this._draftDiceIds = currentTeamDice
      .map((d) => String(d?.id || d))
      .filter((id) => unlockedDice.some((n) => String(n.id) === id));

    const title = document.getElementById("simulation-picker-title");
    if (title) title.textContent = this._t("simulation.pickerTitle", {}, "Choose team dice");

    this._renderDicePickerGrid(unlockedDice);

    const widget = document.getElementById("simulation-share-widget");
    const mainPane = document.getElementById("simulation-share-main-pane");
    const pickerPane = document.getElementById("simulation-picker-pane");

    if (widget) widget.classList.add("is-picker-mode");
    if (mainPane) mainPane.hidden = true;
    if (pickerPane) pickerPane.hidden = false;
  }

  _switchToShareView({ restoreFocus = false } = {}) {
    const widget = document.getElementById("simulation-share-widget");
    const mainPane = document.getElementById("simulation-share-main-pane");
    const pickerPane = document.getElementById("simulation-picker-pane");

    if (widget) widget.classList.remove("is-picker-mode");
    if (pickerPane) pickerPane.hidden = true;
    if (mainPane) mainPane.hidden = false;

    this._refreshShareUrl({ showLoading: true });
    this._renderTeamSlots(1);
    this._renderShareImagePreview();

    if (restoreFocus) {
      queueMicrotask(() => {
        document.querySelector("#simulation-team-slots-1 .simulation-team-dice-card")?.focus?.();
      });
    }
  }

  _renderDicePickerGrid(unlockedDice) {
    const grid = document.getElementById("simulation-picker-grid");
    const countEl = document.getElementById("simulation-picker-count");
    const saveBtn = document.getElementById("simulation-picker-save");

    if (countEl) countEl.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `Selected ${this._draftDiceIds.length}/5`);
    if (saveBtn) saveBtn.disabled = false;

    if (!grid) return;
    grid.innerHTML = "";

    const factionOrder = new Set([1, 2, 3, 4, 5]);
    let cardIdx = 0;

    const renderCard = (node) => {
      const id = String(node.id);
      const selectedIndex = this._draftDiceIds.indexOf(id);
      const isSelected = selectedIndex !== -1;

      const item = document.createElement("button");
      item.type = "button";
      item.className = `compendium-compact-item simulation-picker-card ${isSelected ? "is-selected" : ""}`;
      item.dataset.diceId = id;
      item.disabled = this._draftDiceIds.length >= 5 && !isSelected;
      item.style.animationDelay = `${Math.min(300, cardIdx * 20)}ms`;
      cardIdx += 1;

      const fData = FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1];
      if (typeof item.style?.setProperty === "function") item.style.setProperty("--node-faction", fData.color);

      const slot = document.createElement("div");
      slot.className = "compact-dice-slot";

      if (isSelected) {
        const badge = document.createElement("span");
        badge.className = "simulation-picker-card-badge";
        badge.textContent = String(selectedIndex + 1);
        slot.appendChild(badge);
      }

      const iconFilename = resolveNode3Icon(node) || "Dice_Fire3.png";
      const img = document.createElement("img");
      img.className = "compact-dice-img";
      img.src = `icons/${iconFilename}`;
      img.alt = node.name_zh || node.name;
      img.loading = "lazy";
      slot.appendChild(img);

      const label = document.createElement("span");
      label.className = "compact-dice-label";
      label.textContent = (node.name_zh || node.name || "").replace(/骰子$/, "");

      item.appendChild(slot);
      item.appendChild(label);
      grid.appendChild(item);
    };

    factionOrder.forEach((factionId) => {
      const factionDice = unlockedDice.filter((n) => Number(n.faction || n.branch) === factionId);
      if (factionDice.length === 0) return;

      const fData = FACTION_DATA[factionId] || FACTION_DATA[1];
      const header = document.createElement("div");
      header.className = "simulation-picker-faction-header";
      if (typeof header.style?.setProperty === "function") {
        header.style.setProperty("--faction-color", fData.color);
      }
      const dot = document.createElement("span");
      dot.className = "faction-dot";
      const nameSpan = document.createElement("span");
      nameSpan.className = "faction-name";
      nameSpan.textContent = fData.name;
      header.appendChild(dot);
      header.appendChild(nameSpan);
      grid.appendChild(header);

      factionDice.forEach(renderCard);
    });

    const remainingDice = unlockedDice.filter((n) => !factionOrder.has(Number(n.faction || n.branch)));
    if (remainingDice.length > 0) {
      remainingDice.forEach(renderCard);
    }
  }

  _toggleDicePickerSelection(diceId) {
    const index = this._draftDiceIds.indexOf(diceId);
    if (index !== -1) {
      this._draftDiceIds.splice(index, 1);
    } else {
      if (this._draftDiceIds.length >= 5) return;
      this._draftDiceIds.push(diceId);
    }
    this._updateDicePickerGridState();
  }

  _updateDicePickerGridState() {
    const grid = document.getElementById("simulation-picker-grid");
    const countEl = document.getElementById("simulation-picker-count");
    const saveBtn = document.getElementById("simulation-picker-save");

    if (countEl) countEl.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `Selected ${this._draftDiceIds.length}/5`);
    if (saveBtn) saveBtn.disabled = false;
    if (!grid) return;

    const isFull = this._draftDiceIds.length >= 5;
    const cards = grid.querySelectorAll(".simulation-picker-card");
    for (const card of cards) {
      const id = card.dataset.diceId;
      const selectedIndex = this._draftDiceIds.indexOf(id);
      const isSelected = selectedIndex !== -1;
      const slot = card.querySelector(".compact-dice-slot");

      card.classList.toggle("is-selected", isSelected);
      card.disabled = isFull && !isSelected;

      this._updatePickerCardBadge(slot, isSelected, selectedIndex);
    }
  }

  _saveDicePicker() {
    const state = this.store.getState();
    const nodesMap = state.nodesMap;
    const newTeamEntries = this._draftDiceIds.map((id) => nodesMap.get(id)).filter(Boolean);

    const newTeam = {
      ...state.simulation.team,
      dice: newTeamEntries
    };

    this.simulationUseCase.setTeam(newTeam);
  }

  /* -------------------------------------------------------------
   * URL Sharing
   * ------------------------------------------------------------- */
  _getSerializedShare(locale = null) {
    const currentLocale = locale || this._currentLocale || this.localization?.getLocale?.() || this.store?.getState?.()?.locale || "zh-tw";
    return this.simulationUseCase.serialize({
      origin: typeof window !== "undefined" ? window.location.origin : "",
      locale: currentLocale
    });
  }

  _refreshShareUrl({ showLoading = false } = {}) {
    const input = document.getElementById("simulation-share-url");
    const currentLocale = this._currentLocale || this.localization?.getLocale?.() || this.store?.getState?.()?.locale || "zh-tw";
    const serialized = this._getSerializedShare(currentLocale);
    const key = `${currentLocale}:${serialized.encoded}`;
    const cached = this._shareUrlCache.get(key);
    if (cached) {
      if (input) input.value = cached.url;
      return Promise.resolve(cached);
    }
    if (this._shareUrlPromise?.key === key) return this._shareUrlPromise.promise;
    if (showLoading && input) input.value = this._t("simulation.urlLoading", {}, "Creating short link…");

    const promise = this.simulationUseCase.createShareLink({
      serialized,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      locale: currentLocale
    }).catch(() => serialized).then((result) => {
      this._shareUrlCache.set(key, result);
      const current = this._getSerializedShare(currentLocale);
      if (input && current.encoded === serialized.encoded) input.value = result.url;
      if (current.encoded === serialized.encoded) this.onShareUrl?.(result.url);
      return result;
    }).finally(() => {
      if (this._shareUrlPromise?.key === key) this._shareUrlPromise = null;
    });
    this._shareUrlPromise = { key, promise };
    return promise;
  }

  async _copyShareUrl() {
    const input = document.getElementById("simulation-share-url");
    if (input?.value === this._t("simulation.urlLoading", {}, "Creating short link…")) await this._refreshShareUrl();
    const value = input?.value || "";
    try {
      if (!navigator.clipboard?.writeText) {
        input?.focus?.();
        input?.select?.();
        this._setShareActionLabel("simulation-copy-share-btn", this._t("simulation.copyManual", {}, "Copy manually"));
        return;
      }
      await navigator.clipboard.writeText(value);
      this._setShareActionLabel("simulation-copy-share-btn", this._t("simulation.copySuccess", {}, "Copied"));
    } catch {
      input?.focus?.();
      input?.select?.();
      this._setShareActionLabel("simulation-copy-share-btn", this._t("simulation.copyManual", {}, "Copy manually"));
    }
  }

  /* -------------------------------------------------------------
   * Exit Toolbar & Center Button
   * ------------------------------------------------------------- */
  _toggleExitWidget() {
    const widget = document.getElementById("simulation-exit-widget");
    if (!widget) return;
    if (widget.classList.contains("is-expanded")) {
      this._closeExitWidget();
    } else {
      this._openExitWidget();
    }
  }

  _openExitWidget() {
    const widget = document.getElementById("simulation-exit-widget");
    const toggle = document.getElementById("simulation-toggle-btn");
    const card = document.getElementById("simulation-exit-card");
    if (!widget) return;

    this._closeShareWidget();
    widget.classList.add("is-expanded");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    if (card) card.setAttribute("aria-hidden", "false");

    queueMicrotask(() => {
      document.getElementById("simulation-quick-unlock-trigger-btn")?.focus?.();
    });
  }

  _closeExitWidget({ restoreFocus = false } = {}) {
    const widget = document.getElementById("simulation-exit-widget");
    const toggle = document.getElementById("simulation-toggle-btn");
    const card = document.getElementById("simulation-exit-card");
    if (widget) widget.classList.remove("is-expanded");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (card) card.setAttribute("aria-hidden", "true");
    if (restoreFocus && toggle && !toggle.closest("[hidden]")) toggle.focus?.();
  }

  _pauseSimulation() {
    this.simulationUseCase.exit();
    this._closeExitWidget({ restoreFocus: true });
  }

  _setShareActionLabel(id, label) {
    const button = document.getElementById(id);
    if (!button) return;
    button.textContent = label;
    button.setAttribute("aria-label", label);
  }

  _setCenterSimulationState(active) {
    const center = document.querySelector("#tree-center-compendium-btn");
    if (!center) return;
    updateSimulationCenterLabels(center, active, this.localization);
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.container?.removeEventListener("click", this._boundClick);
    if (typeof window !== "undefined") window.removeEventListener("keydown", this._boundKeydown);
    if (this._tooltipRefreshTimer) {
      clearTimeout(this._tooltipRefreshTimer);
      this._tooltipRefreshTimer = null;
    }
    this._draftDiceIds = [];
    this._shareLoadGeneration += 1;
    this._shareUrlCache.clear();
    this._shareUrlPromise = null;
    this._closeShareWidget();
    this._closeExitWidget();
    this._closeQuickUnlockModal();
    this._closeSaveModal();
    this._closeConfirmModal();
    if (typeof document !== "undefined") {
      document.getElementById("simulation-top-capsule-group")?.setAttribute("hidden", "");
      document.body?.classList.remove("simulation-mode");
    }
    this._setCenterSimulationState(false);
    this._initialized = false;
  }
}
