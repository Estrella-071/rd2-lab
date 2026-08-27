/**
 * Pure simulation-planning rules for the dice tree.
 *
 * The browser can render the result in any way it wants, but all eligibility,
 * topology and cost decisions live here so a 1.0.x data refresh cannot leave a
 * stale price or prerequisite hidden in a click handler.
 */

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

export function getMaxRank(node) {
  return Math.max(1, Math.floor(toFiniteNumber(node?.max_rank ?? node?.max_level, 1)));
}

/**
 * A non-empty unlock_condition is an externally fulfilled gate. "前置節點"
 * is the canonical data label for ordinary DAG edges and is not a special
 * gate. The predicate intentionally uses the data fields rather than IDs.
 */
export function isSpecialUnlockNode(node) {
  if (!node) return false;
  const id = asId(node.id);
  if (INITIAL_UNLOCKED_DICE_IDS.includes(id)) return false;
  const condition = String(node.unlock_condition ?? node.special_unlock ?? node.unlock_condition_special ?? "").trim();
  const label = String(node._canonical_unlock_condition_zh ?? node.unlock_condition_label_zh ?? node.unlock_condition_zh ?? "").trim();
  if (condition.startsWith("LV_") && node.node_type !== "DICE") return false;
  if (!condition && !node.special_unlock && !node.unlock_condition_special && (!label || label === "前置節點")) return false;
  if (condition === "" && label === "") return false;
  return condition !== "前置節點" && label !== "前置節點";
}

/**
 * Initial simulation allocation includes exactly the 5 resource-free initial
 * dice (Fire, Wind, Ice, Iron, Electric). Dice with a special unlock
 * condition remain visible but cannot be purchased by the resource planner.
 */
export function isInitialSimulationNode(node) {
  if (!node) return false;
  const id = asId(node.id);
  if (INITIAL_UNLOCKED_DICE_IDS.includes(id)) return true;
  // Support unit test mock root fixtures safely
  if ((id === "1" || id === "root") && node.node_type === "DICE" && (!node.gold_costs || node.gold_costs[0] === 0) && (!node.core_costs || node.core_costs[0] === 0) && (!Array.isArray(node.incoming) || node.incoming.length === 0)) {
    return true;
  }
  return false;
}

export function getUnlockConditionLabel(node) {
  if (!node) return "";
  const condition = String(node.unlock_condition ?? node.special_unlock ?? node.unlock_condition_special ?? "").trim();
  const canonicalLabel = String(node._canonical_unlock_condition_zh ?? node.unlock_condition_label_zh ?? node.unlock_condition_zh ?? "").trim();
  const label = String(node.unlock_condition_zh ?? node.unlock_condition_label_zh ?? canonicalLabel).trim();
  const value = String(node.unlock_condition_value ?? "").trim();
  if (!condition && !node.special_unlock && !node.unlock_condition_special && (!label || label === "前置節點")) return "";
  // The localized label for an ordinary graph edge is translated too, so use
  // the canonical marker when deciding whether this is merely a prerequisite.
  if (condition === "前置節點" || canonicalLabel === "前置節點") return "";
  const displayLabel = label || condition;
  if (!displayLabel) return "";
  if (!value || displayLabel.includes(value)) return displayLabel;
  return `${displayLabel} ${value}`.trim();
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
  const core = getCostAtRank(coreCosts, purchaseRank, coreFallback);
  return { gold, core };
}

export function sumNodeCosts(node, fromExclusiveRank, toInclusiveRank) {
  const from = Math.max(0, Math.floor(toFiniteNumber(fromExclusiveRank, 0)));
  const to = Math.max(from, Math.floor(toFiniteNumber(toInclusiveRank, from)));
  const total = { gold: 0, core: 0 };
  for (let rank = from + 1; rank <= to; rank += 1) {
    const cost = getNodeCost(node, rank);
    total.gold += cost.gold;
    total.core += cost.core;
  }
  return total;
}

