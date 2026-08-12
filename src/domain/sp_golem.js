/**
 * @fileoverview SP 魔像 (monster_14) 1/30 階 3 屬性同步與反向計算純領域模組
 * @module domain/sp_golem
 */

export const GOLEM_MONSTER_ID = "monster_14";
export const GOLEM_MIN_RANK = 1;
export const GOLEM_MAX_RANK = 30;
export const GOLEM_SP_CAP_RANK = 20;
export const GOLEM_SP_CAP_VALUE = 10000;
export const GOLEM_HP_PER_RANK = 50;
export const GOLEM_SP_PER_RANK = 500;

/**
 * 數值千分位純字串格式化 (不依賴 Intl 或瀏覽器環境)
 * @param {number} num
 * @returns {string}
 */
export function formatThousands(num) {
  if (!Number.isFinite(num)) return String(num);
  const parts = String(num).split(".");
  const sign = parts[0].startsWith("-") ? "-" : "";
  const digits = sign ? parts[0].slice(1) : parts[0];
  const grouped = [];
  for (let end = digits.length; end > 0; end -= 3) {
    grouped.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  parts[0] = `${sign}${grouped.join(",")}`;
  return parts.join(".");
}

/**
 * 限制 Rank 在 1~30 範圍內之整數
 * @param {number|string} rank
 * @returns {number}
 */
export function clampGolemRank(rank) {
  const num = typeof rank === "number" ? rank : Number.parseInt(rank, 10);
  if (Number.isNaN(num)) return GOLEM_MIN_RANK;
  return Math.max(GOLEM_MIN_RANK, Math.min(GOLEM_MAX_RANK, Math.floor(num)));
}

/**
 * 計算 SP 魔像在指定 Rank 下的 3 屬性完整狀態 (純函式)
 *
 * @param {number|string} rank - 階級 (1~30)
 * @returns {Object}
 */
export function calculateGolemStats(rank) {
  const r = clampGolemRank(rank);

  // 1. 生命值百分比: Rank * 50% (50% ~ 1500%)
  const hpPercent = r * GOLEM_HP_PER_RANK;
  const hpDisplay = `${formatThousands(hpPercent)}%`;

  // 2. 合作與競技 SP: Rank < 20 ? Rank * 500 : 10000
  const spValue = r >= GOLEM_SP_CAP_RANK ? GOLEM_SP_CAP_VALUE : r * GOLEM_SP_PER_RANK;
  const spDisplay = `${formatThousands(spValue)} SP`;

  // 3. 階段標籤: Rank 30 為 "Max", 其餘為 "R/30"
  const stageLabel = r === GOLEM_MAX_RANK ? "Max" : `${r}/${GOLEM_MAX_RANK}`;
  const isMax = r === GOLEM_MAX_RANK;
  const isCapped = r >= GOLEM_SP_CAP_RANK;
  const sliderProgressPercent = ((r - GOLEM_MIN_RANK) / (GOLEM_MAX_RANK - GOLEM_MIN_RANK)) * 100;

  return {
    rank: r,
    hpPercent,
    lifePercent: hpPercent,
    hpDisplay,
    lifeDisplay: hpDisplay,
    coopSp: spValue,
    battleSp: spValue,
    coopSpDisplay: spDisplay,
    battleSpDisplay: spDisplay,
    spDisplay,
    stageLabel,
    isMax,
    isCapped,
    sliderProgressPercent
  };
}

/**
 * 由生命值百分比反算魔像階級 (純函式)
 * @param {number} hpPercent - 例如 50, 500, 1500
 * @returns {number} 階級 (1~30)
 */
export function deriveRankFromHpPercent(hpPercent) {
  if (!Number.isFinite(hpPercent) || hpPercent <= 0) return GOLEM_MIN_RANK;
  return clampGolemRank(Math.round(hpPercent / GOLEM_HP_PER_RANK));
}

export const getGolemRankFromHp = deriveRankFromHpPercent;
export const inferRankFromLifePercent = deriveRankFromHpPercent;

/**
 * 由 SP 掉落數值反算魔像階級 (純函式)
 * 注意：當 SP 為 10,000 時，若提供 currentRank 且在 20~30 區間則保持，否則回傳 20。
 * @param {number} sp - 例如 500, 5000, 10000
 * @param {number} [currentRank]
 * @returns {number} 階級 (1~30)
 */
export function deriveRankFromSp(sp, currentRank) {
  if (!Number.isFinite(sp) || sp <= 0) return GOLEM_MIN_RANK;
  if (sp >= GOLEM_SP_CAP_VALUE) {
    if (typeof currentRank === "number" && currentRank >= GOLEM_SP_CAP_RANK && currentRank <= GOLEM_MAX_RANK) {
      return currentRank;
    }
    return GOLEM_SP_CAP_RANK;
  }
  return clampGolemRank(Math.round(sp / GOLEM_SP_PER_RANK));
}

export const getGolemRankFromSp = deriveRankFromSp;
export const inferRankFromCoopSp = deriveRankFromSp;
export const inferRankFromBattleSp = deriveRankFromSp;

/**
 * 支援從任何屬性變更點發起 3 屬性同步的協調器 (純函式)
 *
 * @param {"rank"|"hp"|"coopSp"|"battleSp"} sourceType - 變更來源屬性
 * @param {number} value - 變更數值
 * @param {number} [currentRank] - 當前階級 (用於 SP 封頂時保持)
 * @returns {Object} 同步後的完整 3 屬性狀態
 */
export function synchronizeGolemStats(sourceType, value, currentRank) {
  let targetRank;
  switch (sourceType) {
    case "hp":
    case "lifePercent":
      targetRank = deriveRankFromHpPercent(value);
      break;
    case "coopSp":
    case "battleSp":
      targetRank = deriveRankFromSp(value, currentRank);
      break;
    case "rank":
    default:
      targetRank = clampGolemRank(value);
      break;
  }
  return calculateGolemStats(targetRank);
}
