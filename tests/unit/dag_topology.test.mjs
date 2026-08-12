import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  computeUpstreamTopologyPath,
  precomputePrerequisiteGraph,
  isEdgeActive,
  detectGraphCycles,
  validateGraphTopology,
  validateAcyclicDag
} from "../../src/domain/dag_topology.js";

test("dag_topology: DT-01 根節點前置路徑追溯", () => {
  const nodeById = new Map([
    ["1001", { id: "1001", branch: 1, incoming: [], next_nodes: ["1002"] }],
    ["1002", { id: "1002", branch: 1, incoming: ["1001"], next_nodes: [] }]
  ]);

  const result = computeUpstreamTopologyPath(["1001"], nodeById);
  assert.equal(result.activePathNodeIds.size, 1);
  assert.ok(result.activePathNodeIds.has("1001"));
  assert.equal(result.activeBranches.size, 1);
  assert.ok(result.activeBranches.has(1));
});

test("dag_topology: DT-02 單鏈前置節點向上遍歷", () => {
  const nodeById = new Map([
    ["A", { id: "A", branch: 1, incoming: [] }],
    ["B", { id: "B", branch: 1, incoming: ["A"] }],
    ["C", { id: "C", branch: 1, incoming: ["B"] }]
  ]);

  const result = computeUpstreamTopologyPath(["C"], nodeById);
  assert.equal(result.activePathNodeIds.size, 3);
  assert.ok(result.activePathNodeIds.has("A"));
  assert.ok(result.activePathNodeIds.has("B"));
  assert.ok(result.activePathNodeIds.has("C"));
});

test("dag_topology: DT-03 菱形多重路徑匯聚與去重", () => {
  const nodeById = new Map([
    ["Root", { id: "Root", branch: 1, incoming: [] }],
    ["BranchA", { id: "BranchA", branch: 1, incoming: ["Root"] }],
    ["BranchB", { id: "BranchB", branch: 1, incoming: ["Root"] }],
    ["Merge", { id: "Merge", branch: 1, incoming: ["BranchA", "BranchB"] }]
  ]);

  const result = computeUpstreamTopologyPath(["Merge"], nodeById);
  assert.equal(result.activePathNodeIds.size, 4);
  assert.ok(result.activePathNodeIds.has("Root"));
  assert.ok(result.activePathNodeIds.has("BranchA"));
  assert.ok(result.activePathNodeIds.has("BranchB"));
  assert.ok(result.activePathNodeIds.has("Merge"));
});

test("dag_topology: DT-04 跨派系前置路徑與分支收集", () => {
  const nodeById = new Map([
    ["N1", { id: "N1", branch: 1, incoming: [] }],
    ["N2", { id: "N2", branch: 2, incoming: ["N1"] }],
    ["N3", { id: "N3", branch: 3, incoming: ["N2"] }]
  ]);

  const result = computeUpstreamTopologyPath(["N3"], nodeById);
  assert.equal(result.activePathNodeIds.size, 3);
  assert.equal(result.activeBranches.size, 3);
  assert.ok(result.activeBranches.has(1));
  assert.ok(result.activeBranches.has(2));
  assert.ok(result.activeBranches.has(3));
});

test("dag_topology: DT-05 空輸入與無效節點防護", () => {
  const nodeById = new Map([["A", { id: "A", branch: 1, incoming: [] }]]);
  const resEmpty = computeUpstreamTopologyPath([], nodeById);
  assert.equal(resEmpty.activePathNodeIds.size, 0);

  const resUnknown = computeUpstreamTopologyPath(["NON_EXISTENT"], nodeById);
  assert.equal(resUnknown.activePathNodeIds.size, 0);
});

test("dag_topology: DT-06 循環圖防護 (走訪防死迴圈)", () => {
  const cyclicNodes = new Map([
    ["A", { id: "A", branch: 1, incoming: ["C"] }],
    ["B", { id: "B", branch: 1, incoming: ["A"] }],
    ["C", { id: "C", branch: 1, incoming: ["B"] }]
  ]);

  const result = computeUpstreamTopologyPath(["A"], cyclicNodes);
  assert.equal(result.activePathNodeIds.size, 3);
});

test("dag_topology: DT-07 & DT-08 邊線點亮判定", () => {
  const activeSet = new Set(["A", "B", "C"]);
  assert.equal(isEdgeActive({ startId: "A", endId: "B" }, activeSet), true);
  assert.equal(isEdgeActive({ startId: "A", endId: "D" }, activeSet), false);
  assert.equal(isEdgeActive({ startId: "X", endId: "B" }, activeSet), false);
  assert.equal(isEdgeActive(null, activeSet), false);
});

test("dag_topology: DT-09 detectGraphCycles 與 validateGraphTopology", () => {
  const validGraph = [
    { id: "A", next_nodes: ["B"], incoming: [] },
    { id: "B", next_nodes: [], incoming: ["A"] }
  ];
  const checkValid = detectGraphCycles(validGraph);
  assert.equal(checkValid.hasCycle, false);
  assert.equal(validateAcyclicDag(validGraph).isValid, true);

  const asymmetricGraph = [
    { id: "A", next_nodes: ["B"], incoming: [] },
    { id: "B", next_nodes: [], incoming: [] }
  ];
  const asymmetricResult = validateGraphTopology(asymmetricGraph);
  assert.equal(asymmetricResult.isValid, false);
  assert.ok(asymmetricResult.errors.some((error) => error.includes("對稱記錄")));

  const cycleGraph = [
    { id: "A", next_nodes: ["B"], incoming: ["C"] },
    { id: "B", next_nodes: ["C"], incoming: ["A"] },
    { id: "C", next_nodes: ["A"], incoming: ["B"] }
  ];
  const checkCycle = detectGraphCycles(cycleGraph);
  assert.equal(checkCycle.hasCycle, true);
  assert.equal(validateGraphTopology(cycleGraph).isValid, false);
});

test("dag_topology: DT-10 真實資料庫 239 節點拓撲無環檢驗與快取預計算", () => {
  const candidatePaths = [
    path.resolve("site/data/dice_tree.json"),
    path.resolve("data/dice_tree.json")
  ];
  const jsonPath = candidatePaths.find((p) => fs.existsSync(p));

  assert.ok(jsonPath, `dice_tree.json 必須存在於以下路徑之一: ${candidatePaths.join(", ")}`);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const nodes = raw.nodes || [];

  assert.equal(nodes.length, 239, "應有 239 個節點");
  const validation = validateGraphTopology(nodes, raw.summary);
  assert.equal(validation.isValid, true, `拓撲驗證錯誤: ${validation.errors.join("; ")}`);

  const prereqMap = precomputePrerequisiteGraph(nodes);
  assert.equal(prereqMap.size, 239);
  nodes.forEach((n) => {
    assert.ok(prereqMap.has(n.id));
    const entry = prereqMap.get(n.id);
    assert.ok(entry.nodeIds.has(n.id));
    assert.ok(entry.branches.size > 0);
  });
});