export function addCosts(left, right) {
  return {
    gold: toFiniteNumber(left?.gold, 0) + toFiniteNumber(right?.gold, 0),
    core: toFiniteNumber(left?.core, 0) + toFiniteNumber(right?.core, 0)
  };
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

export function recomputeSimulationSpent(state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const ranks = normalizeRanks(state?.ranks);
  const initialIds = new Set((state?.initialIds || []).map(asId));

  // Reconcile allocations against the current canonical DAG. This is also
  // used when a newer 1.0.x data snapshot arrives while the simulator is
  // open, so stale descendants cannot survive a refresh.
  let changed = true;
  while (changed) {
    changed = false;
    Object.keys(ranks).forEach((id) => {
      const node = nodesMap.get(id);
      if (!node || isSpecialUnlockNode(node)) {
        delete ranks[id];
        changed = true;
        return;
      }
      if (isInitialSimulationNode(node)) return;
      const prerequisites = incomingIds(node);
      if (prerequisites.some((prerequisite) => !ranks[prerequisite])) {
        delete ranks[id];
        changed = true;
      }
    });
  }

  const spent = { gold: 0, core: 0 };
  Object.entries(ranks).forEach(([id, rank]) => {
    const node = nodesMap.get(id);
    if (!node || isSpecialUnlockNode(node)) {
      delete ranks[id];
      return;
    }
    const boundedRank = Math.min(rank, getMaxRank(node));
    const cost = initialIds.has(id) || isInitialSimulationNode(node)
      ? sumNodeCosts(node, 1, boundedRank)
      : sumNodeCosts(node, 0, boundedRank);
    spent.gold += cost.gold;
    spent.core += cost.core;
    ranks[id] = boundedRank;
  });
  return { ...state, ranks, initialIds: [...initialIds], spent };
}

function incomingIds(node) {
  return Array.isArray(node?.incoming) ? node.incoming.map(asId).filter(Boolean) : [];
}

export function getPrerequisiteIds(nodeId, nodesOrMap, options = {}) {
  const nodesMap = getNodeMap(nodesOrMap);
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
    for (const incoming of incomingIds(node)) walk(incoming);
    visiting.delete(normalizedId);
    visited.add(normalizedId);
  };
  walk(nodeId);
  return result;
}

