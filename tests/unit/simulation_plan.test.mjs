import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { AppStore, ActionTypes } from "../../src/app/store/app_store.js";
import {
  applyMaxRank,
  applyBatchUnlock,
  createSimulationState,
  evaluateNode,
  getNodeCost,
  INITIAL_UNLOCKED_DICE_IDS,
  SIMULATION_BATCH_UNLOCK_START_IDS,
  SIMULATION_PREUNLOCKED_DICE_IDS,
  SIMULATION_RESOURCE_UNLOCK_DICE_IDS,
  isInitialSimulationNode,
  isSpecialUnlockNode,
  getConfiguredPrerequisiteIds,
  getFactionLevelProgressLabel,
  planBatchUnlock,
  planMaxRank,
  sumNodeCosts
} from "../../src/domain/simulation_plan.js";

const canonicalTree = JSON.parse(fs.readFileSync(path.resolve("site/data/dice_tree.json"), "utf8"));

const nodes = [
  { id: "1", is_base: true, node_type: "DICE", max_rank: 1, gold_costs: [0], core_costs: [0] },
  { id: "2", incoming: ["1"], node_type: "PLAYER_PASSIVE", max_rank: 1, gold_costs: [100], core_costs: [2] },
  { id: "3", incoming: ["1"], node_type: "PLAYER_PASSIVE", max_rank: 1, gold_costs: [200], core_costs: [0] },
  { id: "4", incoming: ["2", "3"], node_type: "DICE", max_rank: 1, gold_costs: [400], core_costs: [3] },
  { id: "5", incoming: ["1"], node_type: "DICE_RUNE", max_rank: 3, gold_costs: [10, 20, 30], core_costs: [1, 2, 3] },
  { id: "6", incoming: ["1"], node_type: "DICE", max_rank: 1, unlock_condition: "LV_Nature", unlock_condition_zh: "自然等級", unlock_condition_value: "10", gold_costs: [999], core_costs: [9] },
  { id: "7", incoming: ["6"], node_type: "DICE_RUNE", max_rank: 1, gold_costs: [50], core_costs: [0] },
  // `is_base` is a content flag; this base dice still needs its parent.
  { id: "8", is_base: true, incoming: ["1"], node_type: "DICE", max_rank: 1, gold_costs: [0], core_costs: [5] }
];

test("simulation domain: five base dice plus three reward dice are pre-unlocked while Fear uses resources", () => {
  assert.deepEqual(INITIAL_UNLOCKED_DICE_IDS, ["1001", "1005", "1007", "2001", "3001"]);
  for (const id of INITIAL_UNLOCKED_DICE_IDS) {
    assert.equal(isInitialSimulationNode({ id, node_type: "DICE" }), true);
  }
  assert.deepEqual(SIMULATION_PREUNLOCKED_DICE_IDS, ["4008", "5006", "5008"]);
  for (const [id, condition] of [
    ["4008", "REWARD_UNLOCKED"],
    ["5006", "COOP_REWARD_UNLOCKED"],
    ["5008", "ARENA_REWARD_UNLOCKED"]
  ]) {
    const node = { id, node_type: "DICE", unlock_condition: condition, unlock_condition_zh: "special", unlock_condition_value: "1" };
    assert.equal(isInitialSimulationNode(node), true);
    assert.equal(isSpecialUnlockNode(node), false);
  }
  assert.deepEqual(SIMULATION_RESOURCE_UNLOCK_DICE_IDS, ["5002"]);
  const fear = { id: "5002", node_type: "DICE", unlock_condition: "COOP_KILL_COUNT", unlock_condition_zh: "special", unlock_condition_value: "900", core_costs: [8] };
  assert.equal(isInitialSimulationNode(fear), false);
  assert.equal(isSpecialUnlockNode(fear), false);
  const levelGate = { id: "1106", node_type: "PLAYER_PASSIVE", unlock_condition: "LV_Nature", unlock_condition_zh: "自然等級", unlock_condition_value: "10", core_costs: [10] };
  assert.equal(isInitialSimulationNode(levelGate), false);
  assert.equal(isSpecialUnlockNode(levelGate), true);
  assert.equal(isSpecialUnlockNode({ id: "future", node_type: "DICE", unlock_condition: "UNKNOWN_GATE", unlock_condition_value: "1" }), false);
});

