import { getRank } from "../domain/simulation_plan.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";
import { FACTION_DATA } from "../domain/faction_data.js";
import { parseUrlState, URL_ROUTE_KINDS } from "../domain/url_state.js";

function formatNumber(value, localization) {
  return Number(value || 0).toLocaleString(localization?.getIntlLocale?.() || "zh-TW");
}
function nodeLabel(node) {
  return node?.name_zh || node?.name || node?.short_label || `#${node?.id || "?"}`;
}
function forceReflow(element) {
  return element.offsetWidth;
}
function updateSimulationToggle(active, localization) {
  const toggle = document.getElementById("simulation-toggle-btn");
  if (!toggle) return;
  toggle.setAttribute("aria-pressed", String(active));
  const exitWidget = document.getElementById("simulation-exit-widget");
  toggle.setAttribute("aria-expanded", String(Boolean(active && exitWidget?.classList.contains("is-expanded"))));
  const actionLabel = localization?.t?.(active ? "simulation.modeOn" : "simulation.modeOff", {}, active ? "Exit build simulation mode" : "Open build simulation mode") || (active ? "Exit build simulation mode" : "Open build simulation mode");
  toggle.setAttribute("aria-label", actionLabel);
  toggle.title = actionLabel;
  const label = toggle.querySelector("span:last-child");
  if (label) label.textContent = localization?.t?.(active ? "simulation.modeOnLabel" : "simulation.modeOffLabel", {}, active ? "Exit simulation" : "Build simulation") || (active ? "Exit simulation" : "Build simulation");
}

function updateSimulationModeChrome(active, localization) {
  if (typeof document !== "undefined" && document.body) document.body.classList.toggle("simulation-mode", active);
  updateSimulationToggle(active, localization);
  const topCapsule = document.getElementById("simulation-top-capsule-group");
  if (topCapsule) topCapsule.hidden = !active;
}

function updateSimulationCenterLabels(center, active) {
  center.classList.toggle("is-simulation-disabled", active);
  center.setAttribute("aria-disabled", String(active));
  center.setAttribute("tabindex", active ? "-1" : "0");
  const compendiumMark = center.querySelector(".compendium-core-mark");
  if (compendiumMark) compendiumMark.style.display = active ? "none" : "";
  const normalTitle = center.querySelector(".normal-title");
  if (normalTitle) normalTitle.style.display = active ? "none" : "";
  const simTitle = center.querySelector(".simulation-title");
  if (simTitle) simTitle.style.display = active ? "" : "none";
}

function syncSimulationCenterDiceIcon(center, active) {
  let diceIcon = center.querySelector(".simulation-center-dice-icon");
  if (active && !diceIcon) {
    const ownerDocument = center.ownerDocument || document;
    diceIcon = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    diceIcon.setAttribute("class", "simulation-center-dice-icon");
    diceIcon.setAttribute("transform", "translate(0, -30)");
    diceIcon.setAttribute("aria-hidden", "true");
    diceIcon.setAttribute("pointer-events", "none");
    diceIcon.innerHTML = `<use href="#sprite-menu-tree" xlink:href="#sprite-menu-tree" x="-58" y="-58" width="116" height="116" preserveAspectRatio="xMidYMid meet"/>`;
    const body = center.querySelector(".node-body");
    (body || center).appendChild(diceIcon);
  }
  if (diceIcon) diceIcon.style.display = active ? "" : "none";
}

export class SimulationView {
  constructor({ store, simulationUseCase, container, tooltipElement, localization, onShareUrl } = {}) {
    this.store = store;
    this.simulationUseCase = simulationUseCase;
    this.container = container || (typeof document !== "undefined" ? document.body : null);
    this.tooltipElement = tooltipElement || (typeof document !== "undefined" ? document.getElementById("tooltip") : null);
    this.localization = localization || null;
    this.onShareUrl = typeof onShareUrl === "function" ? onShareUrl : null;
    this._unsubscribe = null;
    this._lastSpent = { gold: 0, core: 0 };
    this._tooltipRefreshTimer = null;
    this._draftTeam = null;
    this._editingTeamIndex = 0;
    this._draftDiceIds = [];
    this._pickerReturnTeamIndex = null;
    this._shareImageCache = null;
    this._shareImagePromise = null;
    this._shareUrlCache = new Map();
    this._shareUrlPromise = null;
    this._shareLoadGeneration = 0;
    this._initialized = false;
    this._commonSlotCount = 3;
    this._boundClick = (event) => this._handleClick(event);
    this._boundKeydown = (event) => this._handleKeydown(event);
  }

