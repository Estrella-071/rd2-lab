import { computeEdgeStates } from "../../domain/dag_topology.js";
import { synchronizeGolemStats } from "../../domain/sp_golem.js";
import {
  applyBatchUnlock,
  applyMaxRank,
  applyNodeRank,
  applyRevokeNode,
  createSimulationState,
  getConfiguredPrerequisiteIds,
  getNodeMap,
  normalizeTeam,
  recomputeSimulationSpent
} from "../../domain/simulation_plan.js";
import { getDataVersion } from "../../domain/simulation_share.js";

/**
 * Action Types
 */
export const ActionTypes = {
  SET_GAME_DATA: "SET_GAME_DATA",
  SET_BOSS_EVENTS: "SET_BOSS_EVENTS",
  SET_DATA_METADATA: "SET_DATA_METADATA",
  SET_CHANGELOG: "SET_CHANGELOG",
  SELECT_NODE: "SELECT_NODE",
  DESELECT_NODE: "DESELECT_NODE",
  SET_FILTER: "SET_FILTER",
  CLEAR_FILTERS: "CLEAR_FILTERS",
  SET_GOLEM_STAT: "SET_GOLEM_STAT",
  SET_POWERUP_LEVEL: "SET_POWERUP_LEVEL",
  SET_DOT_LEVEL: "SET_DOT_LEVEL",
  SET_ACTIVE_TAB: "SET_ACTIVE_TAB",
  UPDATE_VIEWPORT: "UPDATE_VIEWPORT",
  SET_COMPENDIUM_FILTER: "SET_COMPENDIUM_FILTER",
  SET_MODAL: "SET_MODAL",
  TOGGLE_PREREQ_MODE: "TOGGLE_PREREQ_MODE",
  SET_SHOW_PREREQ_MODE: "SET_SHOW_PREREQ_MODE",
  SET_NODE_POSITIONS: "SET_NODE_POSITIONS",
  SET_SIMULATION_MODE: "SET_SIMULATION_MODE",
  SIMULATION_UNLOCK_NODE: "SIMULATION_UNLOCK_NODE",
  SIMULATION_MAX_NODE: "SIMULATION_MAX_NODE",
  SIMULATION_BATCH_UNLOCK: "SIMULATION_BATCH_UNLOCK",
  SIMULATION_REVOKE_NODE: "SIMULATION_REVOKE_NODE",
  SIMULATION_RESET: "SIMULATION_RESET",
  SIMULATION_SET_TEAM: "SIMULATION_SET_TEAM",
  SET_SIMULATION_STATE: "SET_SIMULATION_STATE"
};

/**
 * Initial Application State
 */
export function createInitialState() {
  return {
    // Data Models
    treeData: { nodes: [], edges: [], factions: {}, meta: {} },
    nodesMap: new Map(),
    nodePositions: new Map(),
    bossEvents: { events: [], meta: {} },
    dataMetadata: { canonical: {}, source: {}, versions: [] },
    changelog: { entries: [] },
    isDataLoaded: false,

    // Selection & Topology State
    selectedNodeId: null,
    selectedNode: null,
    activePrereqIds: new Set(),
    activeEdgeIds: new Set(),
    showPrereqMode: true,

    // Filtering State
    filters: {
      search: "",
      factions: new Set(),
      nodeTypes: new Set()
    },
    matchingNodeIds: new Set(),

    // SP Golem Stat Sync State
    golem: {
      rank: 1,
      lifePercent: 50,
      coopSp: 500,
      battleSp: 500
    },

    // Bonus Tuning State
    powerupLevel: 0,
    dotLevel: 0,

    // UI & Navigation State
    activeTab: "tree", // "tree" | "compendium" | "events"
    viewport: {
      x: 0,
      y: 0,
      scale: 1.0,
      baseScale: 1.0,
      formattedZoom: "100%"
    },

    // Compendium UI State
    compendium: {
      search: "",
      activeFaction: null,
      selectedDiceId: null
    },

    // Modal State
    activeModal: null, // null | "dice_detail" | "coming_soon"

    // Simulation planning state is intentionally separate from browsing state.
    // It contains only user allocations, not a second copy of canonical data.
    simulation: {
      active: false,
      ranks: {},
      initialIds: [],
      spent: { gold: 0, core: 0 },
      team: { dice: [], commonNodes: [] },
      dataVersion: "unknown",
      warnings: [],
      lastResult: null
    }
  };
}

