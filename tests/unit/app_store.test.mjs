import test from "node:test";
import assert from "node:assert/strict";

import { AppStore, ActionTypes, createInitialState } from "../../src/app/store/app_store.js";

test("AppStore: Initial state & subscribe pattern", () => {
  const store = new AppStore();
  const state = store.getState();
  assert.equal(state.isDataLoaded, false);
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.golem.rank, 1);

  let notifiedCount = 0;
  let lastAction = null;
  const unsubscribe = store.subscribe((newState, action) => {
    notifiedCount++;
    lastAction = action;
  });

  store.dispatch({ type: ActionTypes.SET_POWERUP_LEVEL, payload: 5 });
  assert.equal(store.getState().powerupLevel, 5);
  assert.equal(notifiedCount, 1);
  assert.equal(lastAction.type, ActionTypes.SET_POWERUP_LEVEL);

  unsubscribe();
  store.dispatch({ type: ActionTypes.SET_POWERUP_LEVEL, payload: 8 });
  assert.equal(store.getState().powerupLevel, 8);
  assert.equal(notifiedCount, 1); // Unsubscribed
});

test("AppStore: SET_GAME_DATA populates nodesMap and computes matching nodes", () => {
  const store = new AppStore();
  const mockData = {
    nodes: [
      { id: "1001", name: "風骰子", faction: 1, type: "DICE", desc: "快速攻擊" },
      { id: "1002", name: "火骰子", faction: 2, type: "DICE", desc: "範圍傷害" },
      { id: "2001", name: "全域攻速", faction: 1, type: "PLAYER_PASSIVE", desc: "提升攻速" }
    ],
    edges: [
      { source: "1001", target: "1002" }
    ],
    factions: { 1: { name: "自然" }, 2: { name: "工學" } }
  };

  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: mockData });
  const st = store.getState();

  assert.equal(st.isDataLoaded, true);
  assert.equal(st.nodesMap.size, 3);
  assert.equal(st.matchingNodeIds.size, 3);

  // Filter by Faction 1
  store.dispatch({
    type: ActionTypes.SET_FILTER,
    payload: { factions: new Set([1]) }
  });
  assert.equal(store.getState().matchingNodeIds.size, 2); // 1001 and 2001

  // Filter by Type DICE
  store.dispatch({
    type: ActionTypes.SET_FILTER,
    payload: { nodeTypes: new Set(["DICE"]) }
  });
  assert.equal(store.getState().matchingNodeIds.size, 1); // Only 1001

  // Search keyword
  store.dispatch({
    type: ActionTypes.SET_FILTER,
    payload: { search: "風" }
  });
  assert.equal(store.getState().matchingNodeIds.size, 1);

  // Clear filters
  store.dispatch({ type: ActionTypes.CLEAR_FILTERS });
  assert.equal(store.getState().matchingNodeIds.size, 3);
});

test("AppStore: SET_GAME_DATA reconciles selection against refreshed nodes", () => {
  const store = new AppStore();
  store.dispatch({
    type: ActionTypes.SET_GAME_DATA,
    payload: {
      nodes: [
        { id: "1", name: "Parent", next_nodes: ["2"] },
        { id: "2", name: "Old child", incoming: ["1"] }
      ],
      edges: [{ source: "1", target: "2" }]
    }
  });
  store.dispatch({ type: ActionTypes.SELECT_NODE, payload: "2" });

  store.dispatch({
    type: ActionTypes.SET_GAME_DATA,
    payload: {
      nodes: [{ id: "1", name: "Parent" }],
      edges: []
    }
  });
  let state = store.getState();
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.selectedNode, null);
  assert.equal(state.activePrereqIds.size, 0);
  assert.equal(state.activeEdgeIds.size, 0);

  store.dispatch({
    type: ActionTypes.SET_GAME_DATA,
    payload: {
      nodes: [
        { id: "1", name: "Parent", next_nodes: ["2"] },
        { id: "2", name: "Updated child", incoming: ["1"] }
      ],
      edges: [{ source: "1", target: "2" }]
    }
  });
  store.dispatch({ type: ActionTypes.SELECT_NODE, payload: "2" });
  store.dispatch({
    type: ActionTypes.SET_GAME_DATA,
    payload: {
      nodes: [
        { id: "1", name: "Parent", next_nodes: ["2"] },
        { id: "2", name: "Newest child", incoming: ["1"] }
      ],
      edges: [{ source: "1", target: "2" }]
    }
  });
  state = store.getState();
  assert.equal(state.selectedNodeId, "2");
  assert.equal(state.selectedNode.name, "Newest child");
  assert.deepEqual([...state.activePrereqIds], ["2", "1"]);
  assert.equal(state.activeEdgeIds.has("1->2"), true);
});

test("AppStore: SELECT_NODE computes DAG active path & edge states", () => {
  const store = new AppStore();
  const mockData = {
    nodes: [
      { id: "1", name: "Node 1", next_nodes: ["2"] },
      { id: "2", name: "Node 2", incoming: ["1"], next_nodes: ["3"] },
      { id: "3", name: "Node 3", incoming: ["2"] }
    ],
    edges: [
      { source: "1", target: "2" },
      { source: "2", target: "3" }
    ]
  };
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: mockData });

  // Select Node 3
  store.dispatch({ type: ActionTypes.SELECT_NODE, payload: "3" });
  let st = store.getState();
  assert.equal(st.selectedNodeId, "3");
  assert.equal(st.selectedNode.name, "Node 3");
  assert.equal(st.activePrereqIds.has("1"), true);
  assert.equal(st.activePrereqIds.has("2"), true);
  assert.equal(st.activePrereqIds.has("3"), true);
  assert.equal(st.activeEdgeIds.has("1->2"), true);
  assert.equal(st.activeEdgeIds.has("2->3"), true);

  // Deselect
  store.dispatch({ type: ActionTypes.DESELECT_NODE });
  st = store.getState();
  assert.equal(st.selectedNodeId, null);
  assert.equal(st.activePrereqIds.size, 0);
  assert.equal(st.activeEdgeIds.size, 0);
  assert.equal(st.showPrereqMode, true);

  store.dispatch({
    type: ActionTypes.DESELECT_NODE,
    payload: { resetPrereqMode: true }
  });
  assert.equal(store.getState().showPrereqMode, false);
});

