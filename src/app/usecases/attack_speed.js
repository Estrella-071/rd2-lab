/**
 * @fileoverview 戰場攻擊速度計算器應用用例 (Application Layer)
 * @module app/usecases/attack_speed
 */

import {
  evaluateBattlefieldTarget,
  TOTAL_BATTLEFIELD_SLOTS
} from "../../domain/attack_speed.js";
import { ActionTypes } from "../store/app_store.js";

export class AttackSpeedUseCase {
  /**
   * @param {Object} dependencies
   * @param {Object} dependencies.store 應用狀態中心
   */
  constructor({ store }) {
    this.store = store;
  }

  /**
   * 開啟攻速計算器
   */
  open() {
    this._mutateState((draft) => {
      draft.attackSpeed = draft.attackSpeed || this.getDefaultState();
      draft.attackSpeed.isOpen = true;
      this._recalculateTarget(draft.attackSpeed, draft);
    });
  }

  /**
   * 關閉攻速計算器
   */
  close() {
    this._mutateState((draft) => {
      if (draft.attackSpeed) {
        draft.attackSpeed.isOpen = false;
      }
    });
  }

  /**
   * 選中指定格位 (供彈窗設定或編輯)
   * @param {number} slotIndex
   */
  selectSlot(slotIndex) {
    this._mutateState((draft) => {
      if (!draft.attackSpeed) draft.attackSpeed = this.getDefaultState();
      draft.attackSpeed.selectedSlotIndex = slotIndex;
    });
  }

  /**
   * 將指定格位設為攻速測算目標
   * @param {number} slotIndex
   */
  setTargetSlot(slotIndex) {
    this._mutateState((draft) => {
      if (!draft.attackSpeed) draft.attackSpeed = this.getDefaultState();
      draft.attackSpeed.targetSlotIndex = slotIndex;
      this._recalculateTarget(draft.attackSpeed, draft);
    });
  }

  /**
   * 更新指定格位的骰子配置
   * @param {number} slotIndex
   * @param {Object|null} diceConfig
   */
  setSlotDice(slotIndex, diceConfig) {
    if (slotIndex < 0 || slotIndex >= TOTAL_BATTLEFIELD_SLOTS) return;
    this._mutateState((draft) => {
      if (!draft.attackSpeed) draft.attackSpeed = this.getDefaultState();
      draft.attackSpeed.board[slotIndex] = diceConfig ? { ...diceConfig } : null;
      this._recalculateTarget(draft.attackSpeed, draft);
    });
  }

  /**
   * 清空指定格位
   * @param {number} slotIndex
   */
  clearSlot(slotIndex) {
    this.setSlotDice(slotIndex, null);
  }

  /**
   * 設定目標骰子自訂基礎間隔 (秒)
   * @param {number} interval
   */
  setCustomBaseInterval(interval) {
    this._mutateState((draft) => {
      if (!draft.attackSpeed) draft.attackSpeed = this.getDefaultState();
      draft.attackSpeed.customBaseInterval = Math.max(0.01, Number(interval) || 1.0);
      this._recalculateTarget(draft.attackSpeed, draft);
    });
  }

  /**
   * 載入常見戰術盤面預設
   * @param {"solar_light_cross"|"moon_resonance"|"empty"} presetName
   */
  loadPreset(presetName) {
    this._mutateState((draft) => {
      if (!draft.attackSpeed) draft.attackSpeed = this.getDefaultState();
      const board = Array(TOTAL_BATTLEFIELD_SLOTS).fill(null);

      if (presetName === "solar_light_cross") {
        // 中央 7 放 7 星太陽
        board[7] = {
          id: "solar",
          diceName: "太陽",
          type: "attacker",
          dot: 7,
          classLevel: 10,
          powerUpLevel: 5,
          baseInterval: 0.6
        };
        // 十字格位 2, 6, 8, 12 放 7 星光骰子
        const lightIndices = [2, 6, 8, 12];
        for (const idx of lightIndices) {
          board[idx] = {
            id: "dice_light",
            diceName: "光",
            type: "light",
            dot: 7,
            classLevel: 10,
            powerUpLevel: 5
          };
        }
        draft.attackSpeed.targetSlotIndex = 7;
        draft.attackSpeed.customBaseInterval = 0.6;
      } else if (presetName === "moon_resonance") {
        // 共鳴陣容：中央共鳴與四周同為 7 點
        board[7] = {
          id: "attacker",
          diceName: "風",
          type: "attacker",
          dot: 7,
          classLevel: 10,
          powerUpLevel: 5,
          baseInterval: 0.2
        };
        board[6] = {
          id: "dice_resonance",
          diceName: "共鳴",
          type: "resonance",
          dot: 7,
          classLevel: 10,
          powerUpLevel: 5
        };
        board[1] = { id: "p1", diceName: "風", type: "attacker", dot: 7 };
        board[11] = { id: "p2", diceName: "風", type: "attacker", dot: 7 };
        draft.attackSpeed.targetSlotIndex = 7;
        draft.attackSpeed.customBaseInterval = 0.2;
      }

      draft.attackSpeed.board = board;
      this._recalculateTarget(draft.attackSpeed, draft);
    });
  }

  /**
   * 預設初始狀態
   */
  getDefaultState() {
    const board = Array(TOTAL_BATTLEFIELD_SLOTS).fill(null);
    // 預設在中央格放入一顆 7 星太陽骰子
    board[7] = {
      id: "solar",
      diceName: "太陽",
      type: "attacker",
      dot: 7,
      classLevel: 10,
      powerUpLevel: 5,
      baseInterval: 0.6
    };
    // 預設在上方放置一顆 7 星光骰子
    board[2] = {
      id: "dice_light",
      diceName: "光",
      type: "light",
      dot: 7,
      classLevel: 10,
      powerUpLevel: 5
    };

    return {
      isOpen: false,
      board,
      selectedSlotIndex: null,
      targetSlotIndex: 7,
      customBaseInterval: 0.6,
      blessingBonusRate: 0.15,
      eventBonusRate: 0,
      currentEvaluation: null
    };
  }

  _recalculateTarget(asState, rootState) {
    if (!asState) return;
    const treeBonusRate = this._extractTreeAtkSpeedBonus(rootState);
    asState.currentEvaluation = evaluateBattlefieldTarget({
      board: asState.board || [],
      targetIndex: asState.targetSlotIndex ?? 7,
      customBaseInterval: asState.customBaseInterval || 0.6,
      treeBonusRate,
      blessingBonusRate: asState.blessingBonusRate || 0,
      eventBonusRate: asState.eventBonusRate || 0
    });
  }

  _extractTreeAtkSpeedBonus(rootState) {
    if (!rootState?.simulation?.ranks || !rootState?.treeData?.nodes) return 0;
    let sumRate = 0;
    const ranks = rootState.simulation.ranks;
    const nodes = rootState.treeData.nodes;
    for (const node of nodes) {
      const rank = ranks[node.id];
      if (rank > 0 && node.statType === "atk_speed") {
        sumRate += (Number(node.statValue) || 0) * rank;
      }
    }
    return sumRate / 100;
  }

  _mutateState(updater) {
    if (!this.store) return;
    const state = this.store.getState();
    const currentAttackSpeed = state.attackSpeed || this.getDefaultState();
    const draftState = {
      attackSpeed: JSON.parse(JSON.stringify(currentAttackSpeed)),
      simulation: state.simulation,
      treeData: state.treeData
    };
    updater(draftState);
    this.store.dispatch({
      type: ActionTypes.SET_ATTACK_SPEED_STATE,
      payload: draftState.attackSpeed
    });
  }
}
