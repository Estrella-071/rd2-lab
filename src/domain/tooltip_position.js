/** @fileoverview Tooltip placement and screen-coordinate helpers. */

/**
 * Decide whether the tooltip should open below the node.
 * Supports the positional and object argument forms.
 *
 * @param {string|Object} nodeIdOrParams
 * @param {Map|Object} [nodePositions]
 * @param {Set|Array} [activePrereqNodeIds]
 * @param {Object} [options]
 * @returns {boolean} true 表示置於下方 (.is-placed-below)
 */
function normalizePlacementArgs(nodeIdOrParams, nodePositions, activePrereqNodeIds, options) {
  const isObject = typeof nodeIdOrParams === "object" && nodeIdOrParams !== null && !Array.isArray(nodeIdOrParams);
  const source = isObject ? nodeIdOrParams : {
    nodeId: nodeIdOrParams,
    nodePositions,
    activePrereqNodeIds,
    threshold: options.threshold,
    isClosing: options.isClosing,
    isCurrentlyBelow: options.isCurrentlyBelow,
    selectedId: options.selectedId,
    pt: options.pt
  };
  return {
    nodeId: source.nodeId,
    positions: source.nodePositions,
    prereqIds: source.activePrereqNodeIds,
    threshold: source.threshold ?? 40,
    isClosing: source.isClosing ?? false,
    isCurrentlyBelow: source.isCurrentlyBelow ?? false,
    selectedId: source.selectedId ?? null,
    directPt: source.pt ?? null
  };
}

function getPosition(positions, id) {
  if (!positions) return null;
  if (positions instanceof Map) {
    return positions.get(String(id)) || positions.get(Number(id)) || positions.get(id) || null;
  }
  return positions[String(id)] || positions[Number(id)] || positions[id] || null;
}

function averagePrerequisiteY(prereqSet, nodeId, getPoint) {
  let totalY = 0;
  let count = 0;
  prereqSet.forEach((prerequisiteId) => {
    if (prerequisiteId === nodeId) return;
    const point = getPoint(prerequisiteId);
    if (point && typeof point.y === "number") {
      totalY += point.y;
      count += 1;
    }
  });
  return count > 0 ? totalY / count : null;
}

function hasTooltipViewport(params, tipWidth) {
  return Number.isFinite(params.viewportWidth)
    && params.viewportWidth > 0
}

function resolveTooltipVerticalPlacement({ screenY, nodeRadius, tipHeight, gap, placeBelow }) {
  const aboveTop = screenY - nodeRadius - tipHeight - gap;
  const belowTop = screenY + nodeRadius + gap;
  // Vertical placement is semantic, not viewport-adaptive.  The card belongs
  // above its node by default; shouldPlaceTooltipBelow() is the only rule that
  // may request the lower side when the prerequisite path is above the node.
  // Clamping or flipping against the camera viewport makes the card jump sides
  // while the camera is moving and can place it over the node itself.
  return {
    top: placeBelow ? belowTop : aboveTop,
    isPlacedBelow: Boolean(placeBelow)
  };
}

function resolveNodeRadius(params, scale, isLarge) {
  const screenRadius = Number(params.screenNodeRadius);
  if (Number.isFinite(screenRadius) && screenRadius >= 0) return screenRadius;
  const nodeRadius = Number(params.nodeRadius);
  if (Number.isFinite(nodeRadius) && nodeRadius >= 0) return nodeRadius * scale;
  const fallback = isLarge ? 52 : 36;
  return fallback * scale;
}

export function shouldPlaceTooltipBelow(nodeIdOrParams, nodePositions, activePrereqNodeIds, options = {}) {
  const { nodeId, positions, prereqIds, threshold, isClosing, isCurrentlyBelow, selectedId, directPt } = normalizePlacementArgs(nodeIdOrParams, nodePositions, activePrereqNodeIds, options);

  if (isClosing) {
    return Boolean(isCurrentlyBelow);
  }

  if (!nodeId && !directPt) return false;

  const pt = directPt || getPosition(positions, nodeId);
  if (!pt || typeof pt.y !== "number") return false;

  const prereqSet = prereqIds instanceof Set ? prereqIds : new Set(prereqIds || []);
  if (prereqSet.size <= 1) {
    return false;
  }

  let isTargetOrSelected = true;
  if (selectedId) isTargetOrSelected = selectedId === nodeId;
  else if (nodeId) isTargetOrSelected = prereqSet.has(nodeId);
  if (!isTargetOrSelected) return false;

  const avgPrereqY = averagePrerequisiteY(prereqSet, nodeId, (id) => getPosition(positions, id));
  return avgPrereqY !== null && avgPrereqY < pt.y + threshold;
}

/**
 * Tooltip 螢幕像素座標轉換 (0 次 DOM 查詢)
 *
 * @param {Object} params
 * @param {{ x: number, y: number }} [params.pt]
 * @param {{ x: number, y: number }} [params.nodePt]
 * @param {number} [params.scale=1]
 * @param {number} [params.panX=0]
 * @param {number} [params.panY=0]
 * @param {string} [params.nodeType="DICE_RUNE"]
 * @param {boolean} [params.isLarge=false]
 * @param {number} [params.nodeRadius] Node radius in logical/map units.
 * @param {number} [params.screenNodeRadius] Node radius already converted to screen pixels.
 * @param {number} [params.tipWidth=0]
 * @param {number} [params.tipHeight=0]
 * @param {boolean} [params.placeBelow=false]
 * @param {number} [params.gap=16]
 * @param {number} [params.viewportWidth] Viewport width for horizontal clamping.
 * @param {number} [params.viewportPadding=12] Horizontal viewport inset.
 * @returns {{ left: number, top: number, isPlacedBelow: boolean }}
 */
export function computeTooltipScreenCoordinates(params = {}) {
  const pt = params.pt || params.nodePt;
  const scale = params.scale ?? 1;
  const panX = params.panX ?? 0;
  const panY = params.panY ?? 0;
  const tipWidth = params.tipWidth ?? 0;
  const tipHeight = params.tipHeight ?? 0;
  const placeBelow = Boolean(params.placeBelow);
  const gap = params.gap ?? 16;

  if (!pt || typeof pt.x !== "number" || typeof pt.y !== "number") {
    return { left: 0, top: 0, isPlacedBelow: false };
  }

  const screenX = panX + pt.x * scale;
  const screenY = panY + pt.y * scale;

  const isLarge = Boolean(params.isLarge || params.nodeType === "DICE" || params.nodeType === "PERK");
  const nodeRadius = resolveNodeRadius(params, scale, isLarge);

  const hasViewport = hasTooltipViewport(params, tipWidth);
  const viewportPadding = Math.max(0, Number(params.viewportPadding ?? 12) || 0);
  const verticalPlacement = resolveTooltipVerticalPlacement({
    screenY,
    nodeRadius,
    tipHeight,
    gap,
    placeBelow
  });
  let { top, isPlacedBelow } = verticalPlacement;

  let left = screenX - tipWidth / 2;
  if (hasViewport) {
    const maxLeft = Math.max(viewportPadding, params.viewportWidth - tipWidth - viewportPadding);
    left = Math.min(maxLeft, Math.max(viewportPadding, left));
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    isPlacedBelow
  };
}

export const calculateTooltipScreenPosition = computeTooltipScreenCoordinates;