test("AppStore: tooltip close preserves prerequisite display until the next blank click", () => {
  const store = new AppStore();
  store.dispatch({
    type: ActionTypes.SET_GAME_DATA,
    payload: {
      nodes: [
        { id: "1", name: "Parent", next_nodes: ["2"] },
        { id: "2", name: "Child", incoming: ["1"] }
      ],
      edges: [{ source: "1", target: "2" }]
    }
  });
  store.dispatch({ type: ActionTypes.SELECT_NODE, payload: "2" });
  const selectedPath = store.getState().activePrereqIds;

  store.dispatch({
    type: ActionTypes.DESELECT_NODE,
    payload: { preservePrereqDisplay: true }
  });
  let state = store.getState();
  assert.equal(state.selectedNodeId, null);
  assert.deepEqual([...state.activePrereqIds], [...selectedPath]);
  assert.equal(state.activeEdgeIds.has("1->2"), true);
  assert.equal(state.showPrereqMode, true);

  store.dispatch({ type: ActionTypes.DESELECT_NODE });
  state = store.getState();
  assert.equal(state.activePrereqIds.size, 0);
  assert.equal(state.activeEdgeIds.size, 0);
  assert.equal(state.showPrereqMode, true);
});

test("AppStore: selection clips the four configured highlights at their start dice", () => {
  const store = new AppStore();
  const nodes = [
    { id: "5002", node_type: "DICE", max_rank: 1 },
    { id: "5007", node_type: "DICE", incoming: ["5002"], max_rank: 1 },
    { id: "5006", node_type: "DICE", incoming: ["5007"], max_rank: 1 },
    { id: "5101", node_type: "PLAYER_PASSIVE", incoming: ["5006"], max_rank: 1 },
    { id: "5003", node_type: "DICE", incoming: ["5101"], max_rank: 1 },
    { id: "5109", node_type: "PLAYER_PASSIVE", incoming: ["5002"], max_rank: 1 },
    { id: "5009", node_type: "DICE", incoming: ["5109"], max_rank: 1 },
    { id: "5008", node_type: "DICE", incoming: ["5009"], max_rank: 1 },
    { id: "5105", node_type: "PLAYER_PASSIVE", incoming: ["5008"], max_rank: 10 },
    { id: "5110", node_type: "PLAYER_PASSIVE", incoming: ["5008"], max_rank: 15 }
  ];
  const edges = [
    ["5002", "5007"], ["5007", "5006"], ["5006", "5101"], ["5101", "5003"],
    ["5002", "5109"], ["5109", "5009"], ["5009", "5008"], ["5008", "5105"], ["5008", "5110"]
  ].map(([source, target]) => ({ source, target }));
  store.dispatch({ type: ActionTypes.SET_GAME_DATA, payload: { nodes, edges } });
  store.dispatch({ type: ActionTypes.SELECT_NODE, payload: "5003" });
  let state = store.getState();
  assert.deepEqual([...state.activePrereqIds], ["5003", "5101", "5006"], "the configured topology should stop at the Greed start dice in browse mode");
  assert.equal(state.activeEdgeIds.has("5006->5101"), true);
  assert.equal(state.activeEdgeIds.has("5002->5007"), false);

  store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: true });
  state = store.getState();
  assert.deepEqual([...state.activePrereqIds], ["5003", "5101", "5006"]);
  assert.equal(state.activeEdgeIds.has("5006->5101"), true);
  assert.equal(state.activeEdgeIds.has("5002->5007"), false);

  store.dispatch({ type: ActionTypes.SELECT_NODE, payload: "5105" });
  state = store.getState();
  assert.deepEqual([...state.activePrereqIds], ["5105", "5008"]);
  assert.equal(state.activeEdgeIds.has("5008->5105"), true);
  assert.equal(state.activeEdgeIds.has("5002->5109"), false);

  store.dispatch({ type: ActionTypes.SET_SIMULATION_MODE, payload: false });
  state = store.getState();
  assert.deepEqual([...state.activePrereqIds], ["5105", "5008"], "the same configured topology should remain after leaving simulation mode");
});

test("AppStore: SET_GOLEM_STAT cross-synchronizes with pure domain rules", () => {
  const store = new AppStore();

  // Rank 1
  assert.equal(store.getState().golem.rank, 1);
  assert.equal(store.getState().golem.lifePercent, 50);

  // Set Rank 20 -> Cap reached
  store.dispatch({
    type: ActionTypes.SET_GOLEM_STAT,
    payload: { field: "rank", value: 20 }
  });
  let g = store.getState().golem;
  assert.equal(g.rank, 20);
  assert.equal(g.lifePercent, 1000);
  assert.equal(g.coopSp, 10000);
  assert.equal(g.battleSp, 10000);

  // Reverse sync: Set lifePercent to 500 (Rank 10)
  store.dispatch({
    type: ActionTypes.SET_GOLEM_STAT,
    payload: { field: "lifePercent", value: 500 }
  });
  g = store.getState().golem;
  assert.equal(g.rank, 10);
  assert.equal(g.coopSp, 5000);
});
