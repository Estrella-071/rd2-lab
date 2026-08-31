import { computeUpstreamTopologyPath } from "./dag_topology.js";
import {
  calculateAllFactionLevels,
  getSimulationNodeView,
  getNodeMap
} from "./simulation_plan.js";

export const TREE_RENDER_VIEWBOX = Object.freeze({ x: 0, y: 0, width: 4000, height: 3400 });

const NODE_GEOMETRY = Object.freeze({
  DICE: Object.freeze({ width: 164, height: 190, shape: "dice" }),
  PERK: Object.freeze({ width: 164, height: 112, shape: "perk" }),
  DICE_RUNE: Object.freeze({ width: 118, height: 128, shape: "rune" }),
  LARGE_PASSIVE: Object.freeze({ width: 154, height: 154, shape: "large-passive" }),
  SMALL_PASSIVE: Object.freeze({ width: 122, height: 132, shape: "small-passive" })
});

const asId = (value) => value === undefined || value === null ? "" : String(value);

export function getNodeType(node) {
  return String(node?.node_type || node?.type || "").toUpperCase();
}

export function getNodeGeometry(node, manifestNode = null) {
  const manifestGeometry = manifestNode?.geometry;
  if (manifestGeometry
    && Number.isFinite(Number(manifestGeometry.width))
    && Number.isFinite(Number(manifestGeometry.height))) {
    return {
      width: Number(manifestGeometry.width),
      height: Number(manifestGeometry.height),
      shape: String(manifestGeometry.shape || "node")
    };
  }
  const type = getNodeType(node);
  if (type === "DICE") return { ...NODE_GEOMETRY.DICE };
  if (type === "PERK") return { ...NODE_GEOMETRY.PERK };
  if (type === "DICE_RUNE") return { ...NODE_GEOMETRY.DICE_RUNE };
  return { ...(node?.is_big ? NODE_GEOMETRY.LARGE_PASSIVE : NODE_GEOMETRY.SMALL_PASSIVE) };
}