test("simulation domain: reward dice satisfy routes and Fear contributes its resource cost", () => {
  const simulationNodes = [
    { id: "1001", node_type: "DICE", max_rank: 1, gold_costs: [0], core_costs: [0] },
    { id: "4008", node_type: "DICE", max_rank: 1, unlock_condition: "REWARD_UNLOCKED", unlock_condition_value: "700" },
    { id: "5002", node_type: "DICE", max_rank: 1, unlock_condition: "COOP_KILL_COUNT", unlock_condition_value: "900", core_costs: [8] },
    { id: "5006", node_type: "DICE", max_rank: 1, incoming: ["5007"], unlock_condition: "COOP_REWARD_UNLOCKED", unlock_condition_value: "2100" },
    { id: "5008", node_type: "DICE", max_rank: 1, incoming: ["5009"], unlock_condition: "ARENA_REWARD_UNLOCKED", unlock_condition_value: "300" },
    { id: "5101", node_type: "PLAYER_PASSIVE", max_rank: 1, incoming: ["5006"], core_costs: [2] },
    { id: "5003", node_type: "DICE", max_rank: 1, incoming: ["5101"], core_costs: [8] },
    { id: "5105", node_type: "PLAYER_PASSIVE", max_rank: 1, incoming: ["5008"], core_costs: [2] },
    { id: "5110", node_type: "PLAYER_PASSIVE", max_rank: 1, incoming: ["5008"], core_costs: [3] },
    { id: "5007", node_type: "DICE", max_rank: 1, incoming: ["5002"], core_costs: [2] },
    { id: "5009", node_type: "DICE", max_rank: 1, incoming: ["5002"], core_costs: [3] },
    { id: "5102", node_type: "PLAYER_PASSIVE", max_rank: 1, incoming: ["5007", "5006"], core_costs: [4] }
  ];
  const state = createSimulationState(simulationNodes, { active: true });
  assert.deepEqual(Object.keys(state.ranks).sort(), ["1001", "4008", "5006", "5008"]);
  assert.deepEqual(planBatchUnlock("5007", state, simulationNodes).nodeIds, ["5002", "5007"]);
  assert.deepEqual(planBatchUnlock("5102", state, simulationNodes).nodeIds, ["5002", "5007", "5102"]);
  assert.deepEqual(planBatchUnlock("5102", state, simulationNodes).total, { gold: 0, core: 14 });
  assert.deepEqual(SIMULATION_BATCH_UNLOCK_START_IDS, { "5101": "5006", "5003": "5006", "5105": "5008", "5110": "5008" });
  assert.deepEqual(planBatchUnlock("5101", state, simulationNodes).nodeIds, ["5101"]);
  assert.deepEqual(planBatchUnlock("5003", state, simulationNodes).nodeIds, ["5101", "5003"]);
  assert.deepEqual(planBatchUnlock("5105", state, simulationNodes).nodeIds, ["5105"]);
  assert.deepEqual(planBatchUnlock("5110", state, simulationNodes).nodeIds, ["5110"]);
  assert.deepEqual([...getConfiguredPrerequisiteIds("5003", simulationNodes)], ["5003", "5101", "5006"]);
  assert.deepEqual([...getConfiguredPrerequisiteIds("5105", simulationNodes)], ["5105", "5008"]);
  assert.deepEqual([...getConfiguredPrerequisiteIds("5110", simulationNodes)], ["5110", "5008"]);
  assert.equal(evaluateNode("5002", state, simulationNodes).canUnlock, true);
  assert.deepEqual(evaluateNode("5002", state, simulationNodes).nextCost, { gold: 0, core: 8 });
});

