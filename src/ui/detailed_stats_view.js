/**
 * @fileoverview 詳細能力視圖組件 (DetailedStatsView)
 * @module ui/detailed_stats_view
 */

import { aggregateDetailedStats } from "../domain/detailed_stats.js";
import { escapeHtml } from "../domain/game_text.js";

const BRANCH_SPRITE_MAP = {
  1: "#sprite-192", // 自然
  2: "#sprite-193", // 工學
  3: "#sprite-194", // 魔法
  4: "#sprite-195", // 秩序
  5: "#sprite-196"  // 渾沌
};

function renderGlobalStats(view, globalStats) {
  if (!globalStats || globalStats.length === 0) return "";
  const items = globalStats
    .map((item) => `<div class="detailed-stats-item">${escapeHtml(view._formatItem(item))}</div>`)
    .join("");
  return `<div class="detailed-stats-group detailed-stats-global-group">${items}</div>`;
}

function renderBranchStats(view, branch, branchId) {
  const spriteId = BRANCH_SPRITE_MAP[branchId] || "#sprite-192";
  const title = escapeHtml(view._t(`faction.${branchId}`, {}, branch.name));
  const items = (branch.stats || [])
    .map((item) => `<div class="detailed-stats-item">${escapeHtml(view._formatItem(item))}</div>`)
    .join("");
  return `
    <div class="detailed-stats-group detailed-stats-branch-group" data-branch="${branchId}">
      <div class="detailed-stats-branch-header" style="--branch-color: ${branch.color};">
        <svg class="detailed-stats-branch-icon" viewBox="0 0 64 64" aria-hidden="true">
          <use href="${spriteId}" xlink:href="${spriteId}"></use>
        </svg>
        <span class="detailed-stats-branch-name">${title}</span>
      </div>
      ${items}
    </div>
  `;
}

function renderEmptyStatsHint(view) {
  return `<div class="detailed-stats-empty-hint"><span>${escapeHtml(view._t("stats.empty", {}, "No passive nodes are allocated yet"))}</span></div>`;
}

export class DetailedStatsView {
  /**
   * @param {object} dependencies
   * @param {import("../app/store/app_store.js").AppStore} dependencies.store
   * @param {HTMLElement} [dependencies.container]
   */
  constructor({ store, container, localization }) {
    this.store = store;
    this.container = container || (typeof document !== "undefined" ? document : null);
    this.localization = localization || null;
    this.isOpen = false;

    this._triggerBtn = null;
    this._modal = null;
    this._card = null;
    this._contentSlot = null;
    this._closeBtn = null;

    this._listeners = [];
    this._unsubscribe = null;
    this._initialized = false;
  }

  setLocalization(localization) {
    this.localization = localization || null;
    if (this.isOpen) this.render();
  }

  _t(key, values = {}, fallback = "") {
    return this.localization?.t?.(key, values, fallback) || fallback || key;
  }

