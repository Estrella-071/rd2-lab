/**
 * @fileoverview 裂縫商店 (Rift Shop) 戰術效果領域分類模組 (Zero Dependencies)
 * @module domain/rift_shop_categories
 */

export const RIFT_SHOP_CATEGORIES = Object.freeze([
  {
    key: "damage",
    i18nKey: "compendium.riftTypeDamage",
    color: "#f6ad55",
    surface: "rgba(246, 173, 85, 0.14)",
    border: "rgba(246, 173, 85, 0.4)",
    defaultName: "增傷效果"
  },
  {
    key: "sp",
    i18nKey: "compendium.riftTypeSp",
    color: "#68d391",
    surface: "rgba(104, 211, 145, 0.14)",
    border: "rgba(104, 211, 145, 0.4)",
    defaultName: "SP效果"
  },
  {
    key: "board",
    i18nKey: "compendium.riftTypeBoard",
    color: "#4591f0",
    surface: "rgba(69, 145, 240, 0.14)",
    border: "rgba(69, 145, 240, 0.4)",
    defaultName: "骰盤效果"
  },
  {
    key: "field",
    i18nKey: "compendium.riftTypeField",
    color: "#b794f4",
    surface: "rgba(183, 148, 244, 0.14)",
    border: "rgba(183, 148, 244, 0.4)",
    defaultName: "場地效果"
  }
]);

const DAMAGE_KINDS = new Set([
  "FieldAttackUp",
  "CritDamageUp",
  "BossDamageUp",
  "AmplifyDamageByNAtTenHP",
  "GolemDamageUp",
  "AttackUpByMWhenSevenPipsNOrMore",
  "AmplifySevenPipDamageByN",
  "AmplifyDamageByNPerEmptySpace",
  "QueensSeatBuff"
]);

const SP_KINDS = new Set([
  "KillSpUp",
  "GolemKillSpUp",
  "GolemHitSpGain",
  "GolemEscapeSpGain",
  "GainNSp"
]);

const BOARD_KINDS = new Set([
  "SwapMaxMinDicePip",
  "UnifyDiceTypesToN1",
  "UnifyDiceTypesToN2",
  "ChangeTopNRowsToSameDice1",
  "ChangeTopNRowsToSameDice2",
  "ChangeTopNRowsToSameDice3",
  "UpgradeNLowestDicePipByM1",
  "UpgradeNLowestDicePipByM2",
  "UpgradeNLowestDicePipByM3",
  "FixNextNSummonsToJoker",
  "RandomDicePowerUp",
  "TransformNDiceToJoker",
  "UnifyToMostFrequentType",
  "UnifyToLeastFrequentType",
  "UpgradeNSixPipsByOne"
]);

const FIELD_KINDS = new Set([
  "MinionSpeedDown",
  "SummonMiracleStone",
  "SummonNMines",
  "KillMinionsExceptBoss",
  "SpawnNMiningTiles",
  "ResetSupporterCooldown"
]);

/**
 * 將裂縫商店技能的 kind 映射至 4 大效果類型之一
 * @param {string} rawKind - 技能的 kind (如 CritDamageUpMid, GainNSpLow 等)
 * @returns {"damage"|"sp"|"board"|"field"}
 */
export function classifyRiftTactic(rawKind) {
  if (!rawKind || typeof rawKind !== "string") return "field";
  const baseKind = rawKind.replace(/(Low|Mid|High)$/, "");

  if (DAMAGE_KINDS.has(baseKind)) return "damage";
  if (SP_KINDS.has(baseKind)) return "sp";
  if (BOARD_KINDS.has(baseKind)) return "board";
  if (FIELD_KINDS.has(baseKind)) return "field";

  return "field";
}

const GRADE_ORDER = Object.freeze({
  Common: 1,
  Rare: 2,
  Legendary: 3
});

/**
 * 格式化單一數值（若為數字則加上逗號）
 * @param {number|string} val
 * @returns {string}
 */
function formatNumberValue(val) {
  if (typeof val === "number") {
    return val.toLocaleString("en-US");
  }
  return String(val ?? "");
}

/**
 * 將裂縫商店同效果的佔位符數值合併，數值不同時以 " / " 分隔
 * @param {Array<Object>} group - 同類別同名稱的裂縫商店項目
 * @param {string} [loc="zh-tw"] - 語言代碼
 * @returns {string}
 */
export function buildMergedDescription(group, loc = "zh-tw") {
  if (!Array.isArray(group) || group.length === 0) return "";
  const template = group[0].descriptions?.[loc] || group[0].descriptions?.["zh-tw"] || "";

  return template.replace(/\{([0-3])\}/g, (token, i) => {
    const idx = parseInt(i, 10);
    const vals = group.map((item) => item.values?.[idx]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) return token;
    const uniqueVals = [...new Set(vals)];
    if (uniqueVals.length === 1) {
      return formatNumberValue(uniqueVals[0]);
    }
    return vals.map((v) => formatNumberValue(v)).join(" / ");
  });
}

/**
 * 在按類型分類時，將相同的裂縫商店技能合併為聚合項目
 * @param {Array<Object>} items - 原始裂縫商店技能清單
 * @returns {Array<Object>} 合併後的裂縫商店技能清單
 */
export function mergeRiftShopItems(items) {
  if (!Array.isArray(items)) return [];

  const groupsMap = new Map();
  for (const item of items) {
    const baseKind = String(item.kind || "").replace(/(Low|Mid|High)$/, "");
    if (!groupsMap.has(baseKind)) {
      groupsMap.set(baseKind, []);
    }
    groupsMap.get(baseKind).push(item);
  }

  const result = [];
  for (const [baseKind, group] of groupsMap.entries()) {
    // 依品質排序 (Common -> Rare -> Legendary)
    group.sort((a, b) => (GRADE_ORDER[a.grade] || 99) - (GRADE_ORDER[b.grade] || 99));

    const grades = group.map((i) => i.grade).filter(Boolean);
    const costs = group.map((i) => i.cost);
    const uniqueCosts = [...new Set(costs)];
    const costText = uniqueCosts.length === 1 ? String(costs[0]) : costs.join(" / ");

    result.push({
      id: group[0].id,
      baseKind,
      kind: group[0].kind,
      grade: group[0].grade,
      grades,
      costs,
      costText,
      names: group[0].names,
      descriptions: group[0].descriptions,
      target: group[0].target,
      items: group,
      isMerged: group.length > 1,
      getMergedDescription: (loc) => buildMergedDescription(group, loc)
    });
  }

  return result;
}