test("simulation domain: batch unlock is unique and topologically ordered", () => {
  const state = createSimulationState(nodes, { active: true });
  assert.deepEqual(Object.keys(state.ranks).sort((a, b) => a.localeCompare(b)), ["1"]);
  assert.deepEqual(planBatchUnlock("8", state, nodes).nodeIds, ["8"]);
  const plan = planBatchUnlock("4", state, nodes);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nodeIds, ["2", "3", "4"]);
  assert.deepEqual(plan.total, { gold: 700, core: 5 });

  const result = applyBatchUnlock("4", state, nodes);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.state.ranks).sort((a, b) => a.localeCompare(b)), ["1", "2", "3", "4"]);
  assert.deepEqual(result.cost, plan.total);

  const repeat = planBatchUnlock("4", result.state, nodes);
  assert.deepEqual(repeat.nodeIds, []);
  assert.deepEqual(repeat.total, { gold: 0, core: 0 });
});

test("simulation domain: canonical edge lists backfill missing incoming prerequisites", () => {
  const tree = {
    nodes: [
      { id: "root", node_type: "DICE", max_rank: 1 },
      { id: "child", node_type: "PLAYER_PASSIVE", max_rank: 1, gold_costs: [7], core_costs: [0] }
    ],
    edges: [{ from: "root", to: "child" }]
  };
  const state = createSimulationState(tree, { active: true });
  const plan = planBatchUnlock("child", state, tree);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nodeIds, ["child"]);
  assert.equal(state.ranks.root, 1);
});

test("simulation store: canonical edge list also controls initial roots", () => {
  const store = new AppStore();
  store.dispatch({
    type: ActionTypes.SET_GAME_DATA,
    payload: {
      nodes: [
        { id: "root", node_type: "DICE", max_rank: 1 },
        { id: "child", node_type: "DICE", max_rank: 1, core_costs: [4] }
      ],
      edges: [{ from: "root", to: "child" }]
    }
  });
  assert.deepEqual(store.getState().simulation.ranks, { root: 1 });
});

test("simulation domain: special conditions stay visible but cannot be simulated", () => {
  const state = createSimulationState(nodes, { active: true });
  const plan = planBatchUnlock("7", state, nodes);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "special-condition");
  assert.equal(plan.blockedBySpecial[0].id, "6");
});

test("simulation domain: faction-level gates become resource unlocks after the level is met", () => {
  const levelNodes = [
    { id: "root", branch: 1, node_type: "DICE", max_rank: 1, gold_costs: [0], core_costs: [0] },
    { id: "branch", branch: 1, incoming: ["root"], node_type: "PLAYER_PASSIVE", max_rank: 9, gold_costs: new Array(9).fill(0), core_costs: new Array(9).fill(1) },
    { id: "gate", branch: 1, incoming: ["branch"], node_type: "PLAYER_PASSIVE", max_rank: 1, unlock_condition: "LV_Nature", unlock_condition_zh: "自然等級", unlock_condition_value: "10", gold_costs: [0], core_costs: [10] }
  ];
  const belowThreshold = createSimulationState(levelNodes, { active: true, ranks: { root: 1, branch: 8 } });
  const blocked = evaluateNode("gate", belowThreshold, levelNodes);
  assert.equal(blocked.isSpecial, true);
  assert.equal(blocked.currentFactionLevel, 9);
  assert.equal(blocked.requiredFactionLevel, 10);
  assert.equal(planBatchUnlock("gate", belowThreshold, levelNodes).ok, false);

  const atThreshold = createSimulationState(levelNodes, { active: true, ranks: { root: 1, branch: 9 } });
  const eligible = evaluateNode("gate", atThreshold, levelNodes);
  assert.equal(eligible.isSpecial, false);
  assert.equal(eligible.alwaysVisible, true);
  assert.equal(eligible.canUnlock, true);
  assert.deepEqual(planBatchUnlock("gate", atThreshold, levelNodes).nodeIds, ["gate"]);
  const applied = applyBatchUnlock("gate", atThreshold, levelNodes);
  assert.equal(applied.ok, true);
  assert.equal(applied.state.ranks.gate, 1);

  const selfSatisfied = createSimulationState(levelNodes, { active: true, ranks: { root: 1, gate: 1 } });
  assert.equal(selfSatisfied.ranks.gate, undefined, "a gate must not satisfy its own level requirement");
});

