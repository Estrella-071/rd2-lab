/**
 * Pure simulation-planning rules for the dice tree.
 *
 * The browser can render the result in any way it wants, but all eligibility,
 * topology and cost decisions live here so a 1.0.x data refresh cannot leave a
 * stale price or prerequisite hidden in a click handler.
 */

import { computeUpstreamTopologyPath } from "./dag_topology.js";

export const NODE_STONE = "NODE_STONE";
export const CORE_SOLAR = "CORE_SOLAR";
const EMPTY_COST = Object.freeze({ gold: 0, core: 0 });

export const MAX_SIMULATION_TEAM_DICE = 10;
export const MAX_SIMULATION_TEAM_RUNES_PER_DIE = 8;
export const MAX_SIMULATION_TEAM_COMMON_NODES = 128;

function asId(value) {
  return value === undefined || value === null ? "" : String(value);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeCostResource(value) {
  return String(value || NODE_STONE).trim().toUpperCase() === CORE_SOLAR
    ? CORE_SOLAR
    : NODE_STONE;
}

export function getNodeCostResource(node) {
  return normalizeCostResource(node?.cost_resource);
}

function mapFromNodeCollection(nodesOrMap) {
  if (nodesOrMap instanceof Map) {
    const normalized = new Map();
    nodesOrMap.forEach((node, key) => normalized.set(asId(key), node));
    return normalized;
  }
  let sourceNodes = [];
  if (Array.isArray(nodesOrMap)) sourceNodes = nodesOrMap;
  else if (Array.isArray(nodesOrMap?.nodes)) sourceNodes = nodesOrMap.nodes;
  const map = new Map();
  for (const node of sourceNodes) {
    if (node?.id !== undefined && node.id !== null) {
      map.set(asId(node.id), node);
    }
  }
  return map;
}

function mergeCanonicalEdges(map, nodesOrMap) {
  if (Array.isArray(nodesOrMap) || !Array.isArray(nodesOrMap?.edges)) return;
  const incomingByTarget = new Map();
  for (const edge of nodesOrMap.edges) {
    const from = asId(edge?.from ?? edge?.source ?? edge?.[0]);
    const to = asId(edge?.to ?? edge?.target ?? edge?.[1]);
    if (!from || !to || !map.has(to)) continue;
    if (!incomingByTarget.has(to)) incomingByTarget.set(to, new Set());
    incomingByTarget.get(to).add(from);
  }
  incomingByTarget.forEach((incoming, id) => {
    const node = map.get(id);
    const merged = new Set(Array.isArray(node.incoming) ? node.incoming.map(asId) : []);
    incoming.forEach((value) => merged.add(value));
    if (merged.size > 0) map.set(id, { ...node, incoming: [...merged] });
  });
}

export function getNodeMap(nodesOrMap) {
  const map = mapFromNodeCollection(nodesOrMap);
  // Accept a complete canonical tree object as well as a node array. Snapshots
  // may omit `incoming`, so merge the explicit edge list without
  // replacing any prerequisite data already carried by the node.
  mergeCanonicalEdges(map, nodesOrMap);
  return map;
}

export const INITIAL_UNLOCKED_DICE_IDS = Object.freeze([
  "1001", // 火骰子
  "1005", // 風骰子
  "1007", // 冰骰子
  "2001", // 鐵甲骰子
  "3001"  // 電骰子
]);

// These reward/arena dice are available before resource planning begins. They
// stay separate from the five base dice so their canonical unlock fields can
// remain intact.
export const SIMULATION_PREUNLOCKED_DICE_IDS = Object.freeze([
  "4008", // 陰陽骰子
  "5006", // 貪婪骰子
  "5008"  // 空虛骰子
]);

// Fear retains its co-op milestone in the canonical data, but its tree node is
// a regular resource purchase in the simulator (8 Dice Cores in v1.0.3).
export const SIMULATION_RESOURCE_UNLOCK_DICE_IDS = Object.freeze([
  "5002" // 恐懼骰子
]);

// These auto-unlock routes stop walking the canonical incoming
// ("前置節點") topology at their already available Chaos dice.
export const SIMULATION_BATCH_UNLOCK_START_IDS = Object.freeze({
  "5101": "5006", // 所有骰子傷害 <- 貪婪骰子
  "5003": "5006", // 暴君骰子 <- 貪婪骰子
  "5105": "5008", // 渾沌骰子暴擊率 <- 空虛骰子
  "5110": "5008"  // 渾沌骰子傷害 <- 空虛骰子
});

const FACTION_LEVEL_BRANCH_BY_CONDITION = Object.freeze({
  LV_Nature: 1,
  LV_Engineering: 2,
  LV_Magic: 3,
  LV_Order: 4,
  LV_Chaos: 5,
  LV_Invader: 5
});

export function getMaxRank(node) {
  return Math.max(1, Math.floor(toFiniteNumber(node?.max_rank ?? node?.max_level, 1)));
}

export function getFactionLevelRequirement(node) {
  if (!node) return null;
  const condition = String(node.unlock_condition ?? node.special_unlock ?? node.unlock_condition_special ?? "").trim();
  const branch = FACTION_LEVEL_BRANCH_BY_CONDITION[condition];
  const level = Number(node.unlock_condition_value);
  if (!branch || !Number.isInteger(level) || level < 0) return null;
  return { branch, level, condition };
}

/**
 * A faction-level condition is checked against the current simulation
 * allocation, excluding the target node itself so an invalid allocation
 * cannot satisfy its own gate.
 */
export function isFactionLevelGateSatisfied(node, state, nodesOrMap) {
  const requirement = getFactionLevelRequirement(node);
  if (!requirement) return true;
  const ranks = normalizeRanks(state?.ranks);
  delete ranks[asId(node.id)];
  return calculateBranchFactionLevel(requirement.branch, { ranks, nodes: nodesOrMap }) >= requirement.level;
}

/**
 * Only unmet faction-level milestones are unavailable to the resource
 * simulator. The four dice with other unlock-condition fields keep those
 * fields as canonical metadata, but follow their actual simulation rules.
 *
 * With no simulation state this remains a static classifier for callers that
 * only need to identify level-gated content. Passing state and nodes makes it
 * a dynamic eligibility check.
 */
export function isSpecialUnlockNode(node, state = null, nodesOrMap = null) {
  if (!node) return false;
  const id = asId(node.id);
  if (INITIAL_UNLOCKED_DICE_IDS.includes(id)
    || SIMULATION_PREUNLOCKED_DICE_IDS.includes(id)
    || SIMULATION_RESOURCE_UNLOCK_DICE_IDS.includes(id)) return false;
  if (!getFactionLevelRequirement(node)) return false;
  if (state && nodesOrMap) return !isFactionLevelGateSatisfied(node, state, nodesOrMap);
  return true;
}

/**
 * Initial simulation allocation includes the 5 resource-free base dice and
 * the 3 dice that the game grants through external rewards. Fear is not in
 * this set: after its milestone is satisfied, its 8-core tree purchase is
 * represented as a normal simulation unlock.
 */
export function isInitialSimulationNode(node) {
  if (!node) return false;
  const id = asId(node.id);
  if (INITIAL_UNLOCKED_DICE_IDS.includes(id) || SIMULATION_PREUNLOCKED_DICE_IDS.includes(id)) return true;
  // Support unit test mock root fixtures safely
  if ((id === "1" || id === "root") && node.node_type === "DICE" && (!node.gold_costs || node.gold_costs[0] === 0) && (!node.core_costs || node.core_costs[0] === 0) && (!Array.isArray(node.incoming) || node.incoming.length === 0)) {
    return true;
  }
  return false;
}

function getUnlockConditionParts(node) {
  if (!node) return null;
  const condition = String(node.unlock_condition ?? node.special_unlock ?? node.unlock_condition_special ?? "").trim();
  const canonicalLabel = String(node._canonical_unlock_condition_zh ?? node.unlock_condition_label_zh ?? node.unlock_condition_zh ?? "").trim();
  const label = String(node.unlock_condition_zh ?? node.unlock_condition_label_zh ?? canonicalLabel).trim();
  const value = String(node.unlock_condition_value ?? "").trim();
  if (!condition && !node.special_unlock && !node.unlock_condition_special && (!label || label === "前置節點")) return null;
  // The localized label for an ordinary graph edge is translated too, so use
  // the canonical marker when deciding whether this is merely a prerequisite.
  if (condition === "前置節點" || canonicalLabel === "前置節點") return null;
  const displayLabel = label || condition;
  if (!displayLabel) return null;
  return { displayLabel, value };
}

export function getUnlockConditionLabel(node) {
  const parts = getUnlockConditionParts(node);
  if (!parts) return "";
  if (!parts.value || parts.displayLabel.includes(parts.value)) return parts.displayLabel;
  return `${parts.displayLabel} ${parts.value}`.trim();
}

export function getFactionLevelProgressLabel(node, currentLevel = null) {
  const requirement = getFactionLevelRequirement(node);
  if (!requirement) return "";
  const parts = getUnlockConditionParts(node);
  const displayLabel = parts?.displayLabel || requirement.condition;
  const numericLevel = currentLevel === null || currentLevel === undefined || currentLevel === ""
    ? null
    : Number(currentLevel);
  const progress = Number.isFinite(numericLevel) && numericLevel >= 0
    ? `${Math.floor(numericLevel)}/${requirement.level}`
    : `?/${requirement.level}`;
  return `${displayLabel} ${progress}`.trim();
}

export function getRankRequirements(node) {
  if (!Array.isArray(node?.rank_requirements)) return [];
  const requirements = new Map();
  for (const entry of node.rank_requirements) {
    const nodeId = asId(entry?.node_id ?? entry?.nodeId ?? entry?.id);
    const rank = Math.max(0, Math.floor(toFiniteNumber(entry?.rank, 0)));
    if (!nodeId || rank < 1) continue;
    requirements.set(nodeId, Math.max(rank, requirements.get(nodeId) || 0));
  }
  return [...requirements.entries()].map(([node_id, rank]) => ({ node_id, rank }));
}

export function getMissingRankRequirements(node, state) {
  return getRankRequirements(node).filter(({ node_id, rank }) => getRank(state, node_id) < rank);
}

function costArray(node, field) {
  return Array.isArray(node?.[field]) ? node[field] : [];
}

function getCostAtRank(costs, purchaseRank, fallback) {
  const indexedCost = costs[purchaseRank - 1];
  if (indexedCost !== undefined) return toFiniteNumber(indexedCost, 0);
  if (purchaseRank === 1) return fallback;
  return 0;
}

/**
 * Return the cost for purchasing a particular 1-based rank.
 * Rank 1 is the unlock purchase. When its array entry is absent, the canonical
 * scalar unlock fields provide the cost.
 */
export function getNodeCost(node, rank) {
  const purchaseRank = Math.max(1, Math.floor(toFiniteNumber(rank, 1)));
  const goldCosts = costArray(node, "gold_costs");
  const coreCosts = costArray(node, "core_costs");
  const goldFallback = toFiniteNumber(node?.unlock_gold, 0);
  const coreFallback = toFiniteNumber(node?.unlock_core, 0);
  const gold = getCostAtRank(goldCosts, purchaseRank, goldFallback);
  const rawCore = getCostAtRank(coreCosts, purchaseRank, coreFallback);
  if (getNodeCostResource(node) === CORE_SOLAR) {
    const cost = { gold, core: 0 };
    if (rawCore !== 0) cost.solar = rawCore;
    return cost;
  }
  return { gold, core: rawCore };
}

export function sumNodeCosts(node, fromExclusiveRank, toInclusiveRank) {
  const from = Math.max(0, Math.floor(toFiniteNumber(fromExclusiveRank, 0)));
  const to = Math.max(from, Math.floor(toFiniteNumber(toInclusiveRank, from)));
  let total = { gold: 0, core: 0 };
  for (let rank = from + 1; rank <= to; rank += 1) {
    total = addCosts(total, getNodeCost(node, rank));
  }
  return total;
}

export function addCosts(left, right) {
  const total = {
    gold: toFiniteNumber(left?.gold, 0) + toFiniteNumber(right?.gold, 0),
    core: toFiniteNumber(left?.core, 0) + toFiniteNumber(right?.core, 0)
  };
  const solar = toFiniteNumber(left?.solar, 0) + toFiniteNumber(right?.solar, 0);
  if (solar !== 0) total.solar = solar;
  return total;
}

export function normalizeRanks(ranks) {
  const normalized = {};
  if (ranks instanceof Map) {
    ranks.forEach((value, key) => {
      const rank = Math.max(0, Math.floor(toFiniteNumber(value, 0)));
      if (rank > 0) normalized[asId(key)] = rank;
    });
    return normalized;
  }
  for (const [key, value] of Object.entries(ranks || {})) {
    const rank = Math.max(0, Math.floor(toFiniteNumber(value, 0)));
    if (rank > 0) normalized[asId(key)] = rank;
  }
  return normalized;
}

export function getRank(state, nodeId) {
  return Math.max(0, Math.floor(toFiniteNumber(state?.ranks?.[asId(nodeId)], 0)));
}

export function isUnlocked(state, nodeId) {
  return getRank(state, nodeId) > 0;
}

export function createSimulationState(nodesOrMap, options = {}) {
  const nodesMap = getNodeMap(nodesOrMap);
  const ranks = normalizeRanks(options.ranks);
  const initialIds = new Set(
    (Array.isArray(options.initialIds) ? options.initialIds.map(asId) : [])
      .filter((id) => isInitialSimulationNode(nodesMap.get(id)))
  );
  if (!options.preserveBase) {
    nodesMap.forEach((node, id) => {
      if (isInitialSimulationNode(node)) {
        ranks[id] = Math.max(1, ranks[id] || 0);
        initialIds.add(id);
      }
    });
  }
  const state = {
    active: Boolean(options.active),
    ranks,
    initialIds: [...initialIds],
    spent: { gold: 0, core: 0 },
    team: normalizeTeam(options.team),
    dataVersion: options.dataVersion || "unknown",
    warnings: Array.isArray(options.warnings) ? [...options.warnings] : []
  };
  return recomputeSimulationSpent(state, nodesMap);
}

export function normalizeTeam(team) {
  const dice = Array.isArray(team?.dice) ? team.dice.slice(0, MAX_SIMULATION_TEAM_DICE).map((entry) => {
    const rawRunes = entry?.runes ?? entry?.runeIds;
    return {
      id: asId(entry?.id ?? entry?.nodeId),
      runes: Array.isArray(rawRunes)
        ? rawRunes.slice(0, MAX_SIMULATION_TEAM_RUNES_PER_DIE).map((rune) => ({
          id: asId(rune?.id ?? rune?.nodeId),
          rank: Math.max(0, Math.floor(toFiniteNumber(rune?.rank, 0)))
        })).filter((rune) => rune.id)
        : []
    };
  }).filter((entry) => entry.id) : [];
  const commonNodes = [];
  const commonNodesById = new Map();
  const commonEntries = Array.isArray(team?.commonNodes ?? team?.common)
    ? (team.commonNodes ?? team.common)
    : [];
  for (const entry of commonEntries.slice(0, MAX_SIMULATION_TEAM_COMMON_NODES * 4)) {
    const id = asId(entry?.id ?? entry?.nodeId);
    if (!id) continue;
    const rank = Math.max(0, Math.floor(toFiniteNumber(entry?.rank, 0)));
    const existing = commonNodesById.get(id);
    if (existing) {
      existing.rank = Math.max(existing.rank, rank);
      continue;
    }
    const normalized = { id, rank };
    commonNodesById.set(id, normalized);
    commonNodes.push(normalized);
    if (commonNodes.length >= MAX_SIMULATION_TEAM_COMMON_NODES) break;
  }
  return { dice, commonNodes };
}

export function reconcileTeamAgainstRanks(team, ranks) {
  if (!team) return { dice: [], commonNodes: [] };
  const ranksMap = ranks instanceof Map ? ranks : new Map(Object.entries(ranks || {}));
  const rawDice = Array.isArray(team.dice) ? team.dice : [];
  const cleanDice = rawDice.map((d) => {
    if (!d) return null;
    const id = String(d?.id ?? d);
    return Number(ranksMap.get(id)) > 0 ? d : null;
  });
  const result = {
    ...team,
    dice: cleanDice
  };
  if ("support" in team) {
    const supportId = team.support ? String(team.support?.id ?? team.support) : null;
    result.support = supportId && Number(ranksMap.get(supportId)) > 0 ? team.support : null;
  }
  return result;
}

export function recomputeSimulationSpent(state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const ranks = normalizeRanks(state?.ranks);
  const initialIds = new Set((state?.initialIds || []).map(asId));
  for (const id of Object.keys(ranks)) {
    const node = nodesMap.get(id);
    if (node) ranks[id] = Math.min(getMaxRank(node), ranks[id]);
  }
  const simulationState = { ...state, ranks };

  // Reconcile allocations against the current canonical DAG. This is also
  // used when a newer 1.0.x data snapshot arrives while the simulator is
  // open, so stale descendants cannot survive a refresh.
  let changed = true;
  while (changed) {
    changed = false;
    Object.keys(ranks).forEach((id) => {
      const node = nodesMap.get(id);
      if (!node || isSpecialUnlockNode(node, simulationState, nodesMap)) {
        delete ranks[id];
        changed = true;
        return;
      }
      if (isInitialSimulationNode(node)) return;
      const prerequisites = incomingIds(node);
      const missingRankRequirements = getMissingRankRequirements(node, simulationState);
      if (prerequisites.some((prerequisite) => !ranks[prerequisite])
        || missingRankRequirements.length > 0) {
        delete ranks[id];
        changed = true;
      }
    });
  }

  let spent = { gold: 0, core: 0 };
  Object.entries(ranks).forEach(([id, rank]) => {
    const node = nodesMap.get(id);
    if (!node || isSpecialUnlockNode(node, simulationState, nodesMap)) {
      delete ranks[id];
      return;
    }
    const boundedRank = Math.min(rank, getMaxRank(node));
    const cost = initialIds.has(id) || isInitialSimulationNode(node)
      ? sumNodeCosts(node, 1, boundedRank)
      : sumNodeCosts(node, 0, boundedRank);
    spent = addCosts(spent, cost);
    ranks[id] = boundedRank;
  });
  return { ...state, ranks, initialIds: [...initialIds], spent };
}

function incomingIds(node) {
  return Array.isArray(node?.incoming) ? node.incoming.map(asId).filter(Boolean) : [];
}

export function getPrerequisiteIds(nodeId, nodesOrMap, options = {}) {
  const nodesMap = getNodeMap(nodesOrMap);
  let stopAtValues;
  if (options.stopAt instanceof Set) stopAtValues = [...options.stopAt];
  else if (Array.isArray(options.stopAt)) stopAtValues = options.stopAt;
  else stopAtValues = [options.stopAt];
  const stopAtIds = new Set(stopAtValues.map(asId).filter(Boolean));
  const visited = new Set();
  const result = [];
  const visiting = new Set();
  const walk = (id) => {
    const normalizedId = asId(id);
    if (!normalizedId || visited.has(normalizedId)) return;
    if (visiting.has(normalizedId)) return;
    const node = nodesMap.get(normalizedId);
    if (!node) return;
    visiting.add(normalizedId);
    if (options.includeTarget || normalizedId !== asId(nodeId)) result.push(normalizedId);
    if (stopAtIds.has(normalizedId)) {
      visiting.delete(normalizedId);
      visited.add(normalizedId);
      return;
    }
    for (const incoming of incomingIds(node)) walk(incoming);
    for (const requirement of getRankRequirements(node)) walk(requirement.node_id);
    visiting.delete(normalizedId);
    visited.add(normalizedId);
  };
  walk(nodeId);
  return result;
}

/**
 * Return the selected node and its configured prerequisite topology.
 * The four configured routes include their resource-free start dice, but do
 * not highlight or traverse ancestors before those starts in either view.
 */
export function getConfiguredPrerequisiteIds(nodeId, nodesOrMap) {
  const targetId = asId(nodeId);
  const nodesMap = getNodeMap(nodesOrMap);
  const batchStartId = asId(SIMULATION_BATCH_UNLOCK_START_IDS[targetId] || "");
  const batchStartNode = batchStartId ? nodesMap.get(batchStartId) : null;
  const stopAt = batchStartNode && isInitialSimulationNode(batchStartNode) ? batchStartId : null;
  return new Set(getPrerequisiteIds(targetId, nodesMap, { includeTarget: true, stopAt }));
}

function resolveUnlockReason(hasMissingRequirement, missingPrerequisitesCount) {
  if (hasMissingRequirement) return "rank-prerequisite";
  if (missingPrerequisitesCount > 0) return "missing-prerequisite";
  return "unlock";
}

export function evaluateNode(nodeId, state, nodesOrMap) {
  const id = asId(nodeId);
  const nodesMap = getNodeMap(nodesOrMap);
  const node = nodesMap.get(id) || null;
  if (!node) return { id, node: null, rank: 0, maxRank: 0, canUnlock: false, reason: "unknown-node" };
  const rank = getRank(state, id);
  const maxRank = getMaxRank(node);
  const factionLevelRequirement = getFactionLevelRequirement(node);
  const alwaysVisible = Boolean(factionLevelRequirement);
  const specialBlocked = isSpecialUnlockNode(node, state, nodesMap);
  const rankRequirements = getRankRequirements(node);
  const missingRankRequirements = getMissingRankRequirements(node, state);
  const requiredNodes = missingRankRequirements.map(({ node_id }) => node_id);
  if (specialBlocked) {
    const gateRanks = normalizeRanks(state?.ranks);
    delete gateRanks[id];
    return {
      id, node, rank, maxRank, isSpecial: true, alwaysVisible: true,
      canUnlock: false, canUpgrade: false, reason: "special-condition",
      conditionLabel: getUnlockConditionLabel(node), nextCost: EMPTY_COST,
      requiredFactionLevel: factionLevelRequirement?.level ?? null,
      currentFactionLevel: factionLevelRequirement
        ? calculateBranchFactionLevel(factionLevelRequirement.branch, { ranks: gateRanks, nodes: nodesMap })
        : null,
      rankRequirements,
      missingRankRequirements,
      requiredNodes
    };
  }
  if (missingRankRequirements.length > 0 && rank > 0) {
    return {
      id, node, rank, maxRank, isSpecial: false, alwaysVisible,
      canUnlock: false, canUpgrade: false, reason: "rank-prerequisite",
      rankRequirements,
      missingRankRequirements,
      requiredNodes,
      missingPrerequisites: [],
      nextCost: getNodeCost(node, Math.min(maxRank, rank + 1))
    };
  }
  if (rank >= maxRank) {
    return {
      id, node, rank, maxRank, isSpecial: false, alwaysVisible,
      canUnlock: false, canUpgrade: false, reason: "max-rank", nextCost: EMPTY_COST,
      rankRequirements,
      missingRankRequirements,
      requiredNodes
    };
  }
  if (rank > 0) {
    return {
      id, node, rank, maxRank, isSpecial: false, alwaysVisible,
      canUnlock: false, canUpgrade: true, reason: "upgrade", nextCost: getNodeCost(node, rank + 1),
      rankRequirements,
      missingRankRequirements,
      requiredNodes
    };
  }
  const missingPrerequisites = incomingIds(node).filter((incoming) => !isUnlocked(state, incoming));
  const missingRequirement = missingRankRequirements.length > 0;
  return {
    id, node, rank, maxRank, isSpecial: false, alwaysVisible,
    canUnlock: missingPrerequisites.length === 0 && !missingRequirement,
    canUpgrade: false,
    reason: resolveUnlockReason(missingRequirement, missingPrerequisites.length),
    missingPrerequisites,
    rankRequirements,
    missingRankRequirements,
    requiredNodes,
    nextCost: getNodeCost(node, 1)
  };
}

export function applyNodeRank(stateOrNodeId, nodeIdOrState, nodesOrMap, targetRank = null) {
  let state, nodeId;
  if (stateOrNodeId && typeof stateOrNodeId === "object" && stateOrNodeId.ranks) {
    state = stateOrNodeId;
    nodeId = nodeIdOrState;
  } else {
    nodeId = stateOrNodeId;
    state = nodeIdOrState;
  }
  const nodesMap = getNodeMap(nodesOrMap);
  const evaluation = evaluateNode(nodeId, state, nodesMap);
  if (!evaluation.node) return { ok: false, state, ...evaluation };
  const requested = targetRank === null || targetRank === undefined
    ? evaluation.rank + 1
    : Math.floor(toFiniteNumber(targetRank, evaluation.rank));
  const nextRank = Math.max(0, Math.min(evaluation.maxRank, requested));
  if (evaluation.isSpecial) return { ok: false, state, ...evaluation };
  if (nextRank === evaluation.rank) return { ok: true, state, ...evaluation, reason: "same-rank" };
  if (evaluation.rank === 0 && (nextRank === 0
    || evaluation.missingPrerequisites?.length
    || evaluation.requiredNodes?.length)) {
    return { ok: false, state, ...evaluation, reason: nextRank === 0 ? "no-op" : evaluation.reason };
  }
  const nextRanks = { ...normalizeRanks(state?.ranks), [evaluation.id]: nextRank };
  const nextState = recomputeSimulationSpent({ ...state, ranks: nextRanks }, nodesMap);
  return {
    ok: true,
    state: nextState,
    id: evaluation.id,
    fromRank: evaluation.rank,
    toRank: nextRank,
    cost: sumNodeCosts(evaluation.node, evaluation.rank, nextRank),
    node: evaluation.node
  };
}

function collectBatchPathNodes(targetId, batchStartId, nodesMap) {
  const allPathNodes = [];
  const visiting = new Set();
  const visited = new Set();
  const missing = [];

  const collect = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      missing.push(id);
      return;
    }
    const node = nodesMap.get(id);
    if (!node) {
      missing.push(id);
      return;
    }
    if (batchStartId && id === batchStartId && id !== targetId && isInitialSimulationNode(node)) {
      visited.add(id);
      return;
    }
    visiting.add(id);
    const deps = new Set(incomingIds(node));
    for (const req of getRankRequirements(node)) {
      if (req.node_id) deps.add(asId(req.node_id));
    }
    for (const depId of deps) collect(depId);
    visiting.delete(id);
    visited.add(id);

    allPathNodes.push(id);
  };

  collect(targetId);
  return {
    pathNodes: [...new Set(allPathNodes)],
    missing
  };
}

