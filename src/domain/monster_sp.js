/**
 * @fileoverview 怪物與波次 SP 掉落分階純計算模組
 * @module domain/monster_sp
 */

import { formatThousands } from "./sp_golem.js";

/**
 * 合作模式 SP 變更起始波次清單 (共 7 階)
 * @type {readonly number[]}
 */
export const COOP_SP_STAGES = Object.freeze([1, 11, 21, 31, 46, 56, 65]);

/**
 * 合作模式 7 階基準 SP 掉落量
 * @type {readonly number[]}
 */
export const COOP_NORMAL_SP = Object.freeze([20, 30, 40, 50, 60, 70, 80]);

/**
 * 競技模式 11 回合清單
 * @type {readonly number[]}
 */
export const VERSUS_SP_STAGES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

/**
 * 競技模式 11 回合基準 SP 掉落量 (第 1 回合 10 SP，每回合遞增 2 SP)
 * @type {readonly number[]}
 */
export const VERSUS_NORMAL_SP = Object.freeze([10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);

export const COOP_STAGE_COUNT = COOP_SP_STAGES.length;
export const VERSUS_STAGE_COUNT = VERSUS_SP_STAGES.length;

/**
 * 取得怪物有效的 sp_per 百分比係數 (純函式)
 * @param {Object} [monster] - 怪物資料物件
 * @returns {number} sp_per 係數 (例如 100, 1000 等)
 */
export function resolveMonsterSpPer(monster) {
  if (monster && typeof monster.sp_per === "number") {
    return monster.sp_per;
  }
  const isBoss = monster?.subType === "BOSS" || monster?.category === "BOSS";
  return isBoss ? 1000 : 100;
}

/**
 * 計算合作模式特定階段的 SP 掉落量 (純函式)
 *
 * @param {number} stageRank - 階段階級 (1~7)
 * @param {number} [spPer=100] - 怪物 SP 係數百分比
 * @returns {number} 掉落 SP 整數數值
 */
export function calculateCoopSp(stageRank, spPer = 100) {
  const num = typeof stageRank === "number" ? stageRank : Number.parseInt(stageRank, 10) || 1;
  const r = Math.max(1, Math.min(COOP_STAGE_COUNT, Math.floor(num)));
  const baseSp = COOP_NORMAL_SP[r - 1];
  const factor = typeof spPer === "number" ? spPer : 100;
  return Math.round((baseSp * factor) / 100);
}

export const calculateMonsterCoopSp = calculateCoopSp;

/**
 * 計算競技模式特定回合的 SP 掉落量 (純函式)
 *
 * @param {number} roundRank - 回合階級 (1~11)
 * @param {number} [spPer=100] - 怪物 SP 係數百分比
 * @returns {number} 掉落 SP 整數數值
 */
export function calculateVersusSp(roundRank, spPer = 100) {
  const num = typeof roundRank === "number" ? roundRank : Number.parseInt(roundRank, 10) || 1;
  const r = Math.max(1, Math.min(VERSUS_STAGE_COUNT, Math.floor(num)));
  const baseSp = VERSUS_NORMAL_SP[r - 1];
  const factor = typeof spPer === "number" ? spPer : 100;
  return Math.round((baseSp * factor) / 100);
}

export const calculateMonsterVersusSp = calculateVersusSp;

/**
 * 取得合作模式單一階級的詳細 SP 資訊 (純函式)
 * @param {number} rank - 階級 (1~7)
 * @param {number} [spPer=100] - SP 係數
 * @returns {Object}
 */
export function getCoopStageInfo(rank, spPer = 100) {
  const r = Math.max(1, Math.min(COOP_STAGE_COUNT, Math.floor(rank || 1)));
  const spValue = calculateCoopSp(r, spPer);
  return {
    rank: r,
    rankCount: COOP_STAGE_COUNT,
    spValue,
    displayValue: `${formatThousands(spValue)} SP`,
    stageLabel: `${r}/${COOP_STAGE_COUNT}`,
    startWaveOrRound: COOP_SP_STAGES[r - 1]
  };
}

/**
 * 取得競技模式單一階級的詳細 SP 資訊 (純函式)
 * @param {number} rank - 回合 (1~11)
 * @param {number} [spPer=100] - SP 係數
 * @returns {Object}
 */
export function getVersusStageInfo(rank, spPer = 100) {
  const r = Math.max(1, Math.min(VERSUS_STAGE_COUNT, Math.floor(rank || 1)));
  const spValue = calculateVersusSp(r, spPer);
  return {
    rank: r,
    rankCount: VERSUS_STAGE_COUNT,
    spValue,
    displayValue: `${formatThousands(spValue)} SP`,
    stageLabel: `${r}/${VERSUS_STAGE_COUNT}`,
    startWaveOrRound: VERSUS_SP_STAGES[r - 1]
  };
}

/**
 * 描述怪物在指定模式下的 SP 掉落欄位呈現特徵 (純函式)
 *
 * @param {Object} monster - 怪物物件
 * @param {"coop"|"versus"} mode - 遊戲模式
 * @returns {Object}
 */
export function describeMonsterSp(monster, mode) {
  if (monster?.subType === "BOX") {
    return {
      isBox: true,
      isGolem: false,
      isRankable: false,
      isSpecial: true,
      rankCount: null,
      initialDisplay: "依效果",
      displayValue: "依效果",
      note: "由轉移／貪婪效果決定"
    };
  }

  if (monster?.id === "monster_14") {
    return {
      isBox: false,
      isGolem: true,
      isRankable: true,
      isSpecial: false,
      rankCount: 30,
      initialDisplay: "500 SP",
      displayValue: "500 SP",
      note: ""
    };
  }

  const spPer = resolveMonsterSpPer(monster);
  const isCoop = mode === "coop";
  const info = isCoop ? getCoopStageInfo(1, spPer) : getVersusStageInfo(1, spPer);

  return {
    isBox: false,
    isGolem: false,
    isRankable: true,
    isSpecial: false,
    rankCount: isCoop ? COOP_STAGE_COUNT : VERSUS_STAGE_COUNT,
    initialDisplay: info.displayValue,
    displayValue: info.displayValue,
    note: ""
  };
}

/**
 * 解析怪物 SP 呈現結構
 * @param {Object} monster
 * @param {"coop"|"versus"} mode
 * @param {number} [rankOrStage=1]
 * @returns {Object}
 */
export function resolveMonsterSpDisplay(monster, mode, rankOrStage = 1) {
  if (monster?.subType === "BOX") {
    return {
      displayValue: "依效果",
      isSpecial: true,
      note: "由轉移／貪婪效果決定"
    };
  }

  if (monster?.id === "monster_14") {
    const sp = rankOrStage >= 20 ? 10000 : rankOrStage * 500;
    return {
      displayValue: `${formatThousands(sp)} SP`,
      isSpecial: false,
      note: ""
    };
  }

  const spPer = resolveMonsterSpPer(monster);
  const isCoop = mode === "coop";
  const info = isCoop ? getCoopStageInfo(rankOrStage, spPer) : getVersusStageInfo(rankOrStage, spPer);

  return {
    displayValue: info.displayValue,
    isSpecial: false,
    note: ""
  };
}

export const calculateMonsterSp = calculateCoopSp;