  _refreshLocalizedPicker(state) {
    if (!state.simulation?.active) return;
    this._updateCostHud(state.simulation);
    const shareWidget = typeof document !== "undefined" ? document.getElementById("simulation-share-widget") : null;
    if (!shareWidget?.classList.contains("is-expanded")) return;
    const pickerBadge = document.getElementById("simulation-picker-badge");
    const pickerTitle = document.getElementById("simulation-picker-title");
    if (pickerBadge) pickerBadge.textContent = this._t("simulation.pickerBadge", { team: this._editingTeamIndex + 1 }, `TEAM ${this._editingTeamIndex + 1}`);
    if (pickerTitle) pickerTitle.textContent = this._t("simulation.pickerTitle", {}, "Choose team dice");
    this._renderTeamSlots(1);
    this._renderTeamSlots(2);
    this._renderDicePickerGrid((state.treeData?.nodes || []).filter((node) => node.node_type === "DICE" && getRank(state.simulation, node.id) > 0));
    if (!shareWidget.classList.contains("is-picker-mode")) this._renderShareImagePreview();
  }

  setLocalization(localization) {
    this.localization = localization || null;
    const state = this.store?.getState?.();
    if (!state) return;
    updateSimulationModeChrome(Boolean(state.simulation?.active), this.localization);
    this._refreshLocalizedPicker(state);
  }

  _t(key, values = {}, fallback = "") {
    return this.localization?.t?.(key, values, fallback) || fallback || key;
  }

  init() {
    if (!this.container || !this.store || !this.simulationUseCase || this._initialized) return;
    this._initialized = true;
    this.container.addEventListener("click", this._boundClick);
    if (typeof window !== "undefined") window.addEventListener("keydown", this._boundKeydown);
    this._unsubscribe = this.store.subscribe((state, action) => {
      if (action?.type === "UPDATE_VIEWPORT" || action?.type === "SET_VIEWPORT") return;
      this.render(state);
    });
    this.render(this.store.getState());

    // A six-character share code is resolved through the Pages Function after
    // canonical data is loaded. Non-code values retain the local decoder as a
    // development/offline fallback.
    const urlState = typeof window !== "undefined" ? parseUrlState(window.location.href) : null;
    const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const hashParams = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.replace(/^#/, "")) : null;
    const routeShare = urlState?.kind === URL_ROUTE_KINDS.SIMULATION ? urlState.share : "";
    const remoteCode = /^[0-9A-Za-z]{6}$/.exec(routeShare)?.[0]
      || /^[0-9A-Za-z]{6}$/.exec(searchParams?.get("s") || "")?.[0]
      || /^[0-9A-Za-z]{6}$/.exec(hashParams?.get("s") || "")?.[0]
      || "";
    if (remoteCode) this._importRemoteShare(remoteCode);
    else if (routeShare || searchParams?.has("s") || searchParams?.has("sim") || hashParams?.has("s") || hashParams?.has("sim")) {
      this.simulationUseCase.importShare(window.location.href, { active: true });
    }
  }

  async _importRemoteShare(code) {
    const generation = this._shareLoadGeneration;
    const result = await this.simulationUseCase.loadShareCode(code);
    if (generation !== this._shareLoadGeneration || !this._initialized || !result?.ok) return result;
    return this.simulationUseCase.importShare(result.encoded, { active: true });
  }

  render(state) {
    const simulation = state?.simulation || { active: false, spent: { gold: 0, core: 0 }, team: { dice: [], commonNodes: [] } };
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
      this._setCenterSimulationState(false);
    }
    this._setCenterSimulationState(active);
  }