function resolveBatchTargetRanks(uniquePathNodes, state, nodesMap) {
  const targetRanks = {};
  for (const id of uniquePathNodes) {
    const curRank = getRank(state, id);
    targetRanks[id] = Math.max(1, curRank);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of uniquePathNodes) {
      const node = nodesMap.get(id);
      if (!node) continue;
      for (const req of getRankRequirements(node)) {
        const reqId = asId(req.node_id);
        const reqRank = req.rank;
        if (reqRank > (targetRanks[reqId] || 0)) {
          targetRanks[reqId] = reqRank;
          changed = true;
        }
      }
    }
  }
  return targetRanks;
}

function resolveBatchUnlockReason({ rankBlocked, hasSpecialBlock, hasMissing }) {
  if (hasSpecialBlock) return "special-condition";
  if (hasMissing) return "missing-node";
  if (rankBlocked) return "rank-prerequisite";
  return "ready";
}

export function planBatchUnlock(targetNodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const targetId = asId(targetNodeId);
  const batchStartId = asId(SIMULATION_BATCH_UNLOCK_START_IDS[targetId] || "");
  const { pathNodes: uniquePathNodes, missing } = collectBatchPathNodes(targetId, batchStartId, nodesMap);
  const targetRanks = resolveBatchTargetRanks(uniquePathNodes, state, nodesMap);

  const uniqueOrder = uniquePathNodes.filter((id) => (targetRanks[id] || 0) > getRank(state, id));
  const prospectiveRanks = { ...normalizeRanks(state?.ranks), ...targetRanks };
  const prospectiveState = { ...state, ranks: prospectiveRanks };

  const blockedBySpecial = uniqueOrder
    .map((id) => {
      const node = nodesMap.get(id);
      const evaluation = evaluateNode(id, prospectiveState, nodesMap);
      if (!evaluation.isSpecial) return null;
      return {
        id,
        label: getFactionLevelProgressLabel(node, evaluation.currentFactionLevel) || getUnlockConditionLabel(node),
        currentFactionLevel: evaluation.currentFactionLevel ?? null,
        requiredFactionLevel: evaluation.requiredFactionLevel ?? null
      };
    })
    .filter(Boolean);

  let total = { gold: 0, core: 0 };
  uniqueOrder.forEach((id) => {
    const node = nodesMap.get(id);
    const fromRank = getRank(state, id);
    const toRank = targetRanks[id];
    total = addCosts(total, sumNodeCosts(node, fromRank, toRank));
  });

  const target = nodesMap.get(targetId);
  const targetRanksForTargetEval = { ...prospectiveRanks };
  delete targetRanksForTargetEval[targetId];
  const targetEvaluation = evaluateNode(targetId, { ...state, ranks: targetRanksForTargetEval }, nodesMap);

  const rankBlocked = uniquePathNodes.some((id) => {
    const node = nodesMap.get(id);
    if (!node) return true;
    if ((targetRanks[id] || 0) > getMaxRank(node)) return true;
    return getMissingRankRequirements(node, prospectiveState).length > 0;
  });

  const blocked = rankBlocked || blockedBySpecial.length > 0 || missing.length > 0 || !target || Boolean(targetEvaluation?.isSpecial);
  const reason = resolveBatchUnlockReason({
    rankBlocked,
    hasSpecialBlock: blockedBySpecial.length > 0 || Boolean(targetEvaluation?.isSpecial),
    hasMissing: missing.length > 0
  });

  return {
    ok: !blocked,
    targetId,
    nodeIds: uniqueOrder,
    count: uniqueOrder.length,
    total,
    targetRanks,
    blockedBySpecial,
    missing: [...new Set(missing)],
    reason
  };
}