function reduceGameData(state, action, computeMatchingNodes) {
  const treeData = action.payload || { nodes: [], edges: [], factions: {} };
  const nodesMap = getNodeMap(treeData);
  const matchingNodeIds = computeMatchingNodes(treeData.nodes || [], state.filters);
  const selectedNodeId = state.selectedNodeId && nodesMap.has(String(state.selectedNodeId))
    ? String(state.selectedNodeId)
    : null;
  const selectedNode = selectedNodeId ? nodesMap.get(selectedNodeId) : null;
  const previousSimulation = state.simulation || createSimulationState(nodesMap);
  const activePrereqIds = selectedNodeId
    ? getSelectedPrerequisiteIds(selectedNodeId, nodesMap)
    : new Set();
  const activeEdgeIds = computeEdgeStates(treeData.edges || [], activePrereqIds);
  const simulation = createSimulationState(treeData, {
    active: previousSimulation.active,
    ranks: previousSimulation.ranks,
    initialIds: previousSimulation.initialIds,
    team: previousSimulation.team,
    dataVersion: getDataVersion(treeData),
    warnings: previousSimulation.warnings
  });
  return {
    ...state,
    treeData,
    nodesMap,
    isDataLoaded: true,
    matchingNodeIds,
    selectedNodeId,
    selectedNode,
    activePrereqIds,
    activeEdgeIds,
    simulation: { ...simulation, lastResult: null }
  };
}

function reduceSelection(state, action) {
  const nodeId = action.payload ? String(action.payload) : null;
  if (!nodeId) {
    return {
      ...state,
      selectedNodeId: null,
      selectedNode: null,
      activePrereqIds: new Set(),
      activeEdgeIds: new Set()
    };
  }
  const selectedNode = state.nodesMap.get(nodeId) || null;
  const activePrereqIds = getSelectedPrerequisiteIds(nodeId, state.nodesMap);
  return {
    ...state,
    selectedNodeId: nodeId,
    selectedNode,
    activePrereqIds,
    activeEdgeIds: computeEdgeStates(state.treeData.edges || [], activePrereqIds)
  };
}

function getSelectedPrerequisiteIds(nodeId, nodesMap) {
  return getConfiguredPrerequisiteIds(nodeId, nodesMap);
}

function reduceSimulationMode(state, action) {
  const active = Boolean(action.payload);
  const activePrereqIds = state.selectedNodeId
    ? getSelectedPrerequisiteIds(state.selectedNodeId, state.nodesMap)
    : new Set();
  return {
    ...state,
    simulation: {
      ...(state.simulation || createSimulationState(state.nodesMap)),
      active,
      lastResult: null
    },
    activePrereqIds,
    activeEdgeIds: computeEdgeStates(state.treeData.edges || [], activePrereqIds)
  };
}

function reduceFilters(state, action, computeMatchingNodes) {
  const filters = action.type === ActionTypes.CLEAR_FILTERS
    ? { search: "", factions: new Set(), nodeTypes: new Set() }
    : { ...state.filters, ...action.payload };
  return {
    ...state,
    filters,
    matchingNodeIds: computeMatchingNodes(state.treeData.nodes || [], filters)
  };
}

function reduceSimulationMutation(state, action) {
  const simulation = state.simulation || createSimulationState(state.nodesMap);
  if (!simulation.active) {
    return {
      ...state,
      simulation: { ...simulation, lastResult: { ok: false, reason: "simulation-inactive" } }
    };
  }
  const nodeId = action.payload?.nodeId ?? action.payload;
  const operation = {
    [ActionTypes.SIMULATION_MAX_NODE]: () => applyMaxRank(nodeId, simulation, state.nodesMap),
    [ActionTypes.SIMULATION_BATCH_UNLOCK]: () => applyBatchUnlock(nodeId, simulation, state.nodesMap),
    [ActionTypes.SIMULATION_REVOKE_NODE]: () => applyRevokeNode(nodeId, simulation, state.nodesMap),
    [ActionTypes.SIMULATION_UNLOCK_NODE]: () => applyNodeRank(simulation, nodeId, state.nodesMap, action.payload?.targetRank ?? null)
  }[action.type];
  const result = operation();
  if (!result?.ok) {
    return {
      ...state,
      simulation: { ...simulation, lastResult: { ...result, ok: false } }
    };
  }
  return {
    ...state,
    simulation: { ...result.state, active: simulation.active, team: simulation.team, lastResult: { ...result, ok: true } }
  };
}

