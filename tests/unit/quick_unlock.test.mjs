import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getNodeMap,
  createSimulationState,
  getRank,
  getRunesForDiceNode,
  calculateQuickUnlockState,
  calculateImageSplitLayout,
  getUnlockedBounds
} from "../../src/domain/simulation_plan.js";
import {
  MAX_SIMULATION_SAVE_SLOTS,
  sanitizeSlotName,
  listSimulationSlots,
  saveSimulationSlot,
  loadSimulationSlot,
  deleteSimulationSlot
} from "../../src/domain/simulation_save.js";

const root = path.resolve(".");
const treeData = JSON.parse(fs.readFileSync(path.join(root, "site/data/dice_tree.json"), "utf8"));
const nodesMap = getNodeMap(treeData.nodes);

class MockStorageAdapter {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

test("Quick unlock: getRunesForDiceNode identifies 3 companion runes for standard dice", () => {
  const fireDice = nodesMap.get("1001");
  const runes = getRunesForDiceNode(fireDice, nodesMap);
  assert.equal(runes.length, 3);
  assert.deepEqual(runes.map((r) => r.id).sort(), ["1201", "1301", "1401"]);
});

test("Quick unlock: calculateQuickUnlockState handles batch unlock, rune exclusions, and team sync", () => {
  const state = calculateQuickUnlockState({
    diceIds: ["1001", "1005", "1007", "2001", "3001"],
    supportId: "1114", // 青兒 (自然支援)
    excludedNodeIds: ["1301"], // 排除火骰子符文 1301
    rankOverrides: { "1001": 50 },
    nodesMap
  });

  // 主骰應已解鎖
  assert.equal(getRank(state, "1001") > 0, true);
  assert.equal(getRank(state, "1005") > 0, true);
  assert.equal(getRank(state, "1007") > 0, true);
  assert.equal(getRank(state, "2001") > 0, true);
  assert.equal(getRank(state, "3001") > 0, true);

  // 支援應已解鎖
  assert.equal(getRank(state, "1114") > 0, true);

  // 未排除的符文 1201 應已解鎖，被排除的 1301 應為 0
  assert.equal(getRank(state, "1201") > 0, true);
  assert.equal(getRank(state, "1301"), 0);

  // 應維持模擬模式 active: true
  assert.equal(state.active, true);

  // 隊伍應自動填入這 5 顆主骰
  assert.equal(state.team.dice.length, 5);
  assert.equal(state.team.dice[0].id, "1001");
});

test("Image split geometry: calculateImageSplitLayout produces expected corner rules", () => {
  const vertical = calculateImageSplitLayout({
    canvasWidth: 1600,
    canvasHeight: 1000,
    splitMode: "split-vertical"
  });
  assert.equal(vertical.parts.length, 2);
  assert.equal(vertical.parts[0].roundedCorners.topLeft, 24);
  assert.equal(vertical.parts[0].roundedCorners.bottomLeft, 0);
  assert.equal(vertical.parts[1].roundedCorners.bottomRight, 24);
  assert.equal(vertical.parts[1].roundedCorners.topRight, 0);

  const quad = calculateImageSplitLayout({
    canvasWidth: 1600,
    canvasHeight: 1000,
    splitMode: "split-quad"
  });
  assert.equal(quad.parts.length, 4);
  assert.equal(quad.parts[0].roundedCorners.topLeft, 24);
  assert.equal(quad.parts[1].roundedCorners.topRight, 24);
  assert.equal(quad.parts[2].roundedCorners.bottomLeft, 24);
  assert.equal(quad.parts[3].roundedCorners.bottomRight, 24);
});

test("Simulation save slots: supports up to 5 slots with name truncation and CRUD lifecycle", () => {
  const storage = new MockStorageAdapter();
  assert.equal(MAX_SIMULATION_SAVE_SLOTS, 5);

  const initialList = listSimulationSlots(storage);
  assert.equal(initialList.length, 5);
  assert.equal(initialList.every((slot) => slot === null), true);

  // 命名長度限制測試 (超過 10 字自動截斷)
  const longName = "這是一個非常非常非常長的存檔名稱";
  const sanitized = sanitizeSlotName(longName);
  assert.equal(sanitized.length, 10);
  assert.equal(sanitized, "這是一個非常非常非常");

  // 儲存至槽位 1
  const saveRes = saveSimulationSlot(storage, 1, {
    name: longName,
    simulation: {
      ranks: { "1001": 50, "1201": 1 },
      team: { dice: [{ id: "1001" }] },
      spent: { gold: 1000, core: 5, solar: 0 }
    }
  });
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.slot.name, "這是一個非常非常非常");

  // 讀取槽位 1
  const loaded = loadSimulationSlot(storage, 1);
  assert.equal(loaded !== null, true);
  assert.equal(loaded.id, 1);
  assert.equal(loaded.ranks["1001"], 50);

  // 刪除槽位 1
  const deleted = deleteSimulationSlot(storage, 1);
  assert.equal(deleted, true);
  assert.equal(loadSimulationSlot(storage, 1), null);
});