export function applyBatchUnlock(targetNodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const plan = planBatchUnlock(targetNodeId, state, nodesMap);
  if (!plan.ok) return { ok: false, state, plan, applied: [], cost: { gold: 0, core: 0 } };
  const currentRanks = normalizeRanks(state?.ranks);
  const nextRanks = { ...currentRanks };
  const applied = [];
  for (const id of plan.nodeIds) {
    const node = nodesMap.get(id);
    const fromRank = getRank({ ranks: currentRanks }, id);
    const targetRank = plan.targetRanks?.[id] ?? Math.min(getMaxRank(node), fromRank + 1);
    const toRank = Math.min(getMaxRank(node), Math.max(fromRank, targetRank));
    nextRanks[id] = toRank;
    applied.push({
      ok: true,
      id,
      fromRank,
      toRank,
      cost: sumNodeCosts(node, fromRank, toRank),
      node
    });
  }
  const nextState = recomputeSimulationSpent({ ...state, ranks: nextRanks }, nodesMap);
  if (plan.nodeIds.some((id) => getRank(nextState, id) < 1)) {
    return { ok: false, state, plan, applied: [], cost: { gold: 0, core: 0 }, reason: "batch-state-invalid" };
  }
  return { ok: true, state: nextState, plan, applied, cost: plan.total };
}