export function getNodePosition(node, nodePositions = null, manifestNodes = null) {
  const id = asId(node?.id);
  const manifestNode = manifestNodes?.id !== undefined
    ? manifestNodes
    : manifestNodes?.get?.(id) || manifestNodes?.[id];
  const position = nodePositions?.get?.(id) || nodePositions?.[id] || manifestNode;
  const x = Number(position?.x ?? node?.x);
  const y = Number(position?.y ?? node?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function getRenderNodeLabel(node, localization = null) {
  const id = asId(node?.id);
  // The tree uses the game's full display name (for example, "Flower Dice"),
  // while the compact card uses the short name ("Flower").  Localization
  // keeps both keys on the runtime node; prefer the full-name key for the map
  // label and keep the manifest id only as a legacy fallback.
  const labelKey = node?._fullNameKey || node?.full_name_key || node?._nameKey || node?.name_key || node?.labelKey;
  if (localization?.t && labelKey) {
    const key = labelKey === true ? `node.${id}.name` : String(labelKey);
    return localization.t(key, {}, node.name_zh || node.name || id);
  }
  return String(node?.name_zh || node?.name || node?.short_label || id);
}

function collectLinkedSelectedIds(selectedNodeId, nodesMap) {
  const linked = new Set();
  if (!selectedNodeId) return linked;
  const selected = nodesMap.get(asId(selectedNodeId));
  const diceName = selected?.dice_type || selected?.rune_dice;
  if (!diceName) return linked;
  nodesMap.forEach((node) => {
    if (asId(node.id) === asId(selectedNodeId)) return;
    const type = getNodeType(node);
    const nodeDice = node.dice_type || node.rune_dice;
    if (type === "DICE_RUNE" && nodeDice === diceName) linked.add(asId(node.id));
  });
  return linked;
}

function edgeEndpoints(edge) {
  return {
    from: asId(edge?.from ?? edge?.source ?? edge?.startId),
    to: asId(edge?.to ?? edge?.target ?? edge?.endId)
  };
}

function getEdges(treeData, renderManifest) {
  const manifestEdges = Array.isArray(renderManifest?.edges) ? renderManifest.edges : [];
  const source = manifestEdges.length > 0 ? manifestEdges : (treeData?.edges || []);
  return source.map((edge) => {
    const { from, to } = edgeEndpoints(edge);
    return { ...edge, from, to, key: String(edge.key || `${from}->${to}`) };
  }).filter((edge) => edge.from && edge.to);
}

function resolveActiveFilterPath(state, nodesMap) {
  const filters = state?.filters || {};
  const hasSearch = Boolean(String(filters.search || "").trim());
  const hasFactionFilter = Boolean(filters.factions?.size > 0);
  const hasTypeFilter = Boolean(filters.nodeTypes?.size > 0);
  const hasFilter = hasSearch || hasFactionFilter || hasTypeFilter;
  const matching = new Set([...state?.matchingNodeIds || []].map(asId));
  const filterPath = hasFilter && matching.size > 0
    ? computeUpstreamTopologyPath(matching, nodesMap).activePathNodeIds
    : matching;
  return { hasFilter, hasSearch, hasFactionFilter, hasTypeFilter, matching, filterPath };
}

function resolveLockedVariant(node) {
  const nodeType = getNodeType(node);
  if (nodeType === "DICE_RUNE") return "rune-locked";
  if (nodeType === "PLAYER_PASSIVE") return "passive-locked";
  return "dice-locked";
}

function resolveNodeVisualVariant(node, view, context) {
  if (!context.isSimulation) return "normal";
  if (view?.isSpecial || view?.isLocked) return resolveLockedVariant(node);
  return "normal";
}

function hasRenderUnlock(renderUnlockState, id) {
  const preUnlocked = renderUnlockState?.preUnlockedIds;
  const renderUnlocked = renderUnlockState?.renderUnlockedIds;
  const hasId = (collection) => collection instanceof Set
    ? collection.has(id)
    : Array.isArray(collection) && collection.some((value) => asId(value) === id);
  const isPreUnlocked = hasId(preUnlocked);
  const isRenderedUnlocked = hasId(renderUnlocked);
  return isPreUnlocked && !isRenderedUnlocked;
}

/**
 * Build a serializable, DOM-free visual state. Both the live renderer and the
 * share exporter consume this model so unlock visibility and topology cannot
 * diverge between the two surfaces.
 */
export function buildTreeRenderModel({ treeData, state = {}, renderManifest = null, nodePositions = null, localization = null } = {}) {
  const nodes = Array.isArray(treeData?.nodes) ? treeData.nodes : [];
  const nodesMap = state.nodesMap instanceof Map ? state.nodesMap : getNodeMap(treeData || nodes);
  const manifestNodes = new Map((renderManifest?.nodes || []).map((node) => [asId(node.id), node]));
  const selectedNodeId = asId(state.selectedNodeId);
  const linkedSelectedIds = collectLinkedSelectedIds(selectedNodeId, nodesMap);
  const filter = resolveActiveFilterPath(state, nodesMap);
  const activePrereqIds = new Set([...state.activePrereqIds || []].map(asId));
  const activeEdgeIds = new Set([...state.activeEdgeIds || []].map(String));
  const isSimulation = Boolean(state.simulation?.active);
  const context = {
    isSimulation,
    hasSelection: Boolean(selectedNodeId),
    hasPrereqHighlight: Boolean(state.showPrereqMode && activePrereqIds.size > 0),
    ...filter
  };
  const activeBranches = new Set();
  filter.hasFactionFilter && state.filters.factions.forEach((branch) => activeBranches.add(Number(branch)));
  if (selectedNodeId && nodesMap.get(selectedNodeId)) activeBranches.add(Number(nodesMap.get(selectedNodeId).branch || 0));
  if (context.hasPrereqHighlight) {
    activePrereqIds.forEach((id) => {
      const node = nodesMap.get(id);
      if (node) activeBranches.add(Number(node.branch || node.faction || 0));
    });
  }
  if (filter.hasFilter && filter.matching.size > 0) computeUpstreamTopologyPath(filter.matching, nodesMap).activeBranches.forEach((branch) => activeBranches.add(branch));
  // Closing the tooltip is the first half of the mobile prerequisite gesture.
  // Keep the temporary path as the visual focus until the following blank tap,
  // so unrelated nodes and edges do not flash back to full brightness.
  const hasVisualFocus = context.hasSelection || context.hasPrereqHighlight;
  const modelNodes = nodes.map((node) => {
    const id = asId(node.id);
    const manifestNode = manifestNodes.get(id);
    const position = getNodePosition(node, nodePositions, manifestNode);
    const geometry = getNodeGeometry(node, manifestNode);
    const isSelected = id === selectedNodeId;
    const isLinkedSelected = linkedSelectedIds.has(id);
    const isPrereq = activePrereqIds.has(id);
    const isMatching = filter.matching.has(id);
    let simulationView = isSimulation ? getSimulationNodeView(id, state.simulation, nodesMap) : null;
    if (simulationView && hasRenderUnlock(state.renderUnlockState, id)) {
      simulationView = {
        ...simulationView,
        rank: 0,
        progress: 0,
        isUnlocked: false,
        isVisible: false,
        isLocked: !simulationView.isSpecial,
        alwaysVisible: false
      };
    }
    const isFilterVisible = isMatching || filter.filterPath.has(id);
    const isDimmed = !isSimulation && (hasVisualFocus
      ? !isPrereq && !isLinkedSelected && (!context.hasFilter || !isFilterVisible)
      : context.hasFilter && !isFilterVisible);
    return {
      id,
      node,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      position,
      branch: Number(node.branch || node.faction || 1) || 1,
      nodeType: getNodeType(node),
      isBig: Boolean(node.is_big),
      geometry,
      labelAnchor: manifestNode?.labelAnchor || null,
      rankAnchor: manifestNode?.rankAnchor || null,
      artworkBounds: manifestNode?.artworkBounds || null,
      hitBox: manifestNode?.hitBox || {
        x: (position?.x ?? 0) - geometry.width / 2,
        y: (position?.y ?? 0) - geometry.height / 2,
        width: geometry.width,
        height: geometry.height
      },
      label: getRenderNodeLabel(node, localization),
      isSelected,
      isLinkedSelected,
      isPrereq,
      isMatching,
      isDimmed,
      simulationView,
      simulationVariant: resolveNodeVisualVariant(node, simulationView, context),
      frame: manifestNode?.frames || null,
      maxRank: simulationView?.maxRank ?? (Number(node.max_rank || node.max_level || 1) || 1),
      rank: simulationView?.rank ?? 0
    };
  });
  const nodesById = new Map(modelNodes.map((node) => [node.id, node]));
  const edges = getEdges(treeData, renderManifest).map((edge) => {
    const activeByPrereq = activePrereqIds.has(edge.from) && activePrereqIds.has(edge.to);
    const active = activeByPrereq || activeEdgeIds.has(edge.key);
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    // Faction-level gates remain visible so the simulator can show their
    // requirement, but they are not unlocked until that requirement is met.
    // Bright simulation topology must stop at the unlocked frontier instead
    // of extending through a merely visible gate toward locked content.
    const simulationActive = !isSimulation || Boolean(fromNode?.simulationView?.isUnlocked && toNode?.simulationView?.isUnlocked);
    const filterActive = !filter.hasFilter || (filter.filterPath.has(edge.from) && filter.filterPath.has(edge.to));
    return {
      ...edge,
      fromNode,
      toNode,
      isActive: active,
      isFilterActive: filterActive,
      isSimulationActive: simulationActive,
      isDimmed: Boolean(hasVisualFocus && !active)
    };
  });
  const centerLinks = (renderManifest?.centerLinks || []).map((link) => {
    const branch = Number(link?.branch || 0);
    const branchActive = activeBranches.has(branch);
    const isFilterActive = Boolean(filter.hasFilter && branchActive);
    const isPrereqActive = Boolean(context.hasPrereqHighlight && branchActive);
    const isActive = isFilterActive || isPrereqActive;
    return {
      ...link,
      branch,
      from: link?.from ? { x: Number(link.from.x), y: Number(link.from.y) } : null,
      to: link?.to ? { x: Number(link.to.x), y: Number(link.to.y) } : null,
      isActive,
      isFilterActive,
      isPrereqActive,
      isDimmed: Boolean((filter.hasFilter || context.hasPrereqHighlight) && !isActive)
    };
  });
  return {
    viewBox: renderManifest?.viewBox || TREE_RENDER_VIEWBOX,
    tileSize: Number(renderManifest?.tile?.logicalSize || 512),
    nodes: modelNodes,
    nodesById,
    edges,
    centerLinks,
    selectedNodeId: selectedNodeId || null,
    linkedSelectedIds,
    activePrereqIds,
    activeEdgeIds,
    activeBranches,
    hasFilter: filter.hasFilter,
    hasSelection: context.hasSelection,
    hasPrereqHighlight: context.hasPrereqHighlight,
    isSimulation,
    factionLevels: calculateAllFactionLevels({ ranks: isSimulation ? state.simulation?.ranks : null, nodes: nodesMap }),
    locale: localization?.getLocale?.() || null
  };
}

export function resolveNodeFrame(modelNode, variant = "normal", scale = 1) {
  const frames = modelNode?.frame || {};
  return frames[`${variant}-${scale}x`] || frames[`normal-${scale}x`] || null;
}