  _updateCostHud(simulation) {
    const spent = simulation.spent || { gold: 0, core: 0 };
    const goldEl = document.getElementById("simulation-gold-total");
    const coreEl = document.getElementById("simulation-core-total");
    if (goldEl) goldEl.textContent = formatNumber(spent.gold, this.localization);
    if (coreEl) coreEl.textContent = formatNumber(spent.core, this.localization);

    const goldCapsule = goldEl?.closest(".simulation-currency-capsule");
    const coreCapsule = coreEl?.closest(".simulation-currency-capsule");

    if (this._lastSpent !== null) {
      if (spent.gold !== this._lastSpent.gold && goldCapsule) {
        goldCapsule.classList.remove("is-popping");
        if (typeof goldCapsule.offsetWidth === "number") forceReflow(goldCapsule);
        goldCapsule.classList.add("is-popping");
        goldCapsule.addEventListener("animationend", () => goldCapsule.classList.remove("is-popping"), { once: true });
      }
      if (spent.core !== this._lastSpent.core && coreCapsule) {
        coreCapsule.classList.remove("is-popping");
        if (typeof coreCapsule.offsetWidth === "number") forceReflow(coreCapsule);
        coreCapsule.classList.add("is-popping");
        coreCapsule.addEventListener("animationend", () => coreCapsule.classList.remove("is-popping"), { once: true });
      }
    }
    this._lastSpent = { gold: spent.gold || 0, core: spent.core || 0 };
  }

