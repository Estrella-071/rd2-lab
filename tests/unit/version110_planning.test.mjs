import test from "node:test";
import assert from "node:assert/strict";
import { getNodeCost, sumNodeCosts, evaluateNode, planBatchUnlock, planMaxRank, recomputeSimulationSpent } from "../../src/domain/simulation_plan.js";
import { generateSimulationShareImage } from "../../src/infra/share_image_exporter.js";

const nodes = [
  { id: "a", node_type: "DICE_RUNE", max_rank: 50, incoming: [], gold_costs: Array(50).fill(1), core_costs: Array(50).fill(2) },
  { id: "b", node_type: "DICE_RUNE", max_rank: 1, incoming: [], gold_costs: [1], core_costs: [2] },
  { id: "solar", node_type: "DICE", max_rank: 1, incoming: ["b"], gold_costs: [100000], core_costs: [2000], cost_resource: "CORE_SOLAR", rank_requirements: [{ node_id: "a", rank: 50 }, { node_id: "b", rank: 1 }] },
  { id: "solar_rune", node_type: "DICE_RUNE", max_rank: 1, incoming: ["solar"], gold_costs: [50000], core_costs: [100] }
];

function makeCanvasContext() {
  const calls = [];
  return {
    calls,
    beginPath: () => calls.push("beginPath"),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    arcTo: (...args) => calls.push(["arcTo", ...args]),
    arc: (...args) => calls.push(["arc", ...args]),
    closePath: () => calls.push("closePath"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    fillText: (...args) => calls.push(["fillText", ...args]),
    strokeText: (...args) => calls.push(["strokeText", ...args]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
    setTransform: (...args) => calls.push(["setTransform", ...args])
  };
}

function makeCanvas(context) {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => "data:image/png;base64,ZmFrZQ==",
    toBlob: (callback) => callback({ type: "image/png" })
  };
}

test("1.1.0: Solar Core spending is separate from normal cores", () => {
  assert.deepEqual(getNodeCost(nodes[2], 1), { gold: 100000, core: 0, solar: 2000 });
  assert.deepEqual(sumNodeCosts(nodes[2], 0, 1), { gold: 100000, core: 0, solar: 2000 });
  const state = recomputeSimulationSpent({ ranks: { a: 50, b: 1, solar: 1 } }, nodes);
  assert.equal(state.spent.solar, 2000);
  assert.equal(state.spent.core, 102);
});

test("1.1.0: rank prerequisites gate direct and max-rank, while batch allocation automatically fulfills required ranks", () => {
  const state = { ranks: { a: 49, b: 1 } };
  assert.equal(evaluateNode("solar", state, nodes).canUnlock, false);
  assert.equal(planMaxRank("solar", state, nodes).ok, false);
  const batchPlan = planBatchUnlock("solar", state, nodes);
  assert.equal(batchPlan.ok, true);
  assert.deepEqual(batchPlan.nodeIds, ["a", "solar"]);
  assert.equal(batchPlan.targetRanks.a, 50);
  assert.equal(batchPlan.targetRanks.solar, 1);
  assert.equal(evaluateNode("solar", { ranks: { a: 50, b: 1 } }, nodes).canUnlock, true);
});

test("1.1.0: resetting a rank prerequisite removes its dependent Solar allocation", () => {
  const state = recomputeSimulationSpent({ ranks: { a: 49, b: 1, solar: 1 } }, nodes);
  assert.equal(state.ranks.solar, undefined);
  assert.equal(state.spent.solar, undefined);
});

test("1.1.0: cascading de-allocation when rank prerequisite is reset", () => {
  const fullState = recomputeSimulationSpent({ ranks: { a: 50, b: 1, solar: 1, solar_rune: 1 } }, nodes);
  assert.equal(fullState.ranks.solar, 1);
  assert.equal(fullState.ranks.solar_rune, 1);
  assert.equal(fullState.spent.solar, 2000);
  assert.equal(fullState.spent.core, 202);

  const resetState = recomputeSimulationSpent({ ranks: { a: 49, b: 1, solar: 1, solar_rune: 1 } }, nodes);
  assert.equal(resetState.ranks.solar, undefined);
  assert.equal(resetState.ranks.solar_rune, undefined);
  assert.equal(resetState.spent.solar, undefined);
  assert.equal(resetState.spent.core, 100);
});

test("1.1.0: share image exports solar core badge when solar cores are spent", async () => {
  const context = makeCanvasContext();
  const canvas = makeCanvas(context);
  const simulation = {
    spent: { gold: 100000, core: 50, solar: 2000 },
    team: { dice: [] }
  };
  const result = await generateSimulationShareImage({
    simulation,
    treeData: { nodes, edges: [] },
    canvas,
    currencyLabels: { gold: "金幣", core: "核心", solar: "太陽核心" },
    renderTree: async () => true
  });
  assert.equal(result.ok, true);
  const fillTexts = context.calls.filter((call) => Array.isArray(call) && call[0] === "fillText");
  assert.ok(fillTexts.some(([, text]) => text === "2,000"), "Should render 2,000 solar cores");
  assert.ok(fillTexts.some(([, text]) => text === "50"), "Should render 50 cores");
  assert.ok(fillTexts.some(([, text]) => text === "100,000"), "Should render 100,000 gold");
});

test("1.1.0: batch unlocking Solar Dice or Solar Node automatically fulfills rank 50 fire and both fire runes", () => {
  const treeNodes = [
    { id: "1001", node_type: "DICE", max_rank: 1, incoming: [], gold_costs: [0], core_costs: [0] },
    { id: "1201", node_type: "TALENT", max_rank: 50, incoming: ["1001"], gold_costs: Array(50).fill(100), core_costs: Array(50).fill(2) },
    { id: "1301", node_type: "DICE_RUNE", max_rank: 1, incoming: ["1201"], gold_costs: [500], core_costs: [5] },
    { id: "1401", node_type: "DICE_RUNE", max_rank: 1, incoming: ["1201"], gold_costs: [500], core_costs: [5] },
    {
      id: "1501",
      node_type: "DICE",
      max_rank: 1,
      incoming: ["1301", "1401"],
      cost_resource: "CORE_SOLAR",
      gold_costs: [100000],
      core_costs: [2000],
      rank_requirements: [
        { node_id: "1201", rank: 50 },
        { node_id: "1301", rank: 1 },
        { node_id: "1401", rank: 1 }
      ]
    },
    { id: "1601", node_type: "TALENT", max_rank: 20, incoming: ["1501"], cost_resource: "CORE_SOLAR", gold_costs: [50000], core_costs: [100] }
  ];

  const initialState = { ranks: { "1001": 1 } };
  const plan1501 = planBatchUnlock("1501", initialState, treeNodes);
  assert.equal(plan1501.ok, true);
  assert.deepEqual(plan1501.nodeIds, ["1201", "1301", "1401", "1501"]);
  assert.equal(plan1501.targetRanks["1201"], 50);
  assert.equal(plan1501.targetRanks["1301"], 1);
  assert.equal(plan1501.targetRanks["1401"], 1);
  assert.equal(plan1501.targetRanks["1501"], 1);
  assert.equal(plan1501.total.solar, 2000);

  const plan1601 = planBatchUnlock("1601", initialState, treeNodes);
  assert.equal(plan1601.ok, true);
  assert.deepEqual(plan1601.nodeIds, ["1201", "1301", "1401", "1501", "1601"]);
  assert.equal(plan1601.targetRanks["1601"], 1);
  assert.equal(plan1601.total.solar, 2100);
});