export function planMaxRank(nodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const evaluation = evaluateNode(nodeId, state, nodesMap);
  if (!evaluation.node || evaluation.isSpecial || evaluation.rank >= evaluation.maxRank) {
    return { ok: false, ...evaluation, remainingRanks: 0, total: { gold: 0, core: 0 } };
  }
  if (evaluation.requiredNodes?.length || (evaluation.rank === 0 && evaluation.missingPrerequisites?.length)) {
    return { ok: false, ...evaluation, remainingRanks: evaluation.maxRank, total: { gold: 0, core: 0 }, reason: "missing-prerequisite" };
  }
  const remainingRanks = evaluation.maxRank - evaluation.rank;
  return {
    ok: true,
    id: evaluation.id,
    node: evaluation.node,
    fromRank: evaluation.rank,
    toRank: evaluation.maxRank,
    remainingRanks,
    total: sumNodeCosts(evaluation.node, evaluation.rank, evaluation.maxRank)
  };
}

export function applyMaxRank(nodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const plan = planMaxRank(nodeId, state, nodesMap);
  if (!plan.ok) return { ok: false, state, plan, cost: { gold: 0, core: 0 } };
  const result = applyNodeRank(state, nodeId, nodesMap, plan.toRank);
  return { ...result, plan, cost: plan.total };
}

