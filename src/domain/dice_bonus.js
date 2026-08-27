/**
 * @fileoverview 骰子數值強化 (Power-up) 與骰點 (Dot) 加成純計算模組
 * @module domain/dice_bonus
 */

/**
 * 強化按鈕標籤常數 (Lv.1 未激活 ~ Lv.15 Max)
 * @type {readonly string[]}
 */
export const POWERUP_LABELS = Object.freeze([
  "強化", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "Max"
]);

/**
 * 骰點按鈕標籤常數 (Dot 1 未激活 ~ Dot 7)
 * @type {readonly string[]}
 */
export const DOT_LABELS = Object.freeze([
  "提升骰點", "2", "3", "4", "5", "6", "7"
]);

/**
 * 最大強化等級索引 (0~14)
 * @type {number}
 */
export const MAX_POWERUP_INDEX = POWERUP_LABELS.length - 1;

/**
 * 最大骰點索引 (0~6)
 * @type {number}
 */
export const MAX_DOT_INDEX = DOT_LABELS.length - 1;

/**
 * 客戶端定義的最短攻擊間隔（秒）。
 * @type {number}
 */
export const MIN_ATTACK_INTERVAL_SECONDS = 0.01;

/**
 * 計算單一屬性加成字串 (純函式)
 * 格式化為最多 4 位小數，自動去除末尾無效 0，正數補 "+" 號，負數保留 "-" 號。
 *
 * @param {string|number|null|undefined} baseAddStr - 基礎增量數值或字串 (例如 "+150", "-0.05", 10)
 * @param {number} mult - 乘數 (Power-up 等級索引 0~14 或 Dot 索引 0~6)
 * @returns {string} 格式化後的加成文字 (例如 "+300", "-0.1")，若無增量或乘數 <= 0 則回傳空字串 ""
 */
export function calculateBonus(baseAddStr, mult) {
  if (baseAddStr === null || baseAddStr === undefined || baseAddStr === "" || mult <= 0) {
    return "";
  }
  const num = typeof baseAddStr === "number" ? baseAddStr : Number.parseFloat(baseAddStr);
  if (Number.isNaN(num) || num === 0) {
    return "";
  }
  const total = num * mult;
  const rounded = Number.parseFloat(total.toFixed(4));
  if (rounded === 0) {
    return "";
  }
  const formatted = rounded.toString();
  return rounded > 0 ? `+${formatted}` : formatted;
}

/**
 * 別名相容
 */
export const calcBonus = calculateBonus;

/**
 * 格式化加成文字為 UI 顯示字串
 * @param {string} bonusText - calculateBonus 回傳之加成字串
 * @returns {string} UI 格式化字串 (例如 " (+300)") 或空字串 ""
 */
export function formatBonusDisplay(bonusText) {
  return bonusText ? ` (${bonusText})` : "";
}

function formatBonusDisplayWithUnit(bonusText, unit = "") {
  return bonusText ? formatBonusDisplay(`${bonusText}${unit || ""}`) : "";
}

/**
 * 合併同一欄位中兩個同號的雙軸加成。
 *
 * 正負混合的加成仍需分開顯示，才能保留不同計算方向。
 * @param {string} powerupBonus - 強化加成文字
 * @param {string} dotBonus - 骰點加成文字
 * @returns {string} 合併後的加成文字，無法合併時回傳空字串
 */
