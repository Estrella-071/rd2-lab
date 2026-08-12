/**
 * @fileoverview 天賦樹有向無環圖 (DAG) 拓撲遍歷與前置依賴純領域模組
 * @module domain/dag_topology
 */

/**
 * 逆向 BFS 前置路徑遍歷
 * 沿 incoming 邊向上追溯所有直接與間接前置節點，並收集涵蓋的派系分支。
 *
 * @param {string|string[]|Set<string>} targetNodeIds - 起始節點 ID
 * @param {Map<string, Object>|Record<string, Object>} nodeById - 節點查找字典
 * @returns {{ activePathNodeIds: Set<string>, activeBranches: Set<number> }}
 */
function targetIdList(targetNodeIds) {
  if (targetNodeIds instanceof Set) return Array.from(targetNodeIds);
  if (Array.isArray(targetNodeIds)) return targetNodeIds;
  return targetNodeIds ? [targetNodeIds] : [];
}

function nodeLookup(nodeById) {
  return (id) => (nodeById instanceof Map ? nodeById.get(id) : nodeById?.[id]);
}

function collectUpstreamIds(targetNodeIds, getNode) {
  const activePathNodeIds = new Set();
  const queue = [];
  for (const id of targetIdList(targetNodeIds)) {
    if (id && getNode(id)) {
      activePathNodeIds.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentNode = getNode(currentId);
    for (const incomingId of currentNode?.incoming || []) {
      if (incomingId && !activePathNodeIds.has(incomingId) && getNode(incomingId)) {
        activePathNodeIds.add(incomingId);
        queue.push(incomingId);
      }
    }
  }
  return activePathNodeIds;
}

export function computeUpstreamTopologyPath(targetNodeIds, nodeById) {
  const getNode = nodeLookup(nodeById);
  const activePathNodeIds = collectUpstreamIds(targetNodeIds, getNode);
  const activeBranches = new Set();
  activePathNodeIds.forEach((id) => {
    const n = getNode(id);
    if (n?.branch !== undefined && n.branch !== null) {
      activeBranches.add(Number(n.branch));
    }
  });

  return { activePathNodeIds, activeBranches };
}

/**
 * 前置圖預計算 (加載期優化)
 * 為圖中所有節點預先計算完整前置集合與派系集合，提供 O(1) 瞬時查詢。
 *
 * @param {Object[]} nodes - 全圖節點陣列
 * @param {Map<string, Object>|Record<string, Object>} [nodeByIdMap]
 * @returns {Map<string, { nodeIds: Set<string>, branches: Set<number> }>}
 */
export function precomputePrerequisiteGraph(nodes, nodeByIdMap) {
  let nodeMap = new Map((nodes || []).map((n) => [n.id, n]));
  if (nodeByIdMap) nodeMap = new Map(Object.entries(nodeByIdMap));
  if (nodeByIdMap instanceof Map) nodeMap = nodeByIdMap;

  const prereqGraph = new Map();
  for (const node of nodes || []) {
    if (!node?.id) continue;
    const { activePathNodeIds, activeBranches } = computeUpstreamTopologyPath([node.id], nodeMap);
    prereqGraph.set(node.id, {
      nodeIds: activePathNodeIds,
      branches: activeBranches
    });
  }

  return prereqGraph;
}

/**
 * 邊啟用狀態判定
 * 判定給定有向邊是否處於目前啟用的前置/高亮路徑中 (雙端點皆在集合內)。
 *
 * @param {{ startId?: string, endId?: string, source?: string, target?: string }} edge
 * @param {Set<string>} activePathNodeIds
 * @returns {boolean}
 */
export function isEdgeActive(edge, activePathNodeIds) {
  if (!edge || !activePathNodeIds) return false;
  // Canonical JSON uses { from, to }; runtime edge objects may expose
  // startId/endId or source/target. Normalize each form at the domain boundary.
  const start = edge.startId || edge.source || edge.from;
  const end = edge.endId || edge.target || edge.to;
  return activePathNodeIds.has(start) && activePathNodeIds.has(end);
}

/**
 * 批次計算所有邊的啟用狀態集合
 * @param {Array<object>} edges
 * @param {Set<string>} activePathNodeIds
 * @returns {Set<string>} Set of active edge keys (e.g. "source->target")
 */
export function computeEdgeStates(edges, activePathNodeIds) {
  const activeEdges = new Set();
  if (!Array.isArray(edges) || !activePathNodeIds || activePathNodeIds.size === 0) {
    return activeEdges;
  }
  for (const edge of edges) {
    if (isEdgeActive(edge, activePathNodeIds)) {
      const key = `${edge.startId || edge.source || edge.from}->${edge.endId || edge.target || edge.to}`;
      activeEdges.add(key);
    }
  }
  return activeEdges;
}

function initializeGraph(nodesList) {
  const inDegree = new Map();
  const adjacency = new Map();
  const nodeIds = new Set();
  for (const node of nodesList) {
    if (!node?.id) continue;
    nodeIds.add(node.id);
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  return { inDegree, adjacency, nodeIds };
}

function addGraphEdges(nodesList, graph) {
  for (const node of nodesList) {
    if (!node?.id) continue;
    for (const target of node.next_nodes || []) {
      if (!graph.nodeIds.has(target)) continue;
      graph.adjacency.get(node.id).push(target);
      graph.inDegree.set(target, (graph.inDegree.get(target) || 0) + 1);
    }
  }
}

function topologicallyVisited(graph) {
  const queue = [];
  graph.inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    visited.add(current);
    for (const next of graph.adjacency.get(current) || []) {
      const newDegree = graph.inDegree.get(next) - 1;
      graph.inDegree.set(next, newDegree);
      if (newDegree === 0) queue.push(next);
    }
  }
  return visited;
}

/**
 * 檢測圖結構是否存在循環依賴 (Kahn 拓撲排序檢驗)
 *
 * @param {Object[]} nodesList
 * @returns {{ hasCycle: boolean, cycleNodes: Array<string> }}
 */
export function detectGraphCycles(nodesList) {
  if (!Array.isArray(nodesList) || nodesList.length === 0) {
    return { hasCycle: false, cycleNodes: [] };
  }
  const graph = initializeGraph(nodesList);
  addGraphEdges(nodesList, graph);
  const visited = topologicallyVisited(graph);
  const hasCycle = visited.size !== graph.nodeIds.size;
  const cycleNodes = hasCycle
    ? [...graph.nodeIds].filter((id) => !visited.has(id))
    : [];

  return { hasCycle, cycleNodes };
}

function collectNodeIds(nodes, errors) {
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node?.id) {
      errors.push("存在缺少 id 的節點");
      continue;
    }
    if (nodeIds.has(node.id)) errors.push(`重複節點 ID: ${node.id}`);
    nodeIds.add(node.id);
  }
  return nodeIds;
}

