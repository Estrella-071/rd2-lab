/**
 * @fileoverview 戰場棋盤攻擊速度計算器表現層元件 (UI Presentation Layer)
 * @module ui/attack_speed_view
 */

import {
  BATTLEFIELD_ROWS,
  BATTLEFIELD_COLS,
  TOTAL_BATTLEFIELD_SLOTS,
  getSlotCoords
} from "../domain/attack_speed.js";

const BATTLEFIELD_BACKGROUND_ASSETS = [
  "icons/Ingame_Field_Planet04.png",
  "icons/field.png"
];

const DICE_PRESETS = [
  { id: "solar", name: "太陽", icon: "icons/Icon_Bubble.png", baseInterval: 0.6, type: "attacker" },
  { id: "dice_light", name: "光", icon: "icons/Icon_SpeedUp.png", baseInterval: 1.0, type: "light" },
  { id: "dice_resonance", name: "共鳴", icon: "icons/Icon_Quick.png", baseInterval: 1.0, type: "resonance" },
  { id: "bubble", name: "泡泡", icon: "icons/Icon_Bubble.png", baseInterval: 1.0, type: "attacker" },
  { id: "wind", name: "風", icon: "icons/Icon_Quick.png", baseInterval: 0.2, type: "attacker" }
];

export class AttackSpeedView {
  /**
   * @param {Object} dependencies
   * @param {Object} dependencies.store
   * @param {Object} dependencies.useCase AttackSpeedUseCase 實例
   */
  constructor({ store, useCase }) {
    this.store = store;
    this.useCase = useCase;
    this.container = null;
    this.unsubscribe = null;
    this._handleKeyDown = this._handleKeyDown.bind(this);
  }

