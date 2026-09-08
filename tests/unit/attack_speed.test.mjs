import test from "node:test";
import assert from "node:assert/strict";
import {
  BATTLEFIELD_ROWS,
  BATTLEFIELD_COLS,
  TOTAL_BATTLEFIELD_SLOTS,
  MIN_ATTACK_INTERVAL,
  getSlotCoords,
  areSlotsAdjacent,
  getAdjacentSlotIndices,
  calculateReductionTime,
  computeAttackSpeed,
  calculateLightDiceBonusRate,
  calculateResonanceBonusRate,
  evaluateBattlefieldTarget
} from "../../src/domain/attack_speed.js";

test("attack_speed: 3x5 棋盤格拓撲與座標換算", () => {
  assert.equal(TOTAL_BATTLEFIELD_SLOTS, 15);
  assert.equal(BATTLEFIELD_ROWS, 3);
  assert.equal(BATTLEFIELD_COLS, 5);

  // 頂點 (0, 0)
  assert.deepEqual(getSlotCoords(0), { row: 0, col: 0 });
  // 中心 (1, 2)
  assert.deepEqual(getSlotCoords(7), { row: 1, col: 2 });
  // 右下 (2, 4)
  assert.deepEqual(getSlotCoords(14), { row: 2, col: 4 });
  // 邊界防禦
  assert.deepEqual(getSlotCoords(-1), { row: -1, col: -1 });
  assert.deepEqual(getSlotCoords(15), { row: -1, col: -1 });
});

test("attack_speed: 十字相鄰判定", () => {
  // 中心格 7 (row 1, col 2) 的十字相鄰是 2 (上), 12 (下), 6 (左), 8 (右)
  assert.equal(areSlotsAdjacent(7, 2), true);
  assert.equal(areSlotsAdjacent(7, 12), true);
  assert.equal(areSlotsAdjacent(7, 6), true);
  assert.equal(areSlotsAdjacent(7, 8), true);

  // 對角線不相鄰
  assert.equal(areSlotsAdjacent(7, 1), false);
  assert.equal(areSlotsAdjacent(7, 3), false);
  assert.equal(areSlotsAdjacent(7, 11), false);
  assert.equal(areSlotsAdjacent(7, 13), false);

  // 自身不相鄰
  assert.equal(areSlotsAdjacent(7, 7), false);

  // 取得相鄰陣列
  const centerAdj = getAdjacentSlotIndices(7);
  assert.deepEqual(centerAdj.sort((a, b) => a - b), [2, 6, 8, 12]);

  // 角落格 0 的相鄰只有 1 (右) 和 5 (下)
  const cornerAdj = getAdjacentSlotIndices(0);
  assert.deepEqual(cornerAdj.sort((a, b) => a - b), [1, 5]);
});

test("attack_speed: 正統減算法單一來源 ΔT = B * (R / (1 + R))", () => {
  const base = 1.0;
  // +100% 加成 (R = 1.0) ➔ 應縮減 1.0 * (1 / 2) = 0.5 秒
  const r100 = calculateReductionTime(base, 1.0);
  assert.equal(Number(r100.toFixed(4)), 0.5);

  // 無加成 (R = 0) ➔ 縮減 0
  assert.equal(calculateReductionTime(base, 0), 0);
  // 無效防禦
  assert.equal(calculateReductionTime(0, 1.0), 0);
  assert.equal(calculateReductionTime(base, -0.5), 0);
});

test("attack_speed: 多乘區減算綜合攻速與 0.01s 極限保護", () => {
  // 基礎 1.0s，光加成 +80% (R1 = 0.8), 共鳴 +50% (R2 = 0.5)
  // ΔT_light = 1.0 * (0.8 / 1.8) ≈ 0.4444
  // ΔT_moon = 1.0 * (0.5 / 1.5) ≈ 0.3333
  // totalReduction ≈ 0.7777
  // finalInterval = 1.0 - 0.7777 = 0.2223s
  const res = computeAttackSpeed({
    baseInterval: 1.0,
    sources: [
      { id: "light", name: "光", bonusRate: 0.8 },
      { id: "res", name: "共鳴", bonusRate: 0.5 }
    ]
  });

  assert.equal(res.baseInterval, 1.0);
  assert.equal(res.finalInterval, 0.2222);
  assert.equal(res.isClamped, false);
  assert.ok(res.attacksPerSecond > 4.4);

  // 測試極限溢出保護 (減免超過 1.0s 時必須夾緊在 0.01s)
  const extreme = computeAttackSpeed({
    baseInterval: 1.0,
    sources: [
      { id: "s1", name: "超狂暴", bonusRate: 5.0 }, // 1.0 * 5/6 = 0.8333
      { id: "s2", name: "超神速", bonusRate: 5.0 }  // 1.0 * 5/6 = 0.8333
      // 總減免 1.6666 > 1.0
    ]
  });

  assert.equal(extreme.finalInterval, MIN_ATTACK_INTERVAL);
  assert.equal(extreme.isClamped, true);
  assert.equal(extreme.attacksPerSecond, 100);
});

test("attack_speed: 戰場盤面目標與十字光/共鳴評估", () => {
  const board = Array(15).fill(null);
  // 目標骰子放在中央格 7 (基礎 0.6s)
  board[7] = { id: "target", diceName: "太陽", baseInterval: 0.6, dot: 7 };
  // 在上方 2 放 7 星光骰子
  board[2] = { id: "dice_light", type: "light", diceName: "光", dot: 7, classLevel: 10, powerUpLevel: 5 };
  // 在左方 6 放 7 星共鳴骰子
  board[6] = { id: "dice_resonance", type: "resonance", diceName: "共鳴", dot: 7, classLevel: 10, powerUpLevel: 5 };

  const evalResult = evaluateBattlefieldTarget({
    board,
    targetIndex: 7,
    treeBonusRate: 0.2, // 樹 +20%
    eventBonusRate: 0.1 // 事件 +10%
  });

  assert.equal(evalResult.targetIndex, 7);
  assert.equal(evalResult.activeRayLinks.length, 2); // 兩條光/共鳴射線
  assert.ok(evalResult.speedResult.finalInterval < 0.6);
  assert.ok(evalResult.speedResult.speedMultiplier > 1.0);
});