function reduceSimulationState(state, action) {
  const simulation = action.payload || createSimulationState(state.nodesMap);
  return {
    ...state,
    simulation: {
      ...recomputeSimulationSpent(simulation, state.nodesMap),
      active: simulation.active !== false,
      lastResult: null
    }
  };
}

function reduceSimulationReset(state) {
  const current = state.simulation || {};
  return {
    ...state,
    simulation: {
      ...createSimulationState(state.nodesMap, {
        active: current.active,
        dataVersion: current.dataVersion,
        team: current.team
      }),
      lastResult: { ok: true, type: "reset" }
    }
  };
}

function reduceDataMetadata(state, action) {
  const dataMetadata = action.payload || { canonical: {}, source: {}, versions: [] };
  const canonicalVersion = dataMetadata?.canonical?.game_version;
  return {
    ...state,
    dataMetadata,
    simulation: canonicalVersion
      ? { ...(state.simulation || createSimulationState(state.nodesMap)), dataVersion: String(canonicalVersion) }
      : state.simulation
  };
}

function reduceGolemStat(state, action) {
  const { field, value } = action.payload;
  return {
    ...state,
    golem: synchronizeGolemStats(field, value, state.golem.rank)
  };
}

function normalizeSearchText(value) {
  return String(value || "").replaceAll("渾", "混").toLowerCase();
}

function nodeMatchesSearch(node, searchLower) {
  if (!searchLower) return true;
  const searchableValues = [
    node.name_zh || node.name,
    node.short_label,
    node.description_zh || node.desc,
    node.dice_awaken,
    node.dice_type,
    Array.isArray(node.tags) ? node.tags.join(" ") : ""
  ];
  return searchableValues.some((value) => normalizeSearchText(value).includes(searchLower));
}

function nodeMatchesFilters(node, filters, searchLower) {
  const branchId = Number(node.branch ?? node.faction ?? 0);
  if (filters.factions?.size > 0 && !filters.factions.has(branchId)) return false;
  const nodeType = node.node_type ?? node.type ?? "";
  if (filters.nodeTypes?.size > 0 && !filters.nodeTypes.has(nodeType)) return false;
  return nodeMatchesSearch(node, searchLower);
}

const SIMPLE_REDUCERS = Object.freeze({
  [ActionTypes.SET_BOSS_EVENTS]: (state, action) => ({ ...state, bossEvents: action.payload || { events: [] } }),
  [ActionTypes.SET_CHANGELOG]: (state, action) => ({ ...state, changelog: action.payload || { entries: [] } }),
  [ActionTypes.SET_NODE_POSITIONS]: (state, action) => ({
    ...state,
    nodePositions: action.payload instanceof Map ? action.payload : new Map(Object.entries(action.payload || {}))
  }),
  [ActionTypes.SET_POWERUP_LEVEL]: (state, action) => ({
    ...state,
    powerupLevel: Math.max(0, Math.min(14, Number(action.payload) || 0))
  }),
  [ActionTypes.SET_DOT_LEVEL]: (state, action) => ({
    ...state,
    dotLevel: Math.max(0, Math.min(6, Number(action.payload) || 0))
  }),
  [ActionTypes.SET_ACTIVE_TAB]: (state, action) => ({ ...state, activeTab: action.payload }),
  [ActionTypes.UPDATE_VIEWPORT]: (state, action) => ({
    ...state,
    viewport: { ...state.viewport, ...action.payload }
  }),
  SET_VIEWPORT: (state, action) => ({
    ...state,
    viewport: { ...state.viewport, ...action.payload }
  }),
  [ActionTypes.SET_COMPENDIUM_FILTER]: (state, action) => ({
    ...state,
    compendium: { ...state.compendium, ...action.payload }
  }),
  [ActionTypes.SET_MODAL]: (state, action) => ({ ...state, activeModal: action.payload }),
  [ActionTypes.SET_SIMULATION_MODE]: reduceSimulationMode,
  [ActionTypes.SIMULATION_SET_TEAM]: (state, action) => {
    const simulation = state.simulation || createSimulationState(state.nodesMap);
    return { ...state, simulation: { ...simulation, team: normalizeTeam(action.payload), lastResult: null } };
  },
  [ActionTypes.TOGGLE_PREREQ_MODE]: (state, action) => ({
    ...state,
    showPrereqMode: action.payload !== undefined ? Boolean(action.payload) : !state.showPrereqMode
  }),
  [ActionTypes.SET_SHOW_PREREQ_MODE]: (state, action) => ({
    ...state,
    showPrereqMode: action.payload !== undefined ? Boolean(action.payload) : !state.showPrereqMode
  })
});