  init() {
    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = "attack-speed-modal";
    this.container.className = "as-modal-backdrop";
    this.container.style.display = "none";
    this.container.setAttribute("aria-hidden", "true");

    this._renderSkeleton();
    document.body.appendChild(this.container);

    this._bindEvents();
    window.addEventListener("keydown", this._handleKeyDown);

    if (this.store) {
      this.unsubscribe = this.store.subscribe((state) => this.render(state));
    }
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="as-modal-dialog" role="dialog" aria-labelledby="as-modal-title">
        <div class="as-modal-header">
          <div class="as-title-group">
            <span class="as-title-icon">⚔️</span>
            <h2 id="as-modal-title" class="as-modal-title">戰場攻速計算器</h2>
            <span class="as-badge-formula">正統多乘區減算法</span>
          </div>
          <button type="button" class="as-close-btn" aria-label="關閉視窗">&times;</button>
        </div>

        <div class="as-modal-body">
          <!-- 左側 / 上方：戰場 3x5 棋盤 -->
          <div class="as-battlefield-section">
            <div class="as-field-container">
              <div class="as-field-bg"></div>
              <div class="as-grid-board" id="as-grid-board">
                <!-- 15 格動態生成 -->
              </div>
            </div>

            <!-- 預設陣容快捷列 -->
            <div class="as-preset-bar">
              <span class="as-preset-label">推薦陣容：</span>
              <button type="button" class="as-btn-pill" data-preset="solar_light_cross">太陽光十字</button>
              <button type="button" class="as-btn-pill" data-preset="moon_resonance">共鳴連線</button>
              <button type="button" class="as-btn-pill as-btn-dim" data-preset="clear">清空盤面</button>
            </div>
          </div>

          <!-- 右側 / 下方：計算結果與格位配置 -->
          <div class="as-control-section">
            <!-- 核心測算看板 -->
            <div class="as-analytics-card" id="as-analytics-card">
              <!-- 動態渲染攻速指標 -->
            </div>

            <!-- 選中格位屬性編輯器 -->
            <div class="as-slot-editor" id="as-slot-editor">
              <div class="as-editor-empty-hint">請在棋盤上點擊任意格子進行配置</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    this._triggerBtn = document.getElementById("attack-speed-toggle-btn");
    this._onTriggerClick = () => {
      this.useCase.open();
    };
    if (this._triggerBtn) {
      this._triggerBtn.addEventListener("click", this._onTriggerClick);
    }

    this.container.addEventListener("click", (e) => {
      // 點擊背景遮罩或關閉按鈕關閉
      if (e.target === this.container || e.target.closest(".as-close-btn")) {
        this.useCase.close();
        return;
      }

      // 點擊棋盤格位
      const slotEl = e.target.closest(".as-grid-slot");
      if (slotEl) {
        const slotIdx = Number(slotEl.dataset.index);
        this.useCase.selectSlot(slotIdx);
        return;
      }

      // 預設陣容按鈕
      const presetBtn = e.target.closest("[data-preset]");
      if (presetBtn) {
        const preset = presetBtn.dataset.preset;
        if (preset === "clear") {
          for (let i = 0; i < TOTAL_BATTLEFIELD_SLOTS; i++) {
            this.useCase.clearSlot(i);
          }
        } else {
          this.useCase.loadPreset(preset);
        }
        return;
      }

      // 設為目標骰子
      const setTargetBtn = e.target.closest("#as-btn-set-target");
      if (setTargetBtn) {
        const slotIdx = Number(setTargetBtn.dataset.index);
        this.useCase.setTargetSlot(slotIdx);
        return;
      }

      // 清除目前格位
      const clearSlotBtn = e.target.closest("#as-btn-clear-slot");
      if (clearSlotBtn) {
        const slotIdx = Number(clearSlotBtn.dataset.index);
        this.useCase.clearSlot(slotIdx);
        return;
      }

      // 選擇骰子類型
      const diceSelectBtn = e.target.closest(".as-dice-select-btn");
      if (diceSelectBtn) {
        const diceId = diceSelectBtn.dataset.diceId;
        const preset = DICE_PRESETS.find((p) => p.id === diceId);
        const currentSlotIdx = this._getSelectedSlotIndex();
        if (currentSlotIdx !== null && preset) {
          const currentSlot = this._getBoard()[currentSlotIdx] || {};
          this.useCase.setSlotDice(currentSlotIdx, {
            ...preset,
            dot: currentSlot.dot || 7,
            classLevel: currentSlot.classLevel || 10,
            powerUpLevel: currentSlot.powerUpLevel || 5
          });
        }
        return;
      }

      // 調整點數 (Dot 1~7)
      const dotBtn = e.target.closest(".as-dot-btn");
      if (dotBtn) {
        const dot = Number(dotBtn.dataset.dot);
        const currentSlotIdx = this._getSelectedSlotIndex();
        if (currentSlotIdx !== null) {
          const currentSlot = this._getBoard()[currentSlotIdx];
          if (currentSlot) {
            this.useCase.setSlotDice(currentSlotIdx, { ...currentSlot, dot });
          }
        }
        return;
      }
    });

    // 監聽基礎間隔與等級輸入
    this.container.addEventListener("input", (e) => {
      if (e.target.id === "as-input-base-interval") {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          this.useCase.setCustomBaseInterval(val);
        }
      } else if (e.target.id === "as-range-class") {
        const val = parseInt(e.target.value, 10);
        const currentSlotIdx = this._getSelectedSlotIndex();
        if (currentSlotIdx !== null) {
          const currentSlot = this._getBoard()[currentSlotIdx];
          if (currentSlot) {
            this.useCase.setSlotDice(currentSlotIdx, { ...currentSlot, classLevel: val });
          }
        }
      } else if (e.target.id === "as-range-powerup") {
        const val = parseInt(e.target.value, 10);
        const currentSlotIdx = this._getSelectedSlotIndex();
        if (currentSlotIdx !== null) {
          const currentSlot = this._getBoard()[currentSlotIdx];
          if (currentSlot) {
            this.useCase.setSlotDice(currentSlotIdx, { ...currentSlot, powerUpLevel: val });
          }
        }
      }
    });
  }

  _handleKeyDown(e) {
    if (e.key === "Escape" && this.container?.style.display !== "none") {
      this.useCase.close();
    }
  }

  render(state) {
    if (!this.container) return;

    const asState = state?.attackSpeed;
    const isOpen = Boolean(asState?.isOpen);

    if (!isOpen) {
      this.container.style.display = "none";
      this.container.setAttribute("aria-hidden", "true");
      return;
    }

    this.container.style.display = "flex";
    this.container.setAttribute("aria-hidden", "false");

    const board = asState.board || Array(TOTAL_BATTLEFIELD_SLOTS).fill(null);
    const targetIdx = asState.targetSlotIndex ?? 7;
    const selectedIdx = asState.selectedSlotIndex;
    const evaluation = asState.currentEvaluation;

    // 1. 渲染 3x5 棋盤格
    this._renderBoard(board, targetIdx, selectedIdx, evaluation?.activeRayLinks || []);

    // 2. 渲染測算指標看板
    this._renderAnalytics(asState, evaluation);

    // 3. 渲染選中格位編輯器
    this._renderSlotEditor(selectedIdx, board[selectedIdx], targetIdx);
  }

  _renderBoard(board, targetIdx, selectedIdx, rayLinks) {
    const gridEl = this.container.querySelector("#as-grid-board");
    if (!gridEl) return;

    let html = "";
    for (let i = 0; i < TOTAL_BATTLEFIELD_SLOTS; i++) {
      const slot = board[i];
      const isTarget = i === targetIdx;
      const isSelected = i === selectedIdx;
      const hasDice = Boolean(slot);

      let diceClass = "";
      let diceHtml = "";

      if (hasDice) {
        const dot = slot.dot || 1;
        const isStar = dot === 7;
        const dotText = isStar ? "👑 7" : `${dot} 點`;
        diceClass = `as-slot-has-dice as-type-${slot.type || "attacker"}`;
        diceHtml = `
          <div class="as-dice-content">
            <span class="as-dice-name">${slot.diceName || slot.name || "骰子"}</span>
            <span class="as-dice-dot ${isStar ? "as-dot-star" : ""}">${dotText}</span>
            <span class="as-dice-level">Lv.${slot.classLevel || 7}</span>
          </div>
        `;
      }

      html += `
        <div class="as-grid-slot ${isTarget ? "is-target" : ""} ${isSelected ? "is-selected" : ""} ${diceClass}"
             data-index="${i}"
             role="button"
             tabindex="0"
             aria-label="格子 ${i + 1}${isTarget ? " (目前測算目標)" : ""}">
          <div class="as-slot-base"></div>
          ${diceHtml}
          ${isTarget ? '<div class="as-target-badge">目標</div>' : ""}
        </div>
      `;
    }

    gridEl.innerHTML = html;
  }

  _renderAnalytics(asState, evaluation) {
    const cardEl = this.container.querySelector("#as-analytics-card");
    if (!cardEl) return;

    if (!evaluation || !evaluation.speedResult) {
      cardEl.innerHTML = `<div class="as-hint">請在棋盤上選擇或配置目標骰子以開始計算</div>`;
      return;
    }

    const { speedResult } = evaluation;
    const isClamped = speedResult.isClamped;

    let reductionsHtml = "";
    for (const red of speedResult.reductions) {
      if (red.bonusRate <= 0) continue;
      reductionsHtml += `
        <div class="as-reduction-row">
          <span class="as-red-name">${red.name} (+${Math.round(red.bonusRate * 100)}%)</span>
          <span class="as-red-time">-${red.reducedTime.toFixed(4)}s</span>
        </div>
      `;
    }

    cardEl.innerHTML = `
      <div class="as-kpi-banner">
        <div class="as-kpi-item">
          <span class="as-kpi-label">基礎間隔</span>
          <span class="as-kpi-val as-kpi-dim">${speedResult.baseInterval.toFixed(3)}s</span>
        </div>
        <div class="as-kpi-arrow">➔</div>
        <div class="as-kpi-item">
          <span class="as-kpi-label">最終間隔</span>
          <span class="as-kpi-val as-kpi-highlight">${speedResult.finalInterval.toFixed(3)}s</span>
          ${isClamped ? '<span class="as-badge-clamped">0.01s 下限保護</span>' : ""}
        </div>
        <div class="as-kpi-item as-kpi-multiplier">
          <span class="as-kpi-label">總攻速提升</span>
          <span class="as-kpi-speedup">${speedResult.speedMultiplier.toFixed(2)}x</span>
        </div>
      </div>

      <div class="as-aps-strip">
        <span>每秒攻擊次數 (APS)：<strong>${speedResult.attacksPerSecond.toFixed(2)}</strong> 次/秒</span>
      </div>

      <div class="as-reductions-list">
        <div class="as-list-title">各乘區減算法減免明細：</div>
        ${reductionsHtml || '<div class="as-no-reduction">尚無相鄰光或共鳴加速</div>'}
      </div>
    `;
  }

  _renderSlotEditor(selectedIdx, slot, targetIdx) {
    const editorEl = this.container.querySelector("#as-slot-editor");
    if (!editorEl) return;

    if (selectedIdx === null || selectedIdx === undefined) {
      editorEl.innerHTML = `<div class="as-editor-empty-hint">點擊盤面格子以編輯骰子或設定為測算目標</div>`;
      return;
    }

    const isTarget = selectedIdx === targetIdx;
    const coords = getSlotCoords(selectedIdx);

    let diceButtonsHtml = "";
    for (const p of DICE_PRESETS) {
      const isSelectedDice = slot && (slot.id === p.id || slot.type === p.type);
      diceButtonsHtml += `
        <button type="button" class="as-dice-select-btn ${isSelectedDice ? "is-active" : ""}" data-dice-id="${p.id}">
          ${p.name}
        </button>
      `;
    }

    let dotButtonsHtml = "";
    const currentDot = slot?.dot || 7;
    for (let d = 1; d <= 7; d++) {
      const isCur = currentDot === d;
      dotButtonsHtml += `
        <button type="button" class="as-dot-btn ${isCur ? "is-active" : ""}" data-dot="${d}">
          ${d === 7 ? "👑 7" : d}
        </button>
      `;
    }

    editorEl.innerHTML = `
      <div class="as-editor-header">
        <span class="as-slot-badge">格位 (${coords.row + 1}, ${coords.col + 1})</span>
        <div class="as-editor-actions">
          <button type="button" class="as-btn-small ${isTarget ? "is-disabled" : ""}" id="as-btn-set-target" data-index="${selectedIdx}" ${isTarget ? "disabled" : ""}>
            ${isTarget ? "🎯 目前目標" : "設為測算目標"}
          </button>
          <button type="button" class="as-btn-small as-btn-danger" id="as-btn-clear-slot" data-index="${selectedIdx}">
            清空格位
          </button>
        </div>
      </div>

      <div class="as-control-group">
        <label class="as-label">放置骰子：</label>
        <div class="as-dice-button-grid">
          ${diceButtonsHtml}
        </div>
      </div>

      <div class="as-control-group">
        <label class="as-label">骰點 (Dot / 1~7)：</label>
        <div class="as-dot-button-grid">
          ${dotButtonsHtml}
        </div>
      </div>

      <div class="as-slider-row">
        <div class="as-slider-col">
          <label for="as-range-class" class="as-label">等級 (Class)：${slot?.classLevel || 10}</label>
          <input type="range" id="as-range-class" min="7" max="15" value="${slot?.classLevel || 10}">
        </div>
        <div class="as-slider-col">
          <label for="as-range-powerup" class="as-label">強化 (PowerUp)：${slot?.powerUpLevel || 5}</label>
          <input type="range" id="as-range-powerup" min="1" max="5" value="${slot?.powerUpLevel || 5}">
        </div>
      </div>
    `;
  }

  _getSelectedSlotIndex() {
    return this.store?.getState()?.attackSpeed?.selectedSlotIndex ?? null;
  }

  _getBoard() {
    return this.store?.getState()?.attackSpeed?.board || [];
  }

  destroy() {
    if (this._triggerBtn && this._onTriggerClick) {
      this._triggerBtn.removeEventListener("click", this._onTriggerClick);
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    window.removeEventListener("keydown", this._handleKeyDown);
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}