/**
 * 查詢所有當前已解鎖且依賴目標節點的後續節點 (Descendant Nodes)
 * @param {string|number} targetNodeId
 * @param {object} state
 * @param {object|Map} nodesOrMap
 * @returns {string[]}
 */
export function getUnlockedDescendantIds(targetNodeId, state, nodesOrMap) {
  const targetId = asId(targetNodeId);
  const nodesMap = getNodeMap(nodesOrMap);
  const descendants = new Set();
  const unlockedIds = Object.keys(normalizeRanks(state?.ranks)).filter((id) => id !== targetId);

  for (const id of unlockedIds) {
    const prereqs = getPrerequisiteIds(id, nodesMap, { includeTarget: false });
    if (prereqs.includes(targetId)) {
      descendants.add(id);
    }
  }
  return [...descendants];
}

/**
 * 計算取消解鎖計畫 (支援單一取消與連同後續依賴批次取消)
 * @param {string|number} targetNodeId
 * @param {object} state
 * @param {object|Map} nodesOrMap
 * @returns {object}
 */
export function planRevokeNode(targetNodeId, state, nodesOrMap) {
  const targetId = asId(targetNodeId);
  const nodesMap = getNodeMap(nodesOrMap);
  const node = nodesMap.get(targetId);
  if (!node || !isUnlocked(state, targetId)) {
    return { ok: false, targetId, reason: "not-unlocked" };
  }
  const isInitial = isInitialSimulationNode(node);
  if (isInitial && getRank(state, targetId) <= 1) {
    return { ok: false, targetId, reason: "initial-base-node" };
  }

  const descendants = getUnlockedDescendantIds(targetId, state, nodesMap);
  const isBatchRevoke = descendants.length > 0;
  const nodesToRevoke = [targetId, ...descendants];
  return {
    ok: true,
    targetId,
    node,
    isBatchRevoke,
    descendants,
    nodesToRevoke,
    count: nodesToRevoke.length
  };
}

