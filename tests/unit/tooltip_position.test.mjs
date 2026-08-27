import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldPlaceTooltipBelow,
  computeTooltipScreenCoordinates,
  calculateTooltipScreenPosition
} from "../../src/domain/tooltip_position.js";

test("tooltip_position: TP-01 前置節點在上方時觸發避讓置於下方", () => {
  const nodePositions = new Map([
    ["Target", { x: 500, y: 1000 }],
    ["PrereqA", { x: 500, y: 800 }],
    ["PrereqB", { x: 500, y: 700 }]
  ]);
  const activePrereqs = new Set(["Target", "PrereqA", "PrereqB"]);

  const result = shouldPlaceTooltipBelow("Target", nodePositions, activePrereqs);
  assert.equal(result, true, "上方有前置節點時應置於下方");
});

test("tooltip_position: TP-02 前置節點在下方時不觸發避讓", () => {
  const nodePositions = new Map([
    ["Target", { x: 500, y: 500 }],
    ["PrereqA", { x: 500, y: 800 }],
    ["PrereqB", { x: 500, y: 900 }]
  ]);
  const activePrereqs = new Set(["Target", "PrereqA", "PrereqB"]);

  const result = shouldPlaceTooltipBelow("Target", nodePositions, activePrereqs);
  assert.equal(result, false, "前置節點在下方時應置於上方");
});

test("tooltip_position: TP-03 僅含目標節點自身時預設置頂", () => {
  const nodePositions = new Map([["Target", { x: 500, y: 500 }]]);
  const activePrereqs = new Set(["Target"]);

  assert.equal(shouldPlaceTooltipBelow("Target", nodePositions, activePrereqs), false);
  assert.equal(shouldPlaceTooltipBelow("Target", nodePositions, []), false);
});

test("tooltip_position: TP-04 空集合與 null 輸入防禦", () => {
  assert.equal(shouldPlaceTooltipBelow(null, null, null), false);
  assert.equal(shouldPlaceTooltipBelow("Unknown", new Map(), new Set()), false);
});

test("tooltip_position: TP-05 40px 臨界差值精確判定", () => {
  const targetPt = { x: 500, y: 500 };
  const positionsBelowThreshold = new Map([
    ["Target", targetPt],
    ["Prereq", { x: 500, y: 539 }] // 539 < 500 + 40 (540)
  ]);
  assert.equal(shouldPlaceTooltipBelow("Target", positionsBelowThreshold, ["Target", "Prereq"]), true);

  const positionsAboveThreshold = new Map([
    ["Target", targetPt],
    ["Prereq", { x: 500, y: 540 }] // 540 >= 500 + 40 (540)
  ]);
  assert.equal(shouldPlaceTooltipBelow("Target", positionsAboveThreshold, ["Target", "Prereq"]), false);
});

test("tooltip_position: TP-06 螢幕上方置頂坐標純數學計算", () => {
  const result = computeTooltipScreenCoordinates({
    pt: { x: 500, y: 500 },
    scale: 1.0,
    panX: 100,
    panY: 200,
    nodeType: "DICE_RUNE",
    tipWidth: 400,
    tipHeight: 300,
    placeBelow: false,
    gap: 16
  });

  // screenX = 100 + 500 = 600, left = 600 - 200 = 400
  // screenY = 200 + 500 = 700, radius = 36, top = 700 - 36 - 300 - 16 = 348
  assert.equal(result.left, 400);
  assert.equal(result.top, 348);
  assert.equal(result.isPlacedBelow, false);
});

test("tooltip_position: TP-07 螢幕下方置底坐標計算", () => {
  const result = calculateTooltipScreenPosition({
    pt: { x: 500, y: 500 },
    scale: 1.0,
    panX: 100,
    panY: 200,
    nodeType: "DICE_RUNE",
    tipWidth: 400,
    tipHeight: 300,
    placeBelow: true,
    gap: 16
  });

  // top = 700 + 36 + 16 = 752
  assert.equal(result.left, 400);
  assert.equal(result.top, 752);
  assert.equal(result.isPlacedBelow, true);
});

test("tooltip_position: TP-08 大節點半徑與縮放倍率計算", () => {
  const result = computeTooltipScreenCoordinates({
    pt: { x: 200, y: 300 },
    scale: 2.0,
    panX: 0,
    panY: 0,
    nodeType: "DICE", // isLarge = true, baseRadius = 52, scaledRadius = 104
    tipWidth: 200,
    tipHeight: 100,
    placeBelow: true,
    gap: 10
  });

  // screenX = 400, left = 400 - 100 = 300
  // screenY = 600, top = 600 + 104 + 10 = 714
  assert.equal(result.left, 300);
  assert.equal(result.top, 714);
});

test("tooltip_position: TP-09 單一物件參數模式支援", () => {
  const params = {
    nodeId: "Target",
    pt: { x: 500, y: 1000 },
    activePrereqNodeIds: new Set(["Target", "A"]),
    nodePositions: new Map([["A", { x: 500, y: 600 }]]),
    threshold: 40
  };
  assert.equal(shouldPlaceTooltipBelow(params), true);
});

test("tooltip_position: TP-10 關閉過渡期防跳動鎖定", () => {
  const params = {
    nodeId: "Target",
    isClosing: true,
    isCurrentlyBelow: true,
    nodePositions: new Map([["Target", { x: 0, y: 0 }]]),
    activePrereqNodeIds: new Set(["Target"])
  };
  assert.equal(shouldPlaceTooltipBelow(params), true);
});