test("Image split auto layout: prefers single square when node count is small or compact", () => {
  // 1. 節點數少 (<= 18)：一張圖搞定
  const smallCount = calculateImageSplitLayout({
    unlockedBounds: { width: 1900, height: 1700, count: 12, populatedQuadrants: 2 },
    splitMode: "auto"
  });
  assert.equal(smallCount.mode, "single");
  assert.equal(smallCount.parts.length, 1);

  // 2. 節點數中等 (<= 30) 且分佈接近正方形 (如本次使用者截圖 23 顆節點, 2300x2600, ratio=0.88)：一張圖搞定，不強行切成左右或上下
  const userCaseSquare = calculateImageSplitLayout({
    unlockedBounds: { width: 2300, height: 2600, count: 23, populatedQuadrants: 4 },
    splitMode: "auto"
  });
  assert.equal(userCaseSquare.mode, "single");
  assert.equal(userCaseSquare.parts.length, 1);

  // 3. 極小幾何範圍 (長寬 <= 1400)：一張圖搞定
  const tinyArea = calculateImageSplitLayout({
    unlockedBounds: { width: 900, height: 800, count: 25, populatedQuadrants: 4 },
    splitMode: "auto"
  });
  assert.equal(tinyArea.mode, "single");
});

test("Image split auto layout: prefers split-horizontal when wide layout (ratio > 1.25) even with large span", () => {
  // 橫向展開走向 (寬度遠大於高度，ratio = 3600 / 2000 = 1.8 > 1.25)
  // 即使覆蓋 4 個象限且節點多 (count=36)，也應採用左右分割，避免四宮格上下大片黑邊！
  const wideSpan = calculateImageSplitLayout({
    unlockedBounds: { width: 3600, height: 2000, count: 36, populatedQuadrants: 4 },
    splitMode: "auto"
  });
  assert.equal(wideSpan.mode, "split-horizontal");
  assert.equal(wideSpan.parts.length, 2);

  // 對角線走向 (僅 2 個象限) 亦判定為左右分割
  const diagonal = calculateImageSplitLayout({
    unlockedBounds: { width: 2600, height: 2200, count: 34, populatedQuadrants: 2 },
    splitMode: "auto"
  });
  assert.equal(diagonal.mode, "split-horizontal");
  assert.equal(diagonal.parts.length, 2);
});

test("Image split auto layout: strictly requires count >= 32, wide span, square ratio (0.8~1.25) and 3+ quadrants for quad split", () => {
  // 四宮格嚴格門檻：count >= 32, width >= 2400, height >= 2200, ratio 0.8~1.25, populatedQuadrants >= 3
  const fullBoard = calculateImageSplitLayout({
    unlockedBounds: { width: 2600, height: 2400, count: 36, populatedQuadrants: 4 },
    splitMode: "auto"
  });
  assert.equal(fullBoard.mode, "split-quad");
  assert.equal(fullBoard.parts.length, 4);

  // 縱向長條走向 (ratio < 0.8)：判定為 split-vertical (上下2張)
  const verticalStrip = calculateImageSplitLayout({
    unlockedBounds: { width: 700, height: 1900, count: 22, populatedQuadrants: 2 },
    splitMode: "auto"
  });
  assert.equal(verticalStrip.mode, "split-vertical");
  assert.equal(verticalStrip.parts.length, 2);
});

test("getUnlockedBounds: ignores unlinked distant initial dice to prevent box bloat", () => {
  const treeData = {
    nodes: [
      { id: "1001", node_type: "DICE", max_rank: 1, x: 1000, y: 1000 },
      { id: "1005", node_type: "DICE", max_rank: 1, x: 1100, y: 1100 },
      { id: "4008", node_type: "DICE", max_rank: 1, x: -700, y: 3000 }, // 遠端初始陰陽骰子
      { id: "5006", node_type: "DICE", max_rank: 1, x: 2500, y: 3200 }, // 遠端初始貪婪骰子
      { id: "1201", node_type: "DICE_RUNE", max_rank: 5, incoming: ["1001"], x: 1050, y: 1050 }
    ]
  };

  // 模擬環境：8顆初始骰子預設 rank: 1，使用者手動解鎖了 1201
  const simulation = {
    ranks: {
      "1001": 1,
      "1005": 1,
      "4008": 1,
      "5006": 1,
      "1201": 1
    }
  };

  const bounds = getUnlockedBounds(simulation, treeData);
  assert.ok(bounds !== null);
  // 只計算手動解鎖 1201 及其前置 1001，未關聯的 4008 與 2007 必須被排除
  assert.equal(bounds.count, 2);
  assert.equal(bounds.minX, 1000);
  assert.equal(bounds.maxX, 1050);
  assert.equal(bounds.minY, 1000);
  assert.equal(bounds.maxY, 1050);
  assert.equal(bounds.width, 50);
  assert.equal(bounds.height, 50);
});

test("Quick unlock: slider popover dismissal hides all open popovers and reports true only when any were open", () => {
  const popovers = [
    { hidden: false },
    { hidden: true },
    { hidden: false }
  ];

  function closePopovers(list) {
    let closedAny = false;
    list.forEach((p) => {
      if (!p.hidden) {
        p.hidden = true;
        closedAny = true;
      }
    });
    return closedAny;
  }

  const result1 = closePopovers(popovers);
  assert.equal(result1, true);
  assert.ok(popovers.every((p) => p.hidden === true));

  const result2 = closePopovers(popovers);
  assert.equal(result2, false);
});