test("simulation domain: batch unlock evaluates faction gates after path ranks are added", () => {
  const batchNodes = [
    { id: "root", branch: 1, node_type: "DICE", max_rank: 1, gold_costs: [0], core_costs: [0] },
    { id: "branch", branch: 1, incoming: ["root"], node_type: "PLAYER_PASSIVE", max_rank: 9, gold_costs: new Array(9).fill(0), core_costs: new Array(9).fill(1) },
    { id: "path", branch: 1, incoming: ["branch"], node_type: "DICE_RUNE", max_rank: 1, gold_costs: [0], core_costs: [1] },
    { id: "gate", branch: 1, incoming: ["path"], node_type: "PLAYER_PASSIVE", max_rank: 1, unlock_condition: "LV_Nature", unlock_condition_zh: "自然等級", unlock_condition_value: "10", gold_costs: [0], core_costs: [10] }
  ];
  const state = createSimulationState(batchNodes, { active: true, ranks: { root: 1, branch: 8 } });
  assert.equal(evaluateNode("gate", state, batchNodes).currentFactionLevel, 9);
  const plan = planBatchUnlock("gate", state, batchNodes);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nodeIds, ["path", "gate"]);
  assert.deepEqual(plan.blockedBySpecial, []);

  const result = applyBatchUnlock("gate", state, batchNodes);
  assert.equal(result.ok, true);
  assert.equal(result.state.ranks.path, 1);
  assert.equal(result.state.ranks.gate, 1);
});

test("simulation domain: blocked faction gates expose current and required progress", () => {
  const node = { id: "gate", unlock_condition: "LV_Nature", unlock_condition_zh: "自然等級", unlock_condition_value: "50" };
  assert.equal(getFactionLevelProgressLabel(node, 3), "自然等級 3/50");
  assert.equal(getFactionLevelProgressLabel({ ...node, unlock_condition_value: "10" }), "自然等級 ?/10");
});

test("simulation domain: all nine faction-level gates become eligible at their thresholds", () => {
  const gates = canonicalTree.nodes.filter((node) => /^LV_(Nature|Engineering|Magic)$/.test(node.unlock_condition));
  assert.deepEqual(
    gates.map((node) => node.id),
    ["1106", "1107", "1108", "2106", "2107", "2108", "3106", "3107", "3108"]
  );
  const gateIds = new Set(gates.map((node) => String(node.id)));
  const ranks = Object.fromEntries(canonicalTree.nodes.map((node) => [
    String(node.id), gateIds.has(String(node.id)) ? 0 : 999
  ]));
  const state = { active: true, ranks };
  for (const gate of gates) {
    const evaluation = evaluateNode(gate.id, state, canonicalTree);
    assert.equal(evaluation.isSpecial, false, `${gate.id} should be eligible when its faction level is met`);
    assert.equal(evaluation.alwaysVisible, true, `${gate.id} should remain visible in simulation`);
  }
});

test("simulation domain: multi-level costs sum each canonical rank and can max", () => {
  const state = createSimulationState(nodes, { active: true });
  assert.deepEqual(getNodeCost(nodes[4], 2), { gold: 20, core: 2 });
  assert.deepEqual(sumNodeCosts(nodes[4], 0, 3), { gold: 60, core: 6 });
  const first = applyMaxRank("5", state, nodes);
  assert.equal(first.ok, true);
  assert.equal(first.state.ranks["5"], 3);
  assert.deepEqual(first.cost, { gold: 60, core: 6 });
  assert.equal(planMaxRank("5", first.state, nodes).ok, false);
});

test("simulation domain: an eligible unallocated multi-level node can max directly", () => {
  const state = createSimulationState(nodes, { active: true });
  const plan = planMaxRank("5", state, nodes);
  assert.equal(plan.ok, true);
  assert.equal(plan.remainingRanks, 3);
  const result = applyMaxRank("5", state, nodes);
  assert.equal(result.ok, true);
  assert.equal(result.state.ranks["5"], 3);
  assert.deepEqual(result.cost, { gold: 60, core: 6 });
});