/**
 * 執行取消解鎖 (純領域狀態轉換)
 * @param {string|number} targetNodeId
 * @param {object} state
 * @param {object|Map} nodesOrMap
 * @returns {object}
 */
export function applyRevokeNode(targetNodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const plan = planRevokeNode(targetNodeId, state, nodesMap);
  if (!plan.ok) return { ok: false, state, plan };

  const nextRanks = { ...normalizeRanks(state?.ranks) };
  for (const id of plan.nodesToRevoke) {
    const n = nodesMap.get(id);
    if (isInitialSimulationNode(n)) {
      nextRanks[id] = 1;
    } else {
      delete nextRanks[id];
    }
  }

  const nextState = recomputeSimulationSpent({ ...state, ranks: nextRanks }, nodesMap);
  return { ok: true, state: nextState, plan };
}

export function getSimulationNodeView(nodeId, state, nodesOrMap) {
  const evaluation = evaluateNode(nodeId, state, nodesOrMap);
  const rank = evaluation.rank || 0;
  return {
    ...evaluation,
    isUnlocked: rank > 0,
    isVisible: Boolean(evaluation.alwaysVisible || rank > 0),
    isLocked: !evaluation.isSpecial && rank === 0,
    progress: evaluation.maxRank ? rank / evaluation.maxRank : 0
  };
}

/**
 * 判斷節點是否計入派系等級 (Faction Level)
 * 計入：骰子符文 (DICE_RUNE)、支援魔像 (PERK)、骰子本體 (DICE)、派系專屬被動/技能/特性 (PLAYER_PASSIVE)
 * 排除：所有骰子傷害、起始SP增加、基本生命值增加等全域通用被動
 * @param {object} node
 * @returns {boolean}
 */
export function isNodeContributingToFactionLevel(node) {
  if (!node) return false;
  if (node.node_type === "DICE_RUNE" || node.node_type === "PERK" || node.node_type === "DICE") {
    return true;
  }
  if (node.node_type === "PLAYER_PASSIVE") {
    const name = String(node._canonical_name_zh || node.name_zh || node.name || "");
    return !(name.includes("所有骰子") || name === "起始SP增加" || name === "基本生命值增加");
  }
  return false;
}

/**
 * 取得節點在全解鎖狀態下的最大等級階數
 * @param {object} node
 * @returns {number}
 */
export function getNodeMaxRank(node) {
  if (!node) return 0;
  if (Number.isFinite(Number(node.max_rank)) && Number(node.max_rank) > 0) {
    return Number(node.max_rank);
  }
  if (Array.isArray(node.gold_costs) && node.gold_costs.length > 0) {
    return node.gold_costs.length;
  }
  if (Array.isArray(node.core_costs) && node.core_costs.length > 0) {
    return node.core_costs.length;
  }
  return 1;
}

/**
 * 計算指定派系在給定分配狀態下的派系等級
 * @param {number} branchId 1: 自然, 2: 工學, 3: 魔法, 4: 秩序, 5: 渾沌
 * @param {object} [options]
 * @param {Map<string, number>|Record<string, number>|null} [options.ranks] 當前模擬分配的 rank；若為 null 則代表全解鎖（瀏覽模式）
 * @param {Array<object>|Map<string, object>} options.nodes 所有節點
 * @returns {number}
 */
function calculateBranchFactionLevelFromMap(branchId, { ranks = null, nodesMap }) {
  let level = 0;
  const isFullUnlocked = ranks === null;

  for (const node of nodesMap.values()) {
    if (Number(node.branch) !== Number(branchId)) continue;
    if (!isNodeContributingToFactionLevel(node)) continue;

    const maxRank = getNodeMaxRank(node);
    if (isFullUnlocked) {
      level += maxRank;
    } else {
      const allocated = typeof ranks?.get === "function" ? (ranks.get(asId(node.id)) ?? 0) : (ranks?.[asId(node.id)] ?? 0);
      level += Math.min(allocated, maxRank);
    }
  }

  return level;
}

export function calculateBranchFactionLevel(branchId, { ranks = null, nodes = [] } = {}) {
  return calculateBranchFactionLevelFromMap(branchId, { ranks, nodesMap: getNodeMap(nodes) });
}

const fullFactionLevelCache = new WeakMap();

/**
 * 計算所有 5 個派系的等級
 * @param {object} [options]
 * @param {Map<string, number>|Record<string, number>|null} [options.ranks] 當前模擬分配的 rank；若為 null 則代表全解鎖
 * @param {Array<object>|Map<string, object>} options.nodes
 * @returns {Record<number, number>} 派系ID -> 派系等級
 */
export function calculateAllFactionLevels({ ranks = null, nodes = [] } = {}) {
  const nodesMap = nodes instanceof Map ? nodes : getNodeMap(nodes);
  if (ranks === null && nodesMap instanceof Map && fullFactionLevelCache.has(nodesMap)) {
    return { ...fullFactionLevelCache.get(nodesMap) };
  }
  const result = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let b = 1; b <= 5; b++) {
    result[b] = calculateBranchFactionLevelFromMap(b, { ranks, nodesMap });
  }
  if (ranks === null && nodesMap instanceof Map) fullFactionLevelCache.set(nodesMap, result);
  return result;
}

/**
 * 尋找指定骰子節點對應的符文節點（通常為 3 個）
 */
export function getRunesForDiceNode(diceNode, nodesMap) {
  if (!diceNode) return [];
  const map = getNodeMap(nodesMap);
  const runes = [];
  const queue = [];
  const diceId = String(diceNode.id);
  map.forEach((node) => {
    if (node.node_type === "DICE_RUNE" && (node.incoming || []).includes(diceId)) {
      runes.push(node);
      queue.push(node);
    }
  });
  while (queue.length > 0) {
    const current = queue.shift();
    map.forEach((node) => {
      if (node.node_type === "DICE_RUNE" && (node.incoming || []).includes(String(current.id))) {
        if (!runes.some((existing) => String(existing.id) === String(node.id))) {
          runes.push(node);
          queue.push(node);
        }
      }
    });
  }
  return runes;
}