  _handleShareControlClick(target, id) {
    if (id === "simulation-toggle-btn") {
      if (this.store.getState()?.simulation?.active) {
        this._toggleExitWidget();
      } else {
        this.simulationUseCase.enter();
      }
      return true;
    }
    if (id === "simulation-share-trigger-btn" || target.closest("#simulation-share-trigger-btn")) {
      this._toggleShareWidget(target);
      return true;
    }
    if (id === "simulation-share-close-btn" || target.closest("#simulation-share-close-btn")) {
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
    return false;
  }

  _handleExitControlClick(target, id) {
    if (id === "simulation-exit-close-btn") {
      this._closeExitWidget({ restoreFocus: true });
      return true;
    }
    if (id === "simulation-reset-exit-btn") {
      this._resetAndExit();
      return true;
    }
    if (id === "simulation-pause-btn") {
      this._pauseSimulation();
      return true;
    }
    return false;
  }

  _handleTeamSlotClick(target) {
    const teamCard = target.closest(".simulation-team-dice-card");
    if (teamCard) {
      const teamIndex = Number(teamCard.dataset.teamIndex ?? (teamCard.closest("#simulation-team-slots-2") ? 1 : 0));
      this._switchToPickerView(teamIndex, target);
      return true;
    }
    if (target.closest("#simulation-team-slots-1")) {
      this._switchToPickerView(0, target);
      return true;
    }
    if (target.closest("#simulation-team-slots-2")) {
      this._switchToPickerView(1, target);
      return true;
    }
    return false;
  }

  _handlePickerControlClick(target, id) {
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

  _handleClick(event) {
    const target = event.target?.closest?.("button, [data-simulation-close], .simulation-picker-card");
    if (!target) return;
    const id = target.id;
    if (this._handleShareControlClick(target, id)) return;
    if (this._handleExitControlClick(target, id)) return;
    if (this._handleTeamSlotClick(target)) return;
    if (this._handlePickerControlClick(target, id)) return;
    if (!target.closest("#simulation-share-widget")) this._closeShareWidget();
    if (!target.closest("#simulation-exit-widget")) this._closeExitWidget();
    this._handleSimulationAction(target, event);
  }

  _handleKeydown(event) {
    if (event.key === "Escape") {
      const exitWidget = document.getElementById("simulation-exit-widget");
      if (exitWidget?.classList.contains("is-expanded")) {
        this._closeExitWidget({ restoreFocus: true });
        event.preventDefault();
        return;
      }
      const shareWidget = document.getElementById("simulation-share-widget");
      if (shareWidget?.classList.contains("is-picker-mode")) {
        this._switchToShareView();
        event.preventDefault();
        return;
      }
      if (shareWidget?.classList.contains("is-expanded")) {
        this._closeShareWidget({ restoreFocus: true });
        event.preventDefault();
        return;
      }
    }

  }

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
      document.getElementById("simulation-reset-exit-btn")?.focus?.();
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

  _resetAndExit() {
    this.simulationUseCase.reset();
    this.simulationUseCase.exit();
    this._closeExitWidget();
  }

  _pauseSimulation() {
    this.simulationUseCase.exit();
    this._closeExitWidget({ restoreFocus: true });
  }

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
    widget.classList.add("is-expanded");
    if (triggerBtn) triggerBtn.setAttribute("aria-expanded", "true");
    if (card) card.setAttribute("aria-hidden", "false");

    this._refreshShareUrl({ showLoading: true });
    this._setShareActionLabel("simulation-copy-share-btn", this._t("simulation.copy", {}, "Copy"));
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.download", {}, "Download image"));

    this._renderTeamSlots(1);
    this._renderTeamSlots(2);
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

  _createTeamSlot(teamNum, slotIndex, entry, nodesMap) {
    const node = entry ? nodesMap?.get(String(entry.id || entry)) : null;
    const slotBtn = document.createElement("button");
    slotBtn.type = "button";
    slotBtn.className = `simulation-team-dice-card ${node ? "is-filled" : "is-empty"}`;
    slotBtn.dataset.teamIndex = String(teamNum - 1);
    slotBtn.dataset.slotIndex = String(slotIndex);
    const nodeName = node ? (node.name_zh || node.name) : "";
    slotBtn.setAttribute("aria-label", node
      ? this._t("simulation.slotEdit", { team: teamNum, name: nodeName }, `Team ${teamNum}: ${nodeName}; click to edit`)
      : this._t("simulation.slotEmpty", { team: teamNum, slot: slotIndex + 1 }, `Team ${teamNum}: empty slot ${slotIndex + 1}; click to edit`));
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

  _renderTeamSlots(teamNum) {
    const state = this.store.getState();
    const nodesMap = state.nodesMap;
    const rawDice = state.simulation?.team?.dice || [];
    const startIndex = (teamNum - 1) * 5;
    const teamDice = rawDice.slice(startIndex, startIndex + 5);
    const container = document.getElementById(`simulation-team-slots-${teamNum}`);
    const row2 = document.getElementById("simulation-team-row-2");

    if (teamNum === 1 && row2) {
      row2.hidden = teamDice.length < 5;
    }

    if (!container) return;
    container.innerHTML = "";

    for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
      container.appendChild(this._createTeamSlot(teamNum, slotIndex, teamDice[slotIndex], nodesMap));
    }
  }

  async _renderShareImagePreview() {
    const loading = document.getElementById("simulation-image-loading");
    const previewImg = document.getElementById("simulation-share-image-preview");
    const renderKey = this._getShareImageCacheKey(2);
    if (loading) loading.hidden = false;

    const result = await this._getShareImage({ scale: 2 });
    if (renderKey !== this._getShareImageCacheKey(2)) return;
    if (!result.ok) {
      if (loading) loading.textContent = this._t("simulation.imageError", {}, "Image generation failed");
      return;
    }

    if (previewImg) {
      previewImg.src = result.dataUrl || (result.blob ? URL.createObjectURL(result.blob) : "");
    }
    if (loading) loading.hidden = true;
  }

  _getShareImageCacheKey(scale) {
    const simulation = this.store.getState()?.simulation || {};
    return JSON.stringify({
      scale,
      locale: this.localization?.getLocale?.() || "zh-tw",
      ranks: simulation.ranks || {},
      team: simulation.team || { dice: [], commonNodes: [] }
    });
  }

  async _getShareImage({ scale }) {
    const key = this._getShareImageCacheKey(scale);
    if (this._shareImageCache?.key === key) return this._shareImageCache.result;
    if (this._shareImagePromise?.key === key) return this._shareImagePromise.promise;

    const promise = this.simulationUseCase.generateShareImage({
      scale,
      title: this._t("simulation.imageTitle", {}, "Dice tree build simulation"),
      currencyLabels: {
        gold: this._t("simulation.goldLabel", {}, "Gold"),
        core: this._t("simulation.coreLabel", {}, "Cores")
      },
      teamLabels: {
        team1: this._t("simulation.team", { team: 1 }, "Team 1"),
        team2: this._t("simulation.team", { team: 2 }, "Team 2")
      },
      watermark: this._t("simulation.watermark", {}, "Random Dice 2 Lab")
    }).then((result) => {
      if (result?.ok) this._shareImageCache = { key, result };
      return result;
    }).finally(() => {
      if (this._shareImagePromise?.key === key) this._shareImagePromise = null;
    });
    this._shareImagePromise = { key, promise };
    return promise;
  }

  _switchToPickerView(teamIndex, opener = null) {
    const state = this.store.getState();
    const nodes = state.treeData?.nodes || [];
    const unlockedDice = nodes.filter((n) => n.node_type === "DICE" && getRank(state.simulation, n.id) > 0);

    if (unlockedDice.length === 0) {
      return;
    }

    this._editingTeamIndex = teamIndex;
    this._pickerReturnTeamIndex = teamIndex;
    const currentTeamDice = (state.simulation?.team?.dice || []).slice(teamIndex * 5, (teamIndex + 1) * 5);
    this._draftDiceIds = currentTeamDice
      .map((d) => String(d?.id || d))
      .filter((id) => unlockedDice.some((n) => String(n.id) === id));

    const badge = document.getElementById("simulation-picker-badge");
    const title = document.getElementById("simulation-picker-title");
    if (badge) badge.textContent = this._t("simulation.pickerBadge", { team: teamIndex + 1 }, `TEAM ${teamIndex + 1}`);
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

    // 重新更新分享網址、隊伍槽位與圖片預覽
    this._refreshShareUrl({ showLoading: true });

    this._renderTeamSlots(1);
    this._renderTeamSlots(2);
    this._renderShareImagePreview();

    if (restoreFocus && this._pickerReturnTeamIndex !== null) {
      const teamIndex = this._pickerReturnTeamIndex;
      queueMicrotask(() => {
        document.querySelector(`#simulation-team-slots-${teamIndex + 1} .simulation-team-dice-card`)?.focus?.();
      });
    }
  }

  _getSerializedShare() {
    return this.simulationUseCase.serialize({
      origin: typeof window !== "undefined" ? window.location.origin : ""
    });
  }

  _refreshShareUrl({ showLoading = false } = {}) {
    const input = document.getElementById("simulation-share-url");
    const serialized = this._getSerializedShare();
    const key = serialized.encoded;
    const cached = this._shareUrlCache.get(key);
    if (cached) {
      if (input) input.value = cached.url;
      return Promise.resolve(cached);
    }
    if (this._shareUrlPromise?.key === key) return this._shareUrlPromise.promise;
    if (showLoading && input) input.value = this._t("simulation.urlLoading", {}, "Creating short link…");

    const promise = this.simulationUseCase.createShareLink({
      serialized,
      origin: typeof window !== "undefined" ? window.location.origin : ""
    }).catch(() => serialized).then((result) => {
      this._shareUrlCache.set(key, result);
      const current = this._getSerializedShare();
      if (input && current.encoded === key) input.value = result.url;
      if (current.encoded === key) this.onShareUrl?.(result.url);
      return result;
    }).finally(() => {
      if (this._shareUrlPromise?.key === key) this._shareUrlPromise = null;
    });
    this._shareUrlPromise = { key, promise };
    return promise;
  }

  _renderDicePickerGrid(unlockedDice) {
    const grid = document.getElementById("simulation-picker-grid");
    const countEl = document.getElementById("simulation-picker-count");
    const saveBtn = document.getElementById("simulation-picker-save");

    if (countEl) countEl.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `Selected ${this._draftDiceIds.length}/5`);
    if (saveBtn) saveBtn.disabled = this._draftDiceIds.length !== 5;

    if (!grid) return;
    grid.innerHTML = "";

    unlockedDice.forEach((node, idx) => {
      const id = String(node.id);
      const selectedIndex = this._draftDiceIds.indexOf(id);
      const isSelected = selectedIndex !== -1;

      const item = document.createElement("button");
      item.type = "button";
      item.className = `compendium-compact-item simulation-picker-card ${isSelected ? "is-selected" : ""}`;
      item.dataset.diceId = id;
      item.disabled = this._draftDiceIds.length >= 5 && !isSelected;
      item.style.animationDelay = `${Math.min(300, idx * 20)}ms`;
      const selectedFallback = `position ${selectedIndex + 1}`;
      const selectedSuffix = isSelected
        ? `, ${this._t("simulation.selectedOrder", { order: selectedIndex + 1 }, selectedFallback)}`
        : "";
      item.setAttribute("aria-label", `${node.name_zh || node.name}${selectedSuffix}`);

      const fData = FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1];
      if (typeof item.style?.setProperty === "function") {
        item.style.setProperty("--node-faction", fData.color);
      }

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
      img.alt = node.name_zh || node.name || this._t("simulation.diceFallback", {}, "Dice");
      img.loading = "lazy";
      slot.appendChild(img);

      const label = document.createElement("span");
      label.className = "compact-dice-label";
      const cleanName = (node.name_zh || node.name || "").replace(/骰子$/, "");
      label.textContent = cleanName;

      item.appendChild(slot);
      item.appendChild(label);

      grid.appendChild(item);
    });
  }

