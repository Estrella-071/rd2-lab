import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  calculateBonus,
  calcBonus,
  formatBonusDisplay,
  calculateStatBonusPair,
  calculateAttackIntervalBonus,
  calculateFullDiceBonus,
  calculateDiceBonus,
  POWERUP_LABELS,
  DOT_LABELS,
  MAX_POWERUP_INDEX,
  MAX_DOT_INDEX,
  MIN_ATTACK_INTERVAL_SECONDS
} from "../../src/domain/dice_bonus.js";

const canonicalTree = JSON.parse(
  fs.readFileSync(new URL("../../site/data/dice_tree.json", import.meta.url), "utf8")
);

test("dice_bonus: 常數陣列長度與邊界索引", () => {
  assert.equal(POWERUP_LABELS.length, 15);
  assert.equal(DOT_LABELS.length, 7);
  assert.equal(MAX_POWERUP_INDEX, 14);
  assert.equal(MAX_DOT_INDEX, 6);
  assert.equal(POWERUP_LABELS[0], "強化");
  assert.equal(POWERUP_LABELS[14], "Max");
  assert.equal(DOT_LABELS[0], "提升骰點");
  assert.equal(DOT_LABELS[6], "7");
});

test("dice_bonus: DB-01 正數乘數基本計算", () => {
  assert.equal(calculateBonus("+150", 2), "+300");
  assert.equal(calculateBonus("+150", 3), "+450");
  assert.equal(calcBonus(100, 4), "+400");
  assert.equal(calcBonus("+20", 1), "+20");
});

test("dice_bonus: DB-02 乘數為 0 或負數時回傳空字串", () => {
  assert.equal(calculateBonus("+150", 0), "");
  assert.equal(calculateBonus("+150", -1), "");
  assert.equal(calculateBonus("+150", -5), "");
});

test("dice_bonus: DB-03 空值、null、undefined 與無效字串容錯", () => {
  assert.equal(calculateBonus("", 3), "");
  assert.equal(calculateBonus(null, 3), "");
  assert.equal(calculateBonus(undefined, 3), "");
  assert.equal(calculateBonus("invalid_text", 3), "");
});

test("dice_bonus: DB-04 基礎增量為 0 時回傳空字串", () => {
  assert.equal(calculateBonus("0", 3), "");
  assert.equal(calculateBonus("+0", 5), "");
  assert.equal(calculateBonus(0, 2), "");
});

test("dice_bonus: DB-05 負數增量計算保留負號且不加 + 號", () => {
  assert.equal(calculateBonus("-0.05", 2), "-0.1");
  assert.equal(calculateBonus("-10", 3), "-30");
  assert.equal(calculateBonus("-0.005", 2), "-0.01");
});

test("dice_bonus: DB-06 4 位小數精度四捨五入與無效 0 去除", () => {
  assert.equal(calculateBonus("+0.333333", 3), "+1");
  assert.equal(calculateBonus("0.12345", 1), "+0.1235");
  assert.equal(calculateBonus("+0.12344", 1), "+0.1234");
  assert.equal(calculateBonus("+1.5000", 2), "+3");
});

test("dice_bonus: DB-07 極小浮點數精度衰減", () => {
  assert.equal(calculateBonus("0.0001", 2), "+0.0002");
  assert.equal(calculateBonus("0.00004", 1), "");
});

test("dice_bonus: DB-08 & DB-09 最大強化與最大骰點邊界計算", () => {
  assert.equal(calculateBonus("+20", MAX_POWERUP_INDEX), "+280");
  assert.equal(calculateBonus("+100", MAX_DOT_INDEX), "+600");
});

test("dice_bonus: formatBonusDisplay 格式化顯示", () => {
  assert.equal(formatBonusDisplay("+300"), " (+300)");
  assert.equal(formatBonusDisplay("-0.1"), " (-0.1)");
  assert.equal(formatBonusDisplay(""), "");
});