test("simulation store: mode guard and reset restore initial allocation and spent totals", () => {
  const store = new AppStore();
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: { nodes, edges: [] } });
  store.dispatch({ type: ActionTypes.SIMULATION_UNLOCK_NODE, payload: { nodeId: "2" } });
  assert.equal(store.getState().simulation.lastResult.reason, "simulation-inactive");
  store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: true });
  store.dispatch({ type: ActionTypes.SIMULATION_UNLOCK_NODE, payload: { nodeId: "2" } });
  assert.equal(store.getState().simulation.ranks["2"], 1);
  assert.deepEqual(store.getState().simulation.spent, { gold: 100, core: 2 });
  store.dispatch({ type: ActionTypes.SIMULATION_SET_TEAM, payload: { dice: [{ id: "1", runes: [] }], commonNodes: [] } });
  store.dispatch({ type: ActionTypes.SIMULATION_RESET });
  assert.deepEqual(store.getState().simulation.spent, { gold: 0, core: 0 });
  assert.deepEqual(store.getState().simulation.ranks, { "1": 1 });
  assert.deepEqual(store.getState().simulation.team.dice[0], { id: "1", runes: [] });
});

test("simulation store: canonical metadata is the share/version authority", () => {
  const store = new AppStore();
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: { nodes, edges: [] } });
  assert.notEqual(store.getState().simulation.dataVersion, "1.0.3");
  store.dispatch({
    type: ActionTypes.SET_DATA_METADATA,
    payload: { canonical: { game_version: "1.0.3" }, source: {}, versions: [] }
  });
  assert.equal(store.getState().simulation.dataVersion, "1.0.3");
});

test("simulation store: canonical refresh reconciles stale descendants and keeps roots data-driven", () => {
  const store = new AppStore();
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: { nodes, edges: [] } });
  store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: true });
  store.dispatch({ type: ActionTypes.SIMULATION_UNLOCK_NODE, payload: { nodeId: "2" } });
  assert.equal(store.getState().simulation.ranks["2"], 1);

  const refreshed = nodes.map((node) => node.id === "2" ? { ...node, incoming: ["3"] } : node);
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: { nodes: refreshed, edges: [] } });
  assert.equal(store.getState().simulation.ranks["2"], undefined);
  assert.equal(store.getState().simulation.ranks["1"], 1);
  assert.deepEqual(store.getState().simulation.spent, { gold: 0, core: 0 });
});

test("faction level domain: correctly computes dynamic and full-unlocked levels excluding global passives", async () => {
  const { calculateBranchFactionLevel, calculateAllFactionLevels, isNodeContributingToFactionLevel } = await import("../../src/domain/simulation_plan.js");
  const testNodes = [
    { id: "101", branch: 1, node_type: "DICE", max_rank: 1 },
    { id: "102", branch: 1, node_type: "DICE_RUNE", max_rank: 50, gold_costs: new Array(50).fill(100) },
    { id: "103", branch: 1, node_type: "PLAYER_PASSIVE", name_zh: "自然骰子傷害", max_rank: 20, gold_costs: new Array(20).fill(200) },
    { id: "104", branch: 1, node_type: "PLAYER_PASSIVE", name_zh: "所有骰子傷害", max_rank: 50, gold_costs: new Array(50).fill(500) },
    { id: "105", branch: 1, node_type: "PLAYER_PASSIVE", name_zh: "起始SP增加", max_rank: 1 },
    { id: "106", branch: 1, node_type: "PLAYER_PASSIVE", name_zh: "粉碎強化", max_rank: 1 },
    { id: "107", branch: 1, node_type: "PERK", name_zh: "大衛", max_rank: 1 }
  ];

  assert.equal(isNodeContributingToFactionLevel(testNodes[0]), true); // DICE -> true
  assert.equal(isNodeContributingToFactionLevel(testNodes[1]), true); // DICE_RUNE -> true
  assert.equal(isNodeContributingToFactionLevel(testNodes[2]), true); // 專屬被動 -> true
  assert.equal(isNodeContributingToFactionLevel(testNodes[3]), false); // 所有骰子傷害 -> false (排除)
  assert.equal(isNodeContributingToFactionLevel(testNodes[4]), false); // 起始SP增加 -> false (排除)
  assert.equal(isNodeContributingToFactionLevel(testNodes[5]), true); // 粉碎強化 -> true
  assert.equal(isNodeContributingToFactionLevel(testNodes[6]), true); // PERK -> true

  // 全解鎖（瀏覽模式）：1 + 50 + 20 + 1 + 1 = 73
  const fullLevel = calculateBranchFactionLevel(1, { ranks: null, nodes: testNodes });
  assert.equal(fullLevel, 73);

  // 部分模擬分配：骰子(1) + 符文升到 15 階(15) + 專屬被動升到 5 階(5) + 粉碎強化(1) = 22
  const simRanks = { "101": 1, "102": 15, "103": 5, "104": 50, "106": 1 };
  const simLevel = calculateBranchFactionLevel(1, { ranks: simRanks, nodes: testNodes });
  assert.equal(simLevel, 22);

  const allLevels = calculateAllFactionLevels({ ranks: simRanks, nodes: testNodes });
  assert.equal(allLevels[1], 22);
  assert.equal(allLevels[2], 0);
});