function combineSameSignBonusValues(powerupBonus, dotBonus) {
  const values = [powerupBonus, dotBonus].map((value) => String(value || ""));
  const numbers = values.map((value) => Number(value));
  if (!numbers.every((value) => Number.isFinite(value) && value !== 0)) return "";
  if (Math.sign(numbers[0]) !== Math.sign(numbers[1])) return "";

  const rounded = Number.parseFloat(numbers.reduce((sum, value) => sum + value, 0).toFixed(4));
  if (rounded === 0) return "";
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function statIdentity(stat, index) {
  return stat?.stat_id || stat?.label_key || `index:${index}`;
}

function findStatByIdentity(stats, identity, fallbackIndex) {
  if (identity) {
    const match = stats.find((stat, index) => statIdentity(stat, index) === identity);
    if (match) return match;
  }
  return stats[fallbackIndex];
}

/**
 * @typedef {Object} StatBonusPair
 * @property {string} powerupBonus - 強化加成文字
 * @property {string} dotBonus - 骰點加成文字
 * @property {string} powerupDisplay - 強化 UI 顯示文字
 * @property {string} dotDisplay - 骰點 UI 顯示文字
 * @property {string} combinedBonus - 兩個同號雙軸加成的合併文字
 * @property {string} combinedDisplay - 合併加成的 UI 顯示文字
 */

/**
 * 計算單一屬性之強化與骰點雙軸加成結果 (純函式)
 *
 * @param {string|number|null|undefined} powerupAdd - 強化基礎增量
 * @param {string|number|null|undefined} dotAdd - 骰點基礎增量
 * @param {number} powerupIdx - 強化等級索引 (0~14)
 * @param {number} dotIdx - 骰點等級索引 (0~6)
 * @returns {StatBonusPair}
 */
export function calculateStatBonusPair(powerupAdd, dotAdd, powerupIdx, dotIdx) {
  const powerupBonus = calculateBonus(powerupAdd, powerupIdx);
  const dotBonus = calculateBonus(dotAdd, dotIdx);
  const combinedBonus = combineSameSignBonusValues(powerupBonus, dotBonus);
  return {
    powerupBonus,
    dotBonus,
    powerupDisplay: formatBonusDisplay(powerupBonus),
    dotDisplay: formatBonusDisplay(dotBonus),
    combinedBonus,
    combinedDisplay: formatBonusDisplay(combinedBonus)
  };
}

/**
 * 計算攻擊間隔的強化與骰點加成。
 *
 * DefenderTable only supplies AttackInterval_UpAdd. Dot count is a divisor,
 * not a second linear increment: (base + upAdd × power-up) / dot count.
 *
 * @param {string|number|null|undefined} baseInterval - 1 骰點基礎攻擊間隔
 * @param {string|number|null|undefined} powerupAdd - 每級強化的間隔修正
 * @param {number} powerupIdx - 強化等級索引 (0~14)
 * @param {number} dotIdx - 骰點索引 (0~6)
 * @returns {StatBonusPair}
 */
export function calculateAttackIntervalBonus(baseInterval, powerupAdd, powerupIdx, dotIdx) {
  const powerupBonus = calculateBonus(powerupAdd, powerupIdx);
  const parsedBase = typeof baseInterval === "number" ? baseInterval : Number.parseFloat(baseInterval);
  const parsedPowerupAdd = typeof powerupAdd === "number" ? powerupAdd : Number.parseFloat(powerupAdd);
  const powerupDelta = Number.isFinite(parsedPowerupAdd) ? parsedPowerupAdd * powerupIdx : 0;
  const intervalBeforeDots = Number.isFinite(parsedBase) ? parsedBase + powerupDelta : 0;

  let dotBonus = "";
  if (intervalBeforeDots > 0 && dotIdx > 0) {
    const dotCount = dotIdx + 1;
    const finalInterval = Math.max(MIN_ATTACK_INTERVAL_SECONDS, intervalBeforeDots / dotCount);
    dotBonus = calculateBonus(finalInterval - intervalBeforeDots, 1);
  }

  const combinedBonus = combineSameSignBonusValues(powerupBonus, dotBonus);

  return {
    powerupBonus,
    dotBonus,
    powerupDisplay: formatBonusDisplay(powerupBonus),
    dotDisplay: formatBonusDisplay(dotBonus),
    combinedBonus,
    combinedDisplay: formatBonusDisplay(combinedBonus)
  };
}

/**
 * @typedef {Object} DiceSpecialStatBonus
 * @property {number} index - 特殊屬性索引
 * @property {string} powerupBonus - 強化加成
 * @property {string} dotBonus - 骰點加成
 * @property {string} powerupDisplay - 強化 UI 顯示
 * @property {string} dotDisplay - 骰點 UI 顯示
 * @property {string} combinedBonus - 兩個同號雙軸加成的合併文字
 * @property {string} combinedDisplay - 合併加成的 UI 顯示文字
 */

/**
 * @typedef {Object} FullDiceBonusState
 * @property {number} powerupIdx - 當前強化索引
 * @property {string} powerupLabel - 強化按鈕文字
 * @property {boolean} isPowerupActive - 強化是否處於激活狀態
 * @property {number} dotIdx - 當前骰點索引
 * @property {string} dotLabel - 骰點按鈕文字
 * @property {boolean} isDotActive - 骰點是否處於激活狀態
 * @property {StatBonusPair} attackBonus - 攻擊力加成
 * @property {StatBonusPair} intervalBonus - 攻速間隔加成
 * @property {DiceSpecialStatBonus[]} specialStatsBonus - 特殊屬性加成清單
 * @property {DiceSpecialStatBonus[]} specialBonuses - 特殊屬性別名
 */

/**
 * 計算骰子節點在特定強化等級與骰點下的完整數值加成狀態 (純函式)
 *
 * @param {Object} node - 骰子節點資料物件
 * @param {number} [powerupIdx=0] - 強化索引 (0~14)
 * @param {number} [dotIdx=0] - 骰點索引 (0~6)
 * @returns {FullDiceBonusState}
 */
export function calculateFullDiceBonus(node, powerupIdx = 0, dotIdx = 0) {
  const clampedPowerup = Math.max(0, Math.min(MAX_POWERUP_INDEX, Math.floor(powerupIdx || 0)));
  const clampedDot = Math.max(0, Math.min(MAX_DOT_INDEX, Math.floor(dotIdx || 0)));

  const pData = node?.powerup_data || {};
  const dData = node?.dot_data || {};

  const attackBonus = calculateStatBonusPair(pData.attack_add, dData.attack_add, clampedPowerup, clampedDot);
  const intervalBonus = calculateAttackIntervalBonus(
    node?.dice_attack_interval,
    pData.interval_add,
    clampedPowerup,
    clampedDot
  );

  const baseSpecial = Array.isArray(node?.special_stats) ? node.special_stats : [];
  const pSpecial = Array.isArray(pData.special_stats) ? pData.special_stats : [];
  const dSpecial = Array.isArray(dData.special_stats) ? dData.special_stats : [];
  const maxSpecialLen = Math.max(baseSpecial.length, pSpecial.length, dSpecial.length);

  /** @type {DiceSpecialStatBonus[]} */
  const specialStatsBonus = [];
  for (let i = 0; i < maxSpecialLen; i++) {
    const anchor = baseSpecial[i] || pSpecial[i] || dSpecial[i] || {};
    const identity = statIdentity(anchor, i);
    const pStat = findStatByIdentity(pSpecial, identity, i) || {};
    const dStat = findStatByIdentity(dSpecial, identity, i) || {};
    const pAdd = pStat.add;
    const dAdd = dStat.add;
    const pair = calculateStatBonusPair(pAdd, dAdd, clampedPowerup, clampedDot);
    const unit = anchor.unit || pStat.unit || dStat.unit || "";
    specialStatsBonus.push({
      index: i,
      stat_id: anchor.stat_id || pStat.stat_id || dStat.stat_id || "",
      label_key: anchor.label_key || pStat.label_key || dStat.label_key || "",
      unit,
      powerupBonus: pair.powerupBonus,
      dotBonus: pair.dotBonus,
      powerupDisplay: formatBonusDisplayWithUnit(pair.powerupBonus, unit),
      dotDisplay: formatBonusDisplayWithUnit(pair.dotBonus, unit),
      combinedBonus: pair.combinedBonus,
      combinedDisplay: formatBonusDisplayWithUnit(pair.combinedBonus, unit)
    });
  }

  return {
    powerupIdx: clampedPowerup,
    powerupLabel: POWERUP_LABELS[clampedPowerup],
    isPowerupActive: clampedPowerup > 0,
    dotIdx: clampedDot,
    dotLabel: DOT_LABELS[clampedDot],
    isDotActive: clampedDot > 0,
    attackBonus,
    intervalBonus,
    specialStatsBonus,
    specialBonuses: specialStatsBonus
  };
}

/**
 * 別名相容
 */
export const calculateDiceBonus = calculateFullDiceBonus;