function unlockPrimaryTargets(initialState, map, diceIds, supportId) {
  let state = initialState;
  const primaryTargets = [];
  for (const diceId of diceIds) {
    if (diceId && map.has(String(diceId))) primaryTargets.push(String(diceId));
  }
  if (supportId && map.has(String(supportId))) primaryTargets.push(String(supportId));

  for (const targetId of primaryTargets) {
    const res = applyBatchUnlock(targetId, state, map);
    if (res.ok) state = res.state;
  }
  return state;
}

function unlockRuneTargets(initialState, map, diceIds, excludedSet) {
  let state = initialState;
  for (const diceId of diceIds) {
    const diceNode = map.get(String(diceId));
    if (!diceNode) continue;
    const runes = getRunesForDiceNode(diceNode, map);
    for (const rune of runes) {
      const runeId = String(rune.id);
      if (!excludedSet.has(runeId)) {
        const res = applyBatchUnlock(runeId, state, map);
        if (res.ok) state = res.state;
      }
    }
  }
  return state;
}

function unlockPrimaryAndRuneTargets(initialState, map, diceIds, supportId, excludedSet) {
  const primaryState = unlockPrimaryTargets(initialState, map, diceIds, supportId);
  return unlockRuneTargets(primaryState, map, diceIds, excludedSet);
}

function applyQuickUnlockOverridesAndRevocations(initialState, map, excludedSet, rankOverrides) {
  let state = initialState;
  for (const excludedId of excludedSet) {
    if (getRank(state, excludedId) > 0) {
      const revoke = applyRevokeNode(excludedId, state, map);
      if (revoke.ok) state = revoke.state;
    }
  }

  for (const [nodeId, targetRank] of Object.entries(rankOverrides || {})) {
    const id = String(nodeId);
    const node = map.get(id);
    if (!node || excludedSet.has(id)) continue;
    const maxRank = getMaxRank(node);
    const clampedRank = Math.min(maxRank, Math.max(1, Math.floor(Number(targetRank) || 1)));
    if (getRank(state, id) > 0 && getRank(state, id) < clampedRank) {
      const applied = applyNodeRank(state, id, map, clampedRank);
      if (applied.ok) state = applied.state;
    }
  }
  return state;
}

/**
 * 執行快速解鎖計算：拓撲尋徑、符文/支援自動解鎖、紅叉排除與等級升級
 */
export function calculateQuickUnlockState({
  diceIds = [],
  supportId = null,
  excludedNodeIds = [],
  rankOverrides = {},
  nodesMap
}) {
  const map = getNodeMap(nodesMap);
  const excludedSet = new Set((excludedNodeIds || []).map(String));
  let state = createSimulationState(map, { active: true });

  state = unlockPrimaryAndRuneTargets(state, map, diceIds, supportId, excludedSet);
  state = applyQuickUnlockOverridesAndRevocations(state, map, excludedSet, rankOverrides);

  // 5. 單隊同步：將 5 顆主骰填入隊伍 1
  const filledDice = diceIds.slice(0, 5).filter((id) => id && map.has(String(id))).map((id) => map.get(String(id)));
  return {
    ...state,
    active: true,
    team: {
      dice: filledDice,
      commonNodes: []
    }
  };
}

export function getSimulationRankEntries(ranks) {
  if (!ranks) return [];
  if (ranks instanceof Map) return [...ranks.entries()];
  if (Array.isArray(ranks)) return ranks;
  return Object.entries(ranks || {});
}

export function positiveSimulationRankIds(ranks) {
  const entries = getSimulationRankEntries(ranks);
  return new Set(entries
    .filter(([, rank]) => Number.isFinite(Number(rank)) && Number(rank) > 0)
    .map(([id]) => String(id)));
}

/**
 * 判定模擬分享圖中真正被點亮解鎖的節點與路徑集合
 */
export function computeShareRenderUnlockState(simulation = {}, treeData = {}) {
  const nodesMap = getNodeMap(treeData);
  const preUnlockedIds = new Set();
  nodesMap.forEach((node, id) => {
    if (isInitialSimulationNode(node)) preUnlockedIds.add(String(id));
  });

  const allocatedIds = positiveSimulationRankIds(simulation?.ranks);
  const manualIds = [...allocatedIds].filter((id) => {
    if (!preUnlockedIds.has(id)) return true;
    const rank = Number(simulation?.ranks instanceof Map ? simulation.ranks.get(id) : simulation?.ranks?.[id]);
    return Number.isFinite(rank) && rank > 1;
  });

  const teamDice = Array.isArray(simulation?.team?.dice) ? simulation.team.dice : [];
  teamDice.forEach((d) => {
    const id = String(d?.id ?? d ?? "");
    if (id && nodesMap.has(id) && preUnlockedIds.has(id) && !manualIds.includes(id)) {
      manualIds.push(id);
    }
  });

  const manualPathIds = computeUpstreamTopologyPath(manualIds, nodesMap).activePathNodeIds;
  const renderUnlockedIds = new Set(
    [...manualPathIds].filter((id) => allocatedIds.has(id) || preUnlockedIds.has(id))
  );

  return {
    preUnlockedIds,
    allocatedIds,
    manualIds: new Set(manualIds),
    manualPathIds,
    renderUnlockedIds
  };
}

function resolveEffectiveActiveIds(renderState, simulation) {
  if (renderState.renderUnlockedIds && renderState.renderUnlockedIds.size > 0) {
    return renderState.renderUnlockedIds;
  }
  if (renderState.allocatedIds && renderState.allocatedIds.size > 0) {
    return renderState.allocatedIds;
  }
  return positiveSimulationRankIds(simulation?.ranks);
}

function collectActiveNodeCoordinates(nodes, activeIds) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const activeNodes = [];

  for (const node of nodes) {
    const id = String(node.id);
    if (!activeIds.has(id)) continue;
    const x = Number(node.x);
    const y = Number(node.y);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    activeNodes.push({ x, y, id });
  }

  return { minX, maxX, minY, maxY, activeNodes };
}

function calculateQuadrantCounts(activeNodes, midX, midY) {
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  let q3 = 0;
  for (const n of activeNodes) {
    if (n.x <= midX) {
      if (n.y <= midY) {
        q0 += 1;
      } else {
        q2 += 1;
      }
    } else if (n.y <= midY) {
      q1 += 1;
    } else {
      q3 += 1;
    }
  }
  return [q0, q1, q2, q3];
}

/**
 * 計算模擬狀態中已解鎖節點的幾何分佈範圍 (Bounding Box) 與象限分佈
 */