/**
 * AppStore
 * 
 * Unidirectional Reactive State Store implementing the Store Pattern.
 * Replaces global untyped event bus with predictable state transitions.
 */
export class AppStore {
  /**
   * @param {object} [initialState]
   */
  constructor(initialState = createInitialState()) {
    this._state = initialState;
    this._listeners = new Set();
  }

  /**
   * Get immutable snapshot of current state.
   * @returns {object}
   */
  getState() {
    return this._state;
  }

  /**
   * Subscribe to state updates.
   * @param {Function} listener - Callback (state, action) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Dispatch an action to mutate state.
   * @param {{ type: string, payload?: any }} action
   */
  dispatch(action) {
    if (!action || typeof action.type !== "string") {
      throw new Error("AppStore.dispatch: action must have a valid string type.");
    }
    const prevState = this._state;
    this._state = this._reduce(prevState, action);

    // Notify all listeners
    for (const listener of this._listeners) {
      try {
        listener(this._state, action, prevState);
      } catch (err) {
        console.error("AppStore listener error:", err);
      }
    }
  }

  _reduce(state, action) {
    const simpleReducer = SIMPLE_REDUCERS[action.type];
    if (simpleReducer) return simpleReducer(state, action);
    if (action.type === ActionTypes.SET_GAME_DATA) {
      return reduceGameData(state, action, this._computeMatchingNodes.bind(this));
    }
    if (action.type === ActionTypes.SET_DATA_METADATA) return reduceDataMetadata(state, action);
    if (action.type === ActionTypes.SELECT_NODE) return reduceSelection(state, action);
    if (action.type === ActionTypes.DESELECT_NODE) {
      return {
        ...state,
        selectedNodeId: null,
        selectedNode: null,
        activePrereqIds: new Set(),
        activeEdgeIds: new Set(),
        showPrereqMode: action.payload?.resetPrereqMode ? false : state.showPrereqMode
      };
    }
    if (action.type === ActionTypes.SET_FILTER || action.type === ActionTypes.CLEAR_FILTERS) {
      return reduceFilters(state, action, this._computeMatchingNodes.bind(this));
    }
    if (action.type === ActionTypes.SET_GOLEM_STAT) return reduceGolemStat(state, action);
    if ([
      ActionTypes.SIMULATION_UNLOCK_NODE,
      ActionTypes.SIMULATION_MAX_NODE,
      ActionTypes.SIMULATION_BATCH_UNLOCK,
      ActionTypes.SIMULATION_REVOKE_NODE
    ].includes(action.type)) {
      return reduceSimulationMutation(state, action);
    }
    if (action.type === ActionTypes.SET_SIMULATION_STATE) return reduceSimulationState(state, action);
    if (action.type === ActionTypes.SIMULATION_RESET) return reduceSimulationReset(state);
    return state;
  }

  _computeMatchingNodes(nodes, filters) {
    const matching = new Set();
    const searchLower = normalizeSearchText(filters.search).trim();

    for (const node of nodes) {
      if (nodeMatchesFilters(node, filters, searchLower)) matching.add(String(node.id));
    }
    return matching;
  }
}
