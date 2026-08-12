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

function hasTooltipViewport(params, tipWidth, tipHeight) {
  return Number.isFinite(params.viewportWidth)
    && Number.isFinite(params.viewportHeight)
    && params.viewportWidth > 0
    && params.viewportHeight > 0
    && tipWidth > 0
    && tipHeight > 0;
}

function fitsTooltipVertically(candidateTop, tipHeight, viewportHeight, viewportPadding) {
  return candidateTop >= viewportPadding
    && candidateTop + tipHeight <= viewportHeight - viewportPadding;
}

function fitsTooltipWithinViewport(candidateTop, tipHeight, viewportHeight) {
  return candidateTop >= 0 && candidateTop + tipHeight <= viewportHeight;
}

function resolveTooltipVerticalPlacement({ screenY, nodeRadius, tipHeight, gap, placeBelow, hasViewport, viewportHeight, viewportPadding }) {
  const aboveTop = screenY - nodeRadius - tipHeight - gap;
  const belowTop = screenY + nodeRadius + gap;
  let isPlacedBelow = placeBelow;
  let top = isPlacedBelow ? belowTop : aboveTop;

  if (!hasViewport || fitsTooltipVertically(top, tipHeight, viewportHeight, viewportPadding)) {
    return { top, isPlacedBelow };
  }

  // The padding is a comfort inset, not a reason to reverse the requested
  // side when the complete card still fits inside the viewport.
  if (fitsTooltipWithinViewport(top, tipHeight, viewportHeight)) {
    return { top, isPlacedBelow };
  }

  const alternativeTop = isPlacedBelow ? aboveTop : belowTop;
  if (fitsTooltipVertically(alternativeTop, tipHeight, viewportHeight, viewportPadding)) {
    return { top: alternativeTop, isPlacedBelow: !isPlacedBelow };
  }

  const aboveSpace = Math.max(0, screenY - nodeRadius - viewportPadding);
  const belowSpace = Math.max(0, viewportHeight - viewportPadding - belowTop);
  isPlacedBelow = belowSpace >= aboveSpace;
  top = isPlacedBelow ? belowTop : aboveTop;
  return { top, isPlacedBelow };
}

function clampTooltipScreenPosition({ left, top, tipWidth, tipHeight, viewportWidth, viewportHeight, viewportPadding }) {
  const maxLeft = Math.max(viewportPadding, viewportWidth - tipWidth - viewportPadding);
  const maxTop = Math.max(viewportPadding, viewportHeight - tipHeight - viewportPadding);
  return {
    left: Math.min(maxLeft, Math.max(viewportPadding, left)),
    top: Math.min(maxTop, Math.max(viewportPadding, top))
  };
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
 * @param {number} [params.tipWidth=0]
 * @param {number} [params.tipHeight=0]
 * @param {boolean} [params.placeBelow=false]
 * @param {number} [params.gap=16]
 * @param {number} [params.viewportWidth] Viewport width for adaptive placement.
 * @param {number} [params.viewportHeight] Viewport height for adaptive placement.
 * @param {number} [params.viewportPadding=12] Viewport inset.
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
  const nodeRadius = (isLarge ? 52 : 36) * scale;

  const hasViewport = hasTooltipViewport(params, tipWidth, tipHeight);
  const viewportPadding = Math.max(0, Number(params.viewportPadding ?? 12) || 0);
  const verticalPlacement = resolveTooltipVerticalPlacement({
    screenY,
    nodeRadius,
    tipHeight,
    gap,
    placeBelow,
    hasViewport,
    viewportHeight: params.viewportHeight,
    viewportPadding
  });
  let { top, isPlacedBelow } = verticalPlacement;

  let left = screenX - tipWidth / 2;
  if (hasViewport) {
    ({ left, top } = clampTooltipScreenPosition({
      left,
      top,
      tipWidth,
      tipHeight,
      viewportWidth: params.viewportWidth,
      viewportHeight: params.viewportHeight,
      viewportPadding
    }));
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    isPlacedBelow
  };
}

export const calculateTooltipScreenPosition = computeTooltipScreenCoordinates;