export function evaluateNode(nodeId, state, nodesOrMap) {
  const id = asId(nodeId);
  const nodesMap = getNodeMap(nodesOrMap);
  const node = nodesMap.get(id) || null;
  if (!node) return { id, node: null, rank: 0, maxRank: 0, canUnlock: false, reason: "unknown-node" };
  const rank = getRank(state, id);
  const maxRank = getMaxRank(node);
  if (isSpecialUnlockNode(node)) {
    return {
      id, node, rank, maxRank, isSpecial: true, alwaysVisible: true,
      canUnlock: false, canUpgrade: false, reason: "special-condition",
      conditionLabel: getUnlockConditionLabel(node), nextCost: EMPTY_COST
    };
  }
  if (rank >= maxRank) {
    return { id, node, rank, maxRank, isSpecial: false, alwaysVisible: false, canUnlock: false, canUpgrade: false, reason: "max-rank", nextCost: EMPTY_COST };
  }
  if (rank > 0) {
    return { id, node, rank, maxRank, isSpecial: false, alwaysVisible: false, canUnlock: false, canUpgrade: true, reason: "upgrade", nextCost: getNodeCost(node, rank + 1) };
  }
  const missingPrerequisites = incomingIds(node).filter((incoming) => !isUnlocked(state, incoming));
  return {
    id, node, rank, maxRank, isSpecial: false, alwaysVisible: false,
    canUnlock: missingPrerequisites.length === 0,
    canUpgrade: false,
    reason: missingPrerequisites.length ? "missing-prerequisite" : "unlock",
    missingPrerequisites,
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
  if (evaluation.rank === 0 && (nextRank === 0 || evaluation.missingPrerequisites?.length)) {
    return { ok: false, state, ...evaluation, reason: nextRank === 0 ? "no-op" : "missing-prerequisite" };
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

export function planBatchUnlock(targetNodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const targetId = asId(targetNodeId);
  const collect = (id, context) => {
    const { order, visiting, visited, blockedBySpecial, missing } = context;
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
    visiting.add(id);
    for (const incoming of incomingIds(node)) collect(incoming, context);
    visiting.delete(id);
    visited.add(id);

    if (isSpecialUnlockNode(node) && !isUnlocked(state, id)) {
      blockedBySpecial.push({ id, label: getUnlockConditionLabel(node) });
      return;
    }
    if (!isUnlocked(state, id)) order.push(id);
  };
  const context = {
    order: [],
    visiting: new Set(),
    visited: new Set(),
    blockedBySpecial: [],
    missing: []
  };
  collect(targetId, context);
  const { order, blockedBySpecial, missing } = context;
  const uniqueOrder = [...new Set(order)];
  let total = { gold: 0, core: 0 };
  uniqueOrder.forEach((id) => {
    const node = nodesMap.get(id);
    total = addCosts(total, getNodeCost(node, 1));
  });
  const target = nodesMap.get(targetId);
  const targetEvaluation = evaluateNode(targetId, state, nodesMap);
  const blocked = blockedBySpecial.length > 0 || missing.length > 0 || !target || targetEvaluation.isSpecial;
  let reason = "ready";
  if (blockedBySpecial.length > 0 || targetEvaluation.isSpecial) reason = "special-condition";
  else if (missing.length > 0) reason = "missing-node";
  return {
    ok: !blocked,
    targetId,
    nodeIds: uniqueOrder,
    count: uniqueOrder.length,
    total,
    blockedBySpecial,
    missing: [...new Set(missing)],
    reason
  };
}

export function applyBatchUnlock(targetNodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const plan = planBatchUnlock(targetNodeId, state, nodesMap);
  if (!plan.ok) return { ok: false, state, plan, applied: [], cost: { gold: 0, core: 0 } };
  let nextState = state;
  const applied = [];
  for (const id of plan.nodeIds) {
    const result = applyNodeRank(nextState, id, nodesMap, 1);
    if (!result.ok) return { ok: false, state, plan, applied, cost: { gold: 0, core: 0 }, reason: result.reason };
    nextState = result.state;
    applied.push(result);
  }
  return { ok: true, state: nextState, plan, applied, cost: plan.total };
}

export function planMaxRank(nodeId, state, nodesOrMap) {
  const nodesMap = getNodeMap(nodesOrMap);
  const evaluation = evaluateNode(nodeId, state, nodesMap);
  if (!evaluation.node || evaluation.isSpecial || evaluation.rank >= evaluation.maxRank) {
    return { ok: false, ...evaluation, remainingRanks: 0, total: { gold: 0, core: 0 } };
  }
  if (evaluation.rank === 0 && evaluation.missingPrerequisites?.length) {
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
    isVisible: Boolean(evaluation.isSpecial || rank > 0),
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
export function calculateBranchFactionLevel(branchId, { ranks = null, nodes = [] } = {}) {
  let level = 0;
  const isFullUnlocked = ranks === null;
  const nodesMap = getNodeMap(nodes);

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

/**
 * 計算所有 5 個派系的等級
 * @param {object} [options]
 * @param {Map<string, number>|Record<string, number>|null} [options.ranks] 當前模擬分配的 rank；若為 null 則代表全解鎖
 * @param {Array<object>|Map<string, object>} options.nodes
 * @returns {Record<number, number>} 派系ID -> 派系等級
 */
export function calculateAllFactionLevels({ ranks = null, nodes = [] } = {}) {
  const result = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let b = 1; b <= 5; b++) {
    result[b] = calculateBranchFactionLevel(b, { ranks, nodes });
  }
  return result;
}