test("simulation revoke: single node revoke and downstream batch revoke (取消至此)", async () => {
  const { planRevokeNode, applyRevokeNode } = await import("../../src/domain/simulation_plan.js");
  const chainNodes = [
    { id: "A", is_base: true, node_type: "DICE", max_rank: 1, gold_costs: [0] },
    { id: "B", incoming: ["A"], node_type: "PLAYER_PASSIVE", max_rank: 1, gold_costs: [100] },
    { id: "C", incoming: ["B"], node_type: "PLAYER_PASSIVE", max_rank: 1, gold_costs: [200] },
    { id: "D", incoming: ["C"], node_type: "DICE", max_rank: 1, gold_costs: [300] }
  ];

  // 全部解鎖 A -> B -> C -> D
  const fullRanks = { A: 1, B: 1, C: 1, D: 1 };
  const state = { active: true, ranks: fullRanks, initialIds: ["A"], spent: { gold: 600, core: 0 } };

  // 1. 取消末端節點 D（沒有後續已解鎖節點 -> 取消解鎖）
  const planD = planRevokeNode("D", state, chainNodes);
  assert.equal(planD.ok, true);
  assert.equal(planD.isBatchRevoke, false);
  assert.deepEqual(planD.nodesToRevoke, ["D"]);

  const resD = applyRevokeNode("D", state, chainNodes);
  assert.equal(resD.ok, true);
  assert.deepEqual(resD.state.ranks, { A: 1, B: 1, C: 1 });
  assert.equal(resD.state.spent.gold, 300);

  // 2. 取消中間節點 B（後續 C 和 D 依賴 B -> 取消至此）
  const planB = planRevokeNode("B", state, chainNodes);
  assert.equal(planB.ok, true);
  assert.equal(planB.isBatchRevoke, true);
  assert.deepEqual(planB.nodesToRevoke.sort((a, b) => a.localeCompare(b)), ["B", "C", "D"].sort((a, b) => a.localeCompare(b)));

  const resB = applyRevokeNode("B", state, chainNodes);
  assert.equal(resB.ok, true);
  assert.deepEqual(resB.state.ranks, { A: 1 });
  assert.equal(resB.state.spent.gold, 0);

  // 3. Store 整合驗證
  const store = new AppStore();
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: { nodes: chainNodes, edges: [] } });
  store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: true });
  store.dispatch({ type: ActionTypes.SIMULATION_BATCH_UNLOCK, payload: { nodeId: "D" } });
  assert.deepEqual(store.getState().simulation.ranks, { A: 1, B: 1, C: 1, D: 1 });

  store.dispatch({ type: ActionTypes.SIMULATION_REVOKE_NODE, payload: { nodeId: "B" } });
  assert.deepEqual(store.getState().simulation.ranks, { A: 1 });
  assert.equal(store.getState().simulation.spent.gold, 0);
});