  _updateDicePickerSelectionState() {
    const grid = document.getElementById("simulation-picker-grid");
    const countEl = document.getElementById("simulation-picker-count");
    const saveBtn = document.getElementById("simulation-picker-save");

    if (countEl) countEl.textContent = this._t("simulation.pickerCount", { count: this._draftDiceIds.length }, `Selected ${this._draftDiceIds.length}/5`);
    if (saveBtn) saveBtn.disabled = this._draftDiceIds.length !== 5;
    if (!grid) return;

    const items = grid.querySelectorAll(".simulation-picker-card");
    items.forEach((item) => {
      const id = item.dataset.diceId;
      const selectedIndex = this._draftDiceIds.indexOf(id);
      const isSelected = selectedIndex !== -1;

      item.classList.toggle("is-selected", isSelected);
      item.disabled = this._draftDiceIds.length >= 5 && !isSelected;
      const slot = item.querySelector(".compact-dice-slot");
      let badge = slot?.querySelector(".simulation-picker-card-badge");

      if (isSelected) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "simulation-picker-card-badge";
          slot?.appendChild(badge);
        }
        badge.textContent = String(selectedIndex + 1);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  _toggleDicePickerSelection(diceId) {
    const index = this._draftDiceIds.indexOf(diceId);
    if (index !== -1) {
      this._draftDiceIds.splice(index, 1);
    } else {
      if (this._draftDiceIds.length >= 5) {
        return;
      }
      this._draftDiceIds.push(diceId);
    }

    this._updateDicePickerSelectionState();
  }

  _saveDicePicker() {
    if (this._draftDiceIds.length !== 5) return;
    const state = this.store.getState();
    const rawDice = [...(state.simulation?.team?.dice || [])];
    const newTeamEntries = this._draftDiceIds.map((id) => ({ id, runes: [] }));

    if (this._editingTeamIndex === 0) {
      rawDice.splice(0, 5, ...newTeamEntries);
    } else {
      while (rawDice.length < 5) rawDice.push(null);
      rawDice.splice(5, 5, ...newTeamEntries);
    }

    const newTeam = {
      ...state.simulation.team,
      dice: rawDice.filter(Boolean)
    };

    this.simulationUseCase.setTeam(newTeam);
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

  _showShareImageError(button) {
    if (button) button.disabled = false;
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageError", {}, "Image generation failed"));
  }

  _downloadImageHref(href, result) {
    const link = document.createElement("a");
    link.href = href;
    link.download = this._t("simulation.shareImageFilename", {}, "random-dice-2-lab-planning.png");
    link.click();
    if (result.blob) setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async _downloadShareImage() {
    const button = document.getElementById("simulation-image-share-btn");
    if (button) button.disabled = true;
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageGenerating", {}, "Generating…"));
    const result = await this._getShareImage({ scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)) });
    if (!result.ok) return this._showShareImageError(button);
    const href = result.blob ? URL.createObjectURL(result.blob) : result.dataUrl;
    if (!href) return this._showShareImageError(button);
    this._downloadImageHref(href, result);
    if (button) button.disabled = false;
    this._setShareActionLabel("simulation-image-share-btn", this._t("simulation.imageDownloaded", {}, "Downloaded"));
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
    updateSimulationCenterLabels(center, active);
    syncSimulationCenterDiceIcon(center, active);
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
    this._draftTeam = null;
    this._draftDiceIds = [];
    this._shareLoadGeneration += 1;
    this._shareUrlCache.clear();
    this._shareUrlPromise = null;
    this._closeShareWidget();
    this._closeExitWidget();
    if (typeof document !== "undefined") {
      document.getElementById("simulation-top-capsule-group")?.setAttribute("hidden", "");
      document.body?.classList.remove("simulation-mode");
    }
    this._setCenterSimulationState(false);
    this._initialized = false;
  }
}