function validateEdgeList(node, nodeIds, field, relation, errors) {
  for (const relatedId of node[field] || []) {
    if (relatedId === node.id) {
      const edgeName = relation === "next_nodes" ? "指向自身的自環邊 (Self-edge)" : "來自自身的自環 incoming 邊";
      errors.push(`節點 ${node.id} 包含${edgeName}`);
    }
    if (!nodeIds.has(relatedId)) {
      errors.push(`節點 ${node.id} 的 ${relation} 指向不存在的節點: ${relatedId}`);
    }
  }
}

function validateGraphEdges(nodes, nodeIds, errors) {
  let totalOutgoingEdges = 0;
  for (const node of nodes) {
    if (!node?.id) continue;
    totalOutgoingEdges += (node.next_nodes || []).length;
    validateEdgeList(node, nodeIds, "next_nodes", "next_nodes", errors);
    validateEdgeList(node, nodeIds, "incoming", "incoming", errors);
  }
  return totalOutgoingEdges;
}

function validateEdgeSymmetry(nodes, errors) {
  const nodeMap = new Map(nodes.filter((node) => node?.id).map((node) => [node.id, node]));
  for (const node of nodes) {
    if (!node?.id) continue;
    for (const targetId of node.next_nodes || []) {
      const target = nodeMap.get(targetId);
      if (target && !(target.incoming || []).includes(node.id)) {
        errors.push(`有效邊 ${node.id} -> ${targetId} 未在目標 incoming 中對稱記錄`);
      }
    }
    for (const sourceId of node.incoming || []) {
      const source = nodeMap.get(sourceId);
      if (source && !(source.next_nodes || []).includes(node.id)) {
        errors.push(`有效邊 ${sourceId} -> ${node.id} 未在來源 next_nodes 中對稱記錄`);
      }
    }
  }
}

/**
 * 圖拓撲完整性與無環驗證
 *
 * @param {Object[]} nodes
 * @param {Object} [summary]
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export function validateGraphTopology(nodes, summary = {}) {
  const errors = [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { isValid: false, errors: ["節點清單為空或非陣列"] };
  }
  const nodeIds = collectNodeIds(nodes, errors);
  const totalOutgoingEdges = validateGraphEdges(nodes, nodeIds, errors);
  validateEdgeSymmetry(nodes, errors);

  const { hasCycle } = detectGraphCycles(nodes);
  if (hasCycle) {
    errors.push("圖中檢測到環路 (Cycle detected)");
  }

  if (summary.node_count !== undefined && summary.node_count !== nodes.length) {
    errors.push(`summary.node_count (${summary.node_count}) 與實際節點數 (${nodes.length}) 不符`);
  }
  if (summary.edge_count !== undefined && summary.edge_count !== totalOutgoingEdges) {
    errors.push(`summary.edge_count (${summary.edge_count}) 與實際邊數 (${totalOutgoingEdges}) 不符`);
  }

  return { isValid: errors.length === 0, errors };
}

export const validateAcyclicDag = validateGraphTopology;
