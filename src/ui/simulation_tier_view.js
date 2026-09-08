/**
 * @fileoverview 模擬階段梯隊與優先度成長線表現層元件 (UI Presentation Layer)
 * @module ui/simulation_tier_view
 */

import { calculateTierDelta } from "../domain/simulation_tiers.js";

export class SimulationTierView {
  /**
   * @param {Object} dependencies
   * @param {Object} dependencies.store
   * @param {Object} dependencies.simulationUseCase SimulationPlanUseCase 實例
   */
  constructor({ store, simulationUseCase }) {
    this.store = store;
    this.simulationUseCase = simulationUseCase;
    this.container = null;
    this.unsubscribe = null;
  }

  init() {
    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = "simulation-tier-rail";
    this.container.className = "sim-tier-rail";
    this.container.style.display = "none";

    // 直接掛載至 body，由獨立 fixed 定位懸浮於頂部膠囊下方
    document.body.appendChild(this.container);

    this._bindEvents();

    if (this.store) {
      this.unsubscribe = this.store.subscribe((state) => this.render(state));
    }
  }

  _bindEvents() {
    this.container.addEventListener("click", (e) => {
      // 切換梯隊
      const tierPill = e.target.closest(".sim-tier-pill");
      if (tierPill) {
        const tierId = tierPill.dataset.tierId;
        this.simulationUseCase.switchTier(tierId);
        return;
      }

      // 智慧自動階梯化
      const autoBtn = e.target.closest("#sim-tier-btn-auto");
      if (autoBtn) {
        this.simulationUseCase.autoGenerateTiers();
        return;
      }

      // 另存當前配置為新階級
      const addBtn = e.target.closest("#sim-tier-btn-add");
      if (addBtn) {
        this.simulationUseCase.addTierFromCurrent();
        return;
      }

      // 設為核心下限
      const baselineBtn = e.target.closest("#sim-tier-btn-baseline");
      if (baselineBtn) {
        const activeTier = this.simulationUseCase.getActiveTier();
        if (activeTier) {
          this.simulationUseCase.setBaselineTier(activeTier.id);
        }
        return;
      }
    });
  }

  render(state) {
    if (!this.container) return;

    const simState = state?.simulation;
    const isSimActive = Boolean(simState?.active);

    if (!isSimActive) {
      this.container.style.display = "none";
      return;
    }

    this.container.style.display = "flex";

    const tiers = this.simulationUseCase.getTiers();
    const activeTierId = simState.activeTierId || tiers[0]?.id || "t0";
    const activeTierIdx = tiers.findIndex((t) => t.id === activeTierId);
    const activeTier = tiers[activeTierIdx] || tiers[0];
    const nextTier = tiers[activeTierIdx + 1] || null;

    // 計算距下一階梯隊差距
    let deltaInfoHtml = "";
    if (nextTier) {
      const delta = calculateTierDelta(activeTier, nextTier, state.nodesMap);
      deltaInfoHtml = `
        <span class="sim-tier-delta-hint">
          距下一階 (${nextTier.name}) 需：<strong>+${(delta.goldDelta / 1000).toFixed(1)}k 金幣</strong> / <strong>+${delta.diceDelta} 骰子</strong>
        </span>
      `;
    } else {
      deltaInfoHtml = `<span class="sim-tier-delta-hint is-max">已達最高階級完全體</span>`;
    }

    // 生成梯隊按鈕列表
    let pillsHtml = "";
    for (const tier of tiers) {
      const isActive = tier.id === activeTierId;
      const isBaseline = Boolean(tier.isBaseline);
      pillsHtml += `
        <button type="button"
                class="sim-tier-pill ${isActive ? "is-active" : ""} ${isBaseline ? "is-baseline" : ""}"
                data-tier-id="${tier.id}">
          <span class="sim-tier-name">${tier.name}</span>
          ${isBaseline ? '<span class="sim-tier-baseline-badge">必點下限</span>' : ""}
          <span class="sim-tier-label">${tier.label}</span>
        </button>
      `;
    }

    this.container.innerHTML = `
      <div class="sim-tier-header">
        <div class="sim-tier-title-group">
          <span class="sim-tier-title-icon">📈</span>
          <span class="sim-tier-title">階段梯隊與成長線</span>
        </div>
        <div class="sim-tier-actions">
          <button type="button" class="sim-tier-action-btn" id="sim-tier-btn-auto" title="依據目前加點自動推導下限至完全體">
            ✨ 智慧分階
          </button>
          <button type="button" class="sim-tier-action-btn" id="sim-tier-btn-add" title="將當前加點保存為新階級">
            ➕ 增加階級
          </button>
          <button type="button" class="sim-tier-action-btn ${activeTier?.isBaseline ? "is-active-baseline" : ""}" id="sim-tier-btn-baseline" title="標記當前階段為最低啟動門檻">
            ${activeTier?.isBaseline ? "✓ 已設為下限門檻" : "設為核心下限"}
          </button>
        </div>
      </div>

      <div class="sim-tier-track">
        ${pillsHtml}
      </div>

      <div class="sim-tier-detail-bar">
        <div class="sim-tier-note-text">
          <span class="sim-tier-note-label">戰術定位：</span>
          <span>${activeTier?.note || "暫無特別說明"}</span>
        </div>
        ${deltaInfoHtml}
      </div>
    `;
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}