test("dice_bonus: DB-10 calculateFullDiceBonus 雙軸計算與同號合併", () => {
  const mockNode = {
    dice_attack_interval: "1",
    powerup_data: {
      attack_add: "+20",
      interval_add: "-0.02",
      special_stats: [{ add: "+5%" }]
    },
    dot_data: {
      attack_add: "+50",
      interval_add: "",
      special_stats: [{ add: "+10%" }]
    }
  };

  // 1. 未激活 (0, 0)
  const initial = calculateFullDiceBonus(mockNode, 0, 0);
  assert.equal(initial.isPowerupActive, false);
  assert.equal(initial.isDotActive, false);
  assert.equal(initial.attackBonus.powerupBonus, "");
  assert.equal(initial.attackBonus.dotBonus, "");
  assert.equal(initial.attackBonus.powerupDisplay, "");
  assert.equal(initial.attackBonus.dotDisplay, "");

  // 2. 雙軸激活 (Powerup 14 Max, Dot 6 Max)
  const fullMax = calculateDiceBonus(mockNode, 14, 6);
  assert.equal(fullMax.powerupIdx, 14);
  assert.equal(fullMax.powerupLabel, "Max");
  assert.equal(fullMax.isPowerupActive, true);
  assert.equal(fullMax.dotIdx, 6);
  assert.equal(fullMax.dotLabel, "7");
  assert.equal(fullMax.isDotActive, true);

  assert.equal(fullMax.attackBonus.powerupBonus, "+280");
  assert.equal(fullMax.attackBonus.dotBonus, "+300");
  assert.equal(fullMax.attackBonus.powerupDisplay, " (+280)");
  assert.equal(fullMax.attackBonus.dotDisplay, " (+300)");
  assert.equal(fullMax.attackBonus.combinedBonus, "+580");
  assert.equal(fullMax.attackBonus.combinedDisplay, " (+580)");

  assert.equal(fullMax.intervalBonus.powerupBonus, "-0.28");
  assert.equal(fullMax.intervalBonus.dotBonus, "-0.6171");
  assert.equal(fullMax.intervalBonus.combinedBonus, "-0.8971");
  assert.equal(fullMax.intervalBonus.combinedDisplay, " (-0.8971)");

  assert.equal(fullMax.specialStatsBonus.length, 1);
  assert.equal(fullMax.specialStatsBonus[0].powerupBonus, "+70");
  assert.equal(fullMax.specialStatsBonus[0].dotBonus, "+60");
  assert.equal(fullMax.specialStatsBonus[0].combinedBonus, "+130");
  assert.equal(fullMax.specialStatsBonus[0].combinedDisplay, " (+130)");
});

test("dice_bonus: DB-11 普通骰子的攻擊間隔依骰點數等比分割", () => {
  const dot2 = calculateAttackIntervalBonus("1", "", 0, 1);
  assert.equal(dot2.powerupBonus, "");
  assert.equal(dot2.dotBonus, "-0.5");
  assert.equal(dot2.dotDisplay, " (-0.5)");

  const dot7 = calculateAttackIntervalBonus("1", "", 0, 6);
  assert.equal(dot7.dotBonus, "-0.8571");
});

test("dice_bonus: DB-12 強化修正先套用，再依骰點數分割間隔", () => {
  const windDot2 = calculateAttackIntervalBonus("0.45", "-0.025", 1, 1);
  assert.equal(windDot2.powerupBonus, "-0.025");
  assert.equal(windDot2.dotBonus, "-0.2125");

  const capped = calculateAttackIntervalBonus("0.02", "", 0, 6);
  assert.equal(MIN_ATTACK_INTERVAL_SECONDS, 0.01);
  assert.equal(capped.dotBonus, "-0.01");
});

test("dice_bonus: DB-13 canonical 骰子資料保留強化修正並由公式處理骰點攻速", () => {
  const dice = canonicalTree.nodes.filter((node) => node.node_type === "DICE");
  const intervalPowerups = dice
    .filter((node) => node.powerup_data?.interval_add)
    .map((node) => [node.dice_type, node.powerup_data.interval_add]);

  assert.deepEqual(intervalPowerups, [
    ["Wind", "-0.025"],
    ["Ray", "-0.05"],
    ["Predator", "-0.08"],
    ["Death", "-0.07"]
  ]);
  assert.equal(dice.some((node) => node.dot_data?.interval_add), false);

  const attackingDice = dice.filter((node) => Number(node.dice_attack_interval) > 0);
  const nonAttackingDice = dice.filter((node) => Number(node.dice_attack_interval) <= 0);
  assert.equal(attackingDice.length, 36);
  assert.equal(nonAttackingDice.length, 5);
  assert.equal(
    attackingDice.every((node) => calculateFullDiceBonus(node, 0, 1).intervalBonus.dotBonus.startsWith("-")),
    true
  );
  assert.equal(
    nonAttackingDice.every((node) => calculateFullDiceBonus(node, 0, 1).intervalBonus.dotBonus === ""),
    true
  );
});