  _formatItem(item) {
    const numeric = item?.totalValue == null ? "" : String(Math.round(Number(item.totalValue) * 10000) / 10000);
    let text = item?.text || "";
    if (item?.sourceKey && this.localization?.source) {
      text = this.localization.source(item.sourceKey, { 0: numeric }, text);
    }
    return String(text)
      .replaceAll(/<color=[^>]+>(.*?)<\/color>/gi, "$1")
      .replaceAll(/<br\s*\/?>(?=.)/gi, " ")
      .replaceAll(/<\/?[a-z][^>]*>/gi, "")
      .replaceAll("{0}", numeric);
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;

    if (typeof document === "undefined") return;

    this._triggerBtn = document.getElementById("detailed-stats-btn");
    this._modal = document.getElementById("detailed-stats-modal");
    this._card = document.getElementById("detailed-stats-card");
    this._contentSlot = document.getElementById("detailed-stats-content-slot");
    this._closeBtn = document.getElementById("detailed-stats-close-btn");

    if (this._triggerBtn) {
      this._addListener(this._triggerBtn, "click", (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    if (this._closeBtn) {
      this._addListener(this._closeBtn, "click", (e) => {
        e.stopPropagation();
        this.close();
      });
    }

    if (this._modal) {
      this._addListener(this._modal, "click", (e) => {
        if (e.target === this._modal || e.target.classList?.contains("detailed-stats-backdrop")) {
          this.close();
        }
      });
    }

    // 全域 ESC 快捷鍵
    this._addListener(document, "keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });

    this._unsubscribe = this.store.subscribe((state, action) => {
      if (this.isOpen) {
        this.render(state);
      }
    });
  }

  _addListener(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, listener, options);
    this._listeners.push({ target, type, listener, options });
  }

  destroy() {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    for (const { target, type, listener, options } of this._listeners) {
      target.removeEventListener?.(type, listener, options);
    }
    this._listeners = [];
    this._initialized = false;
    this.isOpen = false;
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    if (this._triggerBtn) {
      this._triggerBtn.setAttribute?.("aria-expanded", "true");
      this._triggerBtn.classList?.add("is-active");
    }
    if (this._modal) {
      this._modal.classList?.remove("is-closing");
      this._modal.hidden = false;
      this._modal.removeAttribute?.("inert");
      this._modal.setAttribute?.("aria-hidden", "false");
      this._modal.classList?.add("is-open");
    }
    const state = this.store?.getState?.();
    if (state) {
      this.render(state);
    }
  }

  close(immediate = false) {
    this.isOpen = false;
    if (this._triggerBtn) {
      this._triggerBtn.setAttribute?.("aria-expanded", "false");
      this._triggerBtn.classList?.remove("is-active");
    }

    // 若當前焦點落在彈窗內部（例如關閉按鈕），先將焦點還原至觸發按鈕或失焦，防止 aria-hidden 與 inert 拋出無障礙違規
    if (typeof document !== "undefined" && this._modal?.contains?.(document.activeElement)) {
      if (this._triggerBtn && typeof this._triggerBtn.focus === "function") {
        this._triggerBtn.focus();
      } else if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
    }

    if (!this._modal) return;

    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }

    if (immediate) {
      this._modal.classList?.remove("is-closing", "is-open");
      this._modal.hidden = true;
      this._modal.setAttribute?.("inert", "");
      this._modal.setAttribute?.("aria-hidden", "true");
      return;
    }

    // 出場動畫過渡
    this._modal.classList?.remove("is-open");
    this._modal.classList?.add("is-closing");

    this._closeTimer = setTimeout(() => {
      if (!this.isOpen && this._modal) {
        this._modal.classList?.remove("is-closing");
        this._modal.hidden = true;
        this._modal.setAttribute?.("inert", "");
        this._modal.setAttribute?.("aria-hidden", "true");
      }
      this._closeTimer = null;
    }, 180);
  }

  render(state = this.store?.getState?.()) {
    if (!this._contentSlot || !state) return;

    const isSimulation = Boolean(state.simulation?.active ?? state.simulationMode);
    const activeRanks = isSimulation ? (state.simulation?.ranks || state.simulationPlan?.ranks || {}) : null;
    const nodes = state.treeData?.nodes || state.nodesMap || state.nodes || [];

    const aggregated = aggregateDetailedStats(nodes, activeRanks);

    let html = renderGlobalStats(this, aggregated.global);
    html += [1, 2, 3, 4, 5]
      .map((branchId) => aggregated.branches[branchId] ? renderBranchStats(this, aggregated.branches[branchId], branchId) : "")
      .join("");
    const hasGlobalStats = aggregated.global?.length > 0;
    const hasBranchStats = Object.values(aggregated.branches).some((branch) => branch.stats?.length > 0);
    if (isSimulation && !hasGlobalStats && !hasBranchStats) html = renderEmptyStatsHint(this) + html;

    this._contentSlot.innerHTML = html;
  }
}
