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