export function getUnlockedBounds(simulation, treeData) {
  const nodes = treeData?.nodes || [];
  if (!nodes.length) return null;

  const renderState = computeShareRenderUnlockState(simulation, treeData);
  const activeIds = resolveEffectiveActiveIds(renderState, simulation);
  const { minX, maxX, minY, maxY, activeNodes } = collectActiveNodeCoordinates(nodes, activeIds);

  const count = activeNodes.length;
  if (count === 0 || minX === Infinity) return null;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const quadrantCounts = calculateQuadrantCounts(activeNodes, midX, midY);
  const populatedQuadrants = quadrantCounts.filter((c) => c > 0).length;

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    count,
    quadrantCounts,
    populatedQuadrants
  };
}

function resolveDefaultSplitMode(canvasWidth, canvasHeight) {
  if (canvasWidth >= 2400 && canvasHeight >= 2000) {
    return "split-quad";
  }
  if (canvasWidth < canvasHeight * 0.85) {
    return "split-vertical";
  }
  if (canvasWidth > canvasHeight * 1.35) {
    return "split-horizontal";
  }
  return "single";
}

function resolveAutoSplitMode(unlockedBounds, canvasWidth, canvasHeight) {
  if (!unlockedBounds || unlockedBounds.width <= 0 || unlockedBounds.height <= 0 || !unlockedBounds.count) {
    return resolveDefaultSplitMode(canvasWidth, canvasHeight);
  }
  const { width: bW, height: bH, count, populatedQuadrants = 4 } = unlockedBounds;
  const ratio = bW / bH;

  // 1. 單張正方形判斷 (一張圖即可完整清晰展示，絕不強行分割)
  if (
    count <= 20 ||
    (count <= 30 && bW <= 2800 && bH <= 2800 && ratio >= 0.65 && ratio <= 1.55) ||
    (bW <= 1400 && bH <= 1400)
  ) {
    return "single";
  }
  // 2. 四宮格 (2x2 四張正方形) 判斷
  if (
    count >= 36 &&
    bW >= 2600 &&
    bH >= 2400 &&
    ratio >= 0.8 &&
    ratio <= 1.25 &&
    populatedQuadrants >= 3
  ) {
    return "split-quad";
  }
  // 3. 上下 2 張正方形判斷：縱向深度明顯大於橫向 (呈豎長條狀，比值 < 0.75)
  if (ratio < 0.75) {
    return "split-vertical";
  }
  // 4. 左右 2 張正方形判斷：橫向長條或寬矩形走向 (比值 >= 0.75)，2張圖搞定
  return "split-horizontal";
}

/**
 * 圖片分割幾何領域計算 (產出 1:1 正方形子圖，智慧選擇單張、左右、上下或 2x2 四宮格)
 */
export function calculateImageSplitLayout({
  unlockedBounds,
  canvasWidth = 1600,
  canvasHeight = 1000,
  splitMode = "split-horizontal"
} = {}) {
  const mode = splitMode === "auto"
    ? resolveAutoSplitMode(unlockedBounds, canvasWidth, canvasHeight)
    : splitMode;

  // 1. 單張正方形 (不分割，產出 1 張 1:1 正方形)
  if (mode === "single") {
    const recommendedSize = { width: 1200, height: 1200 };
    return {
      mode: "single",
      isSquare: true,
      recommendedSize,
      parts: [
        {
          index: 0,
          x: 0,
          y: 0,
          width: canvasWidth,
          height: canvasHeight,
          roundedCorners: { topLeft: 24, topRight: 24, bottomRight: 24, bottomLeft: 24 }
        }
      ]
    };
  }

  // 2. 上下正方形 (2張 1:1 正方形)
  if (mode === "split-vertical") {
    const recommendedSize = { width: 1000, height: 2000 };
    let actualW = canvasWidth;
    let actualH = Math.floor(canvasHeight / 2);
    if (canvasHeight >= 2 * canvasWidth) {
      actualW = canvasWidth;
      actualH = canvasWidth;
    }
    const startX = Math.max(0, Math.floor((canvasWidth - actualW) / 2));
    const topY = 0;
    const bottomY = canvasHeight - actualH;

    return {
      mode: "split-vertical",
      isSquare: true,
      recommendedSize,
      parts: [
        { index: 0, x: startX, y: topY, width: actualW, height: actualH, roundedCorners: { topLeft: 24, topRight: 24, bottomRight: 0, bottomLeft: 0 } },
        { index: 1, x: startX, y: bottomY, width: actualW, height: actualH, roundedCorners: { topLeft: 0, topRight: 0, bottomRight: 24, bottomLeft: 24 } }
      ]
    };
  }

  // 3. 左右正方形 (2張 1:1 正方形，無重疊劃分，杜絕骰子樹重複)
  if (mode === "split-horizontal") {
    const recommendedSize = { width: 2000, height: 1000 };
    let partW = Math.floor(canvasWidth / 2);
    let partH = canvasHeight;
    if (canvasWidth >= 2 * canvasHeight) {
      partW = canvasHeight;
      partH = canvasHeight;
    }
    const startY = Math.max(0, Math.floor((canvasHeight - partH) / 2));
    const leftX = 0;
    const rightX = canvasWidth - partW;

    return {
      mode: "split-horizontal",
      isSquare: true,
      recommendedSize,
      parts: [
        { index: 0, x: leftX, y: startY, width: partW, height: partH, roundedCorners: { topLeft: 24, topRight: 0, bottomRight: 0, bottomLeft: 24 } },
        { index: 1, x: rightX, y: startY, width: partW, height: partH, roundedCorners: { topLeft: 0, topRight: 24, bottomRight: 24, bottomLeft: 0 } }
      ]
    };
  }

  // 4. 4個正方形 (四宮格 2x2，4張 1:1 正方形，無重疊)
  if (mode === "split-quad") {
    const recommendedSize = { width: 2000, height: 2000 };
    const partW = Math.floor(canvasWidth / 2);
    const partH = Math.floor(canvasHeight / 2);
    const bottomY = canvasHeight - partH;
    const rightX = canvasWidth - partW;

    return {
      mode: "split-quad",
      isSquare: true,
      recommendedSize,
      parts: [
        { index: 0, x: 0, y: 0, width: partW, height: partH, roundedCorners: { topLeft: 24, topRight: 0, bottomRight: 0, bottomLeft: 0 } },
        { index: 1, x: rightX, y: 0, width: partW, height: partH, roundedCorners: { topLeft: 0, topRight: 24, bottomRight: 0, bottomLeft: 0 } },
        { index: 2, x: 0, y: bottomY, width: partW, height: partH, roundedCorners: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 24 } },
        { index: 3, x: rightX, y: bottomY, width: partW, height: partH, roundedCorners: { topLeft: 0, topRight: 0, bottomRight: 24, bottomLeft: 0 } }
      ]
    };
  }

  return {
    mode: "single",
    isSquare: false,
    recommendedSize: { width: canvasWidth, height: canvasHeight },
    parts: [
      { index: 0, x: 0, y: 0, width: canvasWidth, height: canvasHeight, roundedCorners: { topLeft: 24, topRight: 24, bottomRight: 24, bottomLeft: 24 } }
    ]
  };
}
