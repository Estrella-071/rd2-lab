import test from "node:test";
import assert from "node:assert/strict";
import {
  createProgressionTier,
  calculateAllocationsCost,
  calculateTierDelta,
  validateTierMonotonicity,
  generateSmartProgressionTiers,
  exportTiersForShare,
  importTiersFromShare
} from "../../src/domain/simulation_tiers.js";

test("simulation_tiers: 工廠建立梯隊與預設下限標註", () => {
  const t0 = createProgressionTier({
    id: "t0",
    name: "T0",
    isBaseline: true,
    note: "必點核心下限"
  });

  assert.equal(t0.id, "t0");
  assert.equal(t0.name, "T0");
  assert.equal(t0.isBaseline, true);
  assert.equal(t0.label, "核心下限");
  assert.equal(t0.note, "必點核心下限");
});

test("simulation_tiers: 梯隊花費與兩階差距 (Tier Delta) 計算", () => {
  const mockNodesMap = new Map([
    ["n1", { id: "n1", costGold: 1000, costDice: 10 }],
    ["n2", { id: "n2", costGold: 2000, costDice: 20 }],
    ["solar_node", { id: "solar_node", isSolar: true, costGold: 5000, costDice: 50 }]
  ]);

  const baseTier = createProgressionTier({
    id: "t0",
    allocations: { n1: 2, n2: 1 }
  });
  baseTier.cost = calculateAllocationsCost(baseTier.allocations, mockNodesMap);
  // baseTier cost: n1(2000g, 20d) + n2(2000g, 20d) = 4000g, 40d

  const nextTier = createProgressionTier({
    id: "t1",
    allocations: { n1: 5, n2: 3, solar_node: 1 }
  });
  nextTier.cost = calculateAllocationsCost(nextTier.allocations, mockNodesMap);
  // nextTier cost: n1(5000g, 50d) + n2(6000g, 60d) + solar(5000g, 50d, 1core) = 16000g, 160d, 1core

  const delta = calculateTierDelta(baseTier, nextTier, mockNodesMap);
  assert.equal(delta.goldDelta, 12000);
  assert.equal(delta.diceDelta, 120);
  assert.equal(delta.solarCoresDelta, 1);
  assert.equal(delta.upgradedNodes.length, 3);
});

test("simulation_tiers: 單調遞增性驗證 (防階梯倒退)", () => {
  const validTiers = [
    createProgressionTier({ id: "t0", allocations: { n1: 2, n2: 1 } }),
    createProgressionTier({ id: "t1", allocations: { n1: 5, n2: 2 } })
  ];
  assert.equal(validateTierMonotonicity(validTiers).isValid, true);

  const invalidTiers = [
    createProgressionTier({ id: "t0", allocations: { n1: 5 } }),
    createProgressionTier({ id: "t1", allocations: { n1: 3 } }) // 倒退
  ];
  const check = validateTierMonotonicity(invalidTiers);
  assert.equal(check.isValid, false);
  assert.ok(check.violations.length > 0);
});

test("simulation_tiers: 智慧自動階梯推導 (Smart Tiers)", () => {
  const mockNodesMap = new Map([
    ["n_light", { id: "n_light", name: "光之祝福", desc: "提高相鄰骰子光加成", costGold: 500, costDice: 5 }],
    ["n_solar", { id: "n_solar", name: "太陽核心攻擊", desc: "增加暴擊與攻速", costGold: 1000, costDice: 10 }],
    ["n_sub", { id: "n_sub", name: "輔助SP吸收", desc: "掉落額外SP", costGold: 200, costDice: 2 }]
  ]);

  const fullAllocations = {
    n_light: 15,
    n_solar: 15,
    n_sub: 10
  };

  const tiers = generateSmartProgressionTiers(fullAllocations, mockNodesMap);
  assert.ok(tiers.length >= 3);
  // T0 必定標註為核心下限 baseline
  assert.equal(tiers[0].isBaseline, true);
  assert.equal(tiers[0].name, "T0");
  // T0 點數應低於滿配
  assert.ok(tiers[0].allocations.n_solar <= 15);
  // T_final 應該完全等於 fullAllocations
  const finalTier = tiers[tiers.length - 1];
  assert.deepEqual(finalTier.allocations, fullAllocations);
});

test("simulation_tiers: 分享導出與向下相容匯入", () => {
  const originalTiers = [
    createProgressionTier({ id: "t0", name: "T0", isBaseline: true, allocations: { a: 1 } }),
    createProgressionTier({ id: "t1", name: "T1", isBaseline: false, allocations: { a: 2 } })
  ];

  const exported = exportTiersForShare(originalTiers);
  const imported = importTiersFromShare(exported);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].isBaseline, true);
  assert.equal(imported[1].allocations.a, 2);

  // 向下相容測試：舊版只有 ranks 單一物件
  const legacyData = { ranks: { a: 10, b: 5 } };
  const legacyImported = importTiersFromShare(legacyData);
  assert.equal(legacyImported.length, 1);
  assert.equal(legacyImported[0].isBaseline, true);
  assert.equal(legacyImported[0].allocations.a, 10);
});
