import {
  buildTreeRenderModel,
  getNodeType,
  resolveNodeFrame
} from "../domain/tree_render_model.js";
import { getUnlockConditionLabel } from "../domain/simulation_plan.js";
import { selectMapResolution } from "../domain/map_resolution.js";

const NODE_CELL_SIZE = 192;
// Candidate frames are rendered off-screen and committed atomically. Keep one
// coarse cancellation checkpoint without yielding to a future paint frame;
// delaying each batch makes a fresh resolution visibly arrive after the map.
const SCENE_YIELD_BATCH = 128;
// A drawImage can synchronously upload a previously unseen atlas page to the
// compositor. The batch is selected from the candidate's physical density:
// distant overview frames have cheap, small samples and should not wait one
// refresh interval per eight nodes, while 3x close-up frames keep the tighter
// checkpoint to avoid a long upload task.
const NODE_ART_YIELD_BATCH = 8;
const DYNAMIC_BOUNDS_PADDING = 128;
const OVERVIEW_RESOLUTION = 1;
const OVERVIEW_MIN_PIXEL_SCALE = 0.5;
// Active paths are stateful but contain no image assets. Keep their continuity
// overlay cheaper than the sprite overview so state changes can repaint the
// whole map synchronously without retaining every 1x atlas page.
const OVERVIEW_EDGE_PIXEL_SCALE = 0.25;
// Dimming is a world-space state, not a viewport-space effect. Keep one fixed
// low-density geometry surface for the complete map so panning never exposes
// an unpainted edge of the dim layer. The underlying node-art surface remains
// at the active resolution, so the flat tint does not lower icon sharpness.
const FULL_MAP_DIM_MASK_PIXEL_SCALE = 0.5;
const FULL_MAP_DIM_MASK_ALPHA = 0.66;
// Keep the line-dimming veil in one fixed world-space bitmap as well. The
// mask is deliberately low density because it only contains a flat tint and
// transparent holes; the active line itself remains in the resolution-sized
// static composite below it.
const FULL_MAP_EDGE_DIM_MASK_PIXEL_SCALE = 0.25;
const ADJACENT_RESOLUTION_WARMUP_DELAY_MS = 900;
const SELECTION_ANIMATION_DURATION_MS = 4800;
const SIMULATION_OCCLUSION_FILL = "#2f2942";
const FILTER_RENDER_ACTIONS = new Set(["SET_FILTER", "CLEAR_FILTERS"]);
const IMMEDIATE_STATE_OVERLAY_ACTIONS = new Set([
  "SELECT_NODE",
  "DESELECT_NODE",
  "TOGGLE_PREREQ_MODE",
  "SET_SHOW_PREREQ_MODE",
]);
const IMMEDIATE_SIMULATION_STATE_ACTIONS = new Set([
  "SIMULATION_UNLOCK_NODE",
  "SIMULATION_MAX_NODE",
  "SIMULATION_BATCH_UNLOCK",
  "SIMULATION_REVOKE_NODE",
  "SIMULATION_RESET",
  "SET_SIMULATION_STATE"
]);
const NODE_LABEL_FONT = "800 14.5px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif";
const COLORS = Object.freeze({
  1: { base: "#89e464", runner: "#d7ffa4" },
  2: { base: "#f5da68", runner: "#ffffa2" },
  3: { base: "#4692f1", runner: "#7cfafd" },
  4: { base: "#9f95c1", runner: "#fff" },
  5: { base: "#a93bea", runner: "#ee6cfa" }
});
const NODE_VISUAL_SCALE = Object.freeze({
  dice: 0.72,
  perk: 0.72,
  rune: 0.56,
  "large-passive": 0.72,
  "small-passive": 0.72
});
const NODE_OCCLUSION_GEOMETRY = Object.freeze({
  dice: Object.freeze({ kind: "roundedRect", x: -48.24, y: -50.4, width: 96.48, height: 100.8, radius: 11.52 }),
  perk: Object.freeze({ kind: "roundedRect", x: -48.96, y: -27.36, width: 97.92, height: 54.72, radius: 10.08 }),
  rune: Object.freeze({ kind: "ellipse", x: 0, y: 4, radiusX: 27, radiusY: 30 }),
  "large-passive": Object.freeze({ kind: "rotatedRoundedRect", size: 68, radius: 14 }),
  "small-passive": Object.freeze({ kind: "circle", radius: 38 })
});
const CENTER_STATS = Object.freeze({
  1: { x: 2000, nameY: 1546, valueY: 1586 },
  2: { x: 1914, nameY: 1824.8, valueY: 1864 },
  3: { x: 2098, nameY: 1834, valueY: 1874 },
  4: { x: 1832, nameY: 1648, valueY: 1688 },
  5: { x: 2168, nameY: 1648, valueY: 1688 }
});
const CURRENCY_SPRITE_BOXES = Object.freeze({
  gold: Object.freeze({ x: -0.2605634, y: -0.2676056, width: 1.5211268, height: 1.6197183 }),
  core: Object.freeze({ x: -0.2219731, y: -0.2690583, width: 1.4439462, height: 1.6233184 })
});

function yieldToNextFrame() {
  if (typeof requestAnimationFrame === "function") {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function drawNodeBatches(nodes, drawNode, isCurrent, batchSize = SCENE_YIELD_BATCH) {
  for (let index = 0; index < nodes.length; index += batchSize) {
    if (isCurrent && !isCurrent()) return false;
    for (const node of nodes.slice(index, index + batchSize)) drawNode(node);
    if (index + batchSize < nodes.length) await yieldToNextFrame();
  }
  return true;
}

function getNodeArtBatchSize(context, bounds) {
  const pixelScale = Number(context?.canvas?.width || 0) / Math.max(1, Number(bounds?.width || 1));
  if (pixelScale <= 0.75) return 96;
  if (pixelScale <= 1.25) return 64;
  if (pixelScale <= 2) return 32;
  return 16;
}

export function getNodeOcclusionGeometry(shape) {
  return NODE_OCCLUSION_GEOMETRY[shape] || NODE_OCCLUSION_GEOMETRY["small-passive"];
}

async function warmCanvasFonts() {
  const fonts = typeof document !== "undefined" ? document.fonts : null;
  if (!fonts) return;
  const requests = [
    NODE_LABEL_FONT,
    "700 16px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif",
    "800 44px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif",
    "800 18px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif"
  ];
  await Promise.all(requests.map((font) => loadCanvasFont(fonts, font)));
  try { await fonts.ready; } catch { /* Use the system fallback. */ }
}

function loadCanvasFont(fonts, font) {
  if (typeof fonts.load !== "function") return Promise.resolve();
  return Promise.resolve()
    .then(() => fonts.load(font))
    .catch(() => undefined);
}

function isElement(value) {
  return value && typeof value === "object" && typeof value.appendChild === "function";
}

function getCanvas2DContext(canvas) {
  if (!canvas?.getContext) return null;
  try {
    // A desynchronized context is useful for a continuously painted video
    // surface, but this renderer commits complete raster frames atomically.
    // On mobile browsers the hint can leave a transformed canvas backed by a
    // lower-resolution presentation surface after a zoom. Use the regular
    // 2D presentation path so the committed bitmap is sampled at its actual
    // backing resolution.
    return canvas.getContext("2d", { alpha: true })
      || canvas.getContext("2d");
  } catch {
    return canvas.getContext("2d");
  }
}

function estimateTextWidth(text, fontSize = 14.5) {
  let width = 0;
  for (const character of String(text || "")) {
    width += character.codePointAt(0) > 255 ? fontSize * 1.08 : fontSize * 0.62;
  }
  return Math.round(width);
}

function appendRoundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  appendRoundedRectPath(ctx, x, y, width, height, radius);
  ctx.closePath();
}

function getNodeLabelTop(node) {
  const offset = Number(node.labelAnchor?.offsetY);
  if (Number.isFinite(offset)) return node.y + offset;
  let fallback = -60;
  if (node.isBig) fallback = -71;
  if (node.nodeType === "DICE_RUNE") fallback = -47;
  if (node.nodeType === "PERK") fallback = -90;
  if (node.nodeType === "DICE") fallback = -78;
  return node.y + fallback;
}

function getNodeLabelCenterX(node) {
  return node.x + (Number.isFinite(Number(node.labelAnchor?.offsetX))
    ? Number(node.labelAnchor.offsetX)
    : 0);
}

function getLabelScale(anchor) {
  const scale = Number(anchor?.scale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getTextMetrics(ctx, text) {
  if (typeof ctx?.measureText === "function") return Number(ctx.measureText(String(text || "")).width) || 0;
  return estimateTextWidth(text, 14.5);
}

function getSelectionArtworkBounds(node) {
  const shape = node?.geometry?.shape;
  const manifestBounds = node?.artworkBounds;
  const fallback = {
    dice: { x: -45.878, y: -63.907, width: 91.757, height: 114.307 },
    perk: { x: -44.64, y: -66.24, width: 89.28, height: 93.6 },
    rune: { x: -17.76, y: -20.56, width: 35.52, height: 41.12 },
    "large-passive": { x: -16.2, y: -18.18, width: 32.4, height: 35.64 },
    "small-passive": { x: -16.2, y: -18.18, width: 32.4, height: 35.64 }
  }[shape];
  const source = manifestBounds || fallback;
  if (!source) return null;
  const x = Number(source.x);
  const y = Number(source.y);
  const width = Number(source.width);
  const height = Number(source.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  // A rune's source sprite includes its outer circular frame. Keep a small
  // inner cutout so the selection ring remains visible on that frame while
  // never painting across the rune glyph itself.
  const inset = shape === "rune" ? Math.min(8, width / 4, height / 4) : 0;
  return {
    left: Number(node.x) + x + inset,
    top: Number(node.y) + y + inset,
    right: Number(node.x) + x + width - inset,
    bottom: Number(node.y) + y + height - inset
  };
}

function appendSelectionArtworkCutoutPath(ctx, node, bounds) {
  const shape = node?.geometry?.shape;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  let shapeRadius = 10;
  if (shape === "dice") shapeRadius = 18;
  if (shape === "perk") shapeRadius = 14;
  const radius = Math.min(shapeRadius, width / 2, height / 2);
  if (shape === "rune") {
    ctx.ellipse(
      (bounds.left + bounds.right) / 2,
      (bounds.top + bounds.bottom) / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2
    );
    return;
  }
  appendRoundedRectPath(ctx, bounds.left, bounds.top, width, height, radius);
  // appendRoundedRectPath is intentionally open because roundedRect() closes
  // it for fill/stroke.  clip() implicitly closes open subpaths with a
  // straight segment, which creates a triangular/right-angle artifact in the
  // artwork hole. Close it explicitly before using it as a clipping path.
  ctx.closePath();
}

function drawOutsideSelectionArtwork(ctx, node, draw) {
  const bounds = getSelectionArtworkBounds(node);
  if (!bounds || typeof ctx?.rect !== "function" || typeof ctx?.clip !== "function") {
    draw();
    return;
  }
  const margin = 256;
  const outerLeft = Number(node.x) - margin;
  const outerTop = Number(node.y) - margin;
  const outerRight = Number(node.x) + margin;
  const outerBottom = Number(node.y) + margin;
  const cutLeft = Math.max(outerLeft, Math.min(outerRight, bounds.left));
  const cutTop = Math.max(outerTop, Math.min(outerBottom, bounds.top));
  const cutRight = Math.max(outerLeft, Math.min(outerRight, bounds.right));
  const cutBottom = Math.max(outerTop, Math.min(outerBottom, bounds.bottom));
  ctx.save();
  ctx.beginPath();
  ctx.rect(outerLeft, outerTop, outerRight - outerLeft, outerBottom - outerTop);
  appendSelectionArtworkCutoutPath(ctx, node, {
    left: cutLeft,
    top: cutTop,
    right: cutRight,
    bottom: cutBottom
  });
  // The artwork cutout is a rounded/elliptical hole, not a rectangle. Using
  // even-odd clipping keeps the selection stroke smooth where it exits the
  // icon instead of leaving the old square corner artifacts.
  try {
    ctx.clip("evenodd");
  } catch {
    // All supported browsers implement the fill rule. Keep a safe fallback
    // for minimal test or embedded contexts that expose clip() without its
    // optional argument.
    ctx.restore();
    draw();
    return;
  }
  draw();
  ctx.restore();
}

function getCurrencyEntries(node, currencyImages) {
  const gold = Number(Array.isArray(node.node?.gold_costs) ? node.node.gold_costs[0] : node.node?.unlock_gold) || 0;
  const core = Number(Array.isArray(node.node?.core_costs) ? node.node.core_costs[0] : node.node?.unlock_core) || 0;
  return [
    gold > 0 ? { kind: "gold", image: currencyImages?.get?.("gold"), value: gold } : null,
    core > 0 ? { kind: "core", image: currencyImages?.get?.("core"), value: core } : null
  ].filter(Boolean);
}

function drawLabel(ctx, text, x, y, options = {}) {
  const fontSize = options.size || 14.5;
  const font = options.font || `800 ${fontSize}px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif`;
  ctx.font = font;
  const measuredWidth = getTextMetrics(ctx, text);
  const width = resolveLabelWidth(options, measuredWidth);
  const height = resolveLabelHeight(options);
  const left = x - width / 2;
  roundedRect(ctx, left, y, width, height, height / 2);
  ctx.fillStyle = options.background || "rgba(27,21,40,.94)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = options.stroke || "#5a3fa2";
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = options.color || "#fff";
  ctx.fillText(text, x, y + height / 2 + 0.5);
}

function resolveLabelWidth(options, measuredWidth) {
  const requested = Number(options.width);
  if (Number.isFinite(requested) && requested > 0) return requested;
  const minimum = Number(options.minWidth);
  return Math.max(Number.isFinite(minimum) && minimum > 0 ? minimum : 76, measuredWidth + 28);
}

function resolveLabelHeight(options) {
  const requested = Number(options.height);
  return Number.isFinite(requested) && requested > 0 ? requested : 28;
}

function getRankBadgeMaxRank(node) {
  const value = Number(node?.maxRank ?? node?.node?.max_rank ?? node?.node?.max_level ?? 1);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/**
 * Canonical SVG rank badges exist only on upgradeable nodes.  The old SVG
 * view kept the source value (1/maxRank) in normal mode and replaced only the
 * value text in simulation mode.  Keep that same contract instead of
 * synthesizing a badge for every node.
 */
export function getSimulationRankBadgeText(node, isSimulation = false) {
  const maxRank = getRankBadgeMaxRank(node);
  if (maxRank <= 1) return null;
  const rawRank = isSimulation ? Number(node?.rank ?? node?.simulationView?.rank ?? 0) : 1;
  const rank = Number.isFinite(rawRank)
    ? Math.min(maxRank, Math.max(0, Math.floor(rawRank)))
    : 0;
  return `${rank}/${maxRank}`;
}

function getRankBadgeAnchor(node) {
  const anchor = node?.rankAnchor;
  const required = ["offsetX", "offsetY", "width", "height", "radius", "textOffsetX", "textOffsetY", "textSize", "strokeWidth", "scale"];
  if (anchor && required.every((key) => Number.isFinite(Number(anchor[key])))
    && Number(anchor.width) > 0 && Number(anchor.height) > 0
    && Number(anchor.radius) > 0 && Number(anchor.textSize) > 0
    && Number(anchor.strokeWidth) > 0 && Number(anchor.scale) > 0) {
    return anchor;
  }
  const scale = NODE_VISUAL_SCALE[node?.geometry?.shape] || 1;
  return {
    offsetX: 0,
    offsetY: 54 * scale,
    width: 60 * scale,
    height: 22 * scale,
    radius: 5.5 * scale,
    textOffsetX: 0,
    textOffsetY: 69.5 * scale,
    textSize: 14 * scale,
    strokeWidth: 1.5 * scale,
    scale
  };
}

function drawSimulationRankBadge(ctx, node, text) {
  if (!ctx || !node || !text) return;
  const anchor = getRankBadgeAnchor(node);
  const left = node.x + Number(anchor.offsetX) - Number(anchor.width) / 2;
  const top = node.y + Number(anchor.offsetY);
  ctx.save();
  roundedRect(ctx, left, top, Number(anchor.width), Number(anchor.height), Number(anchor.radius));
  ctx.fillStyle = "#050509";
  ctx.fill();
  ctx.lineWidth = Number(anchor.strokeWidth);
  ctx.strokeStyle = "#171122";
  ctx.stroke();
  ctx.font = `700 ${Number(anchor.textSize)}px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, node.x + Number(anchor.textOffsetX), node.y + Number(anchor.textOffsetY));
  ctx.restore();
}

function getCurrencyLabelMetrics(ctx, entries, localization = null, anchor = null) {
  if (!entries.length) return { width: 0, height: 0, scale: getLabelScale(anchor), font: NODE_LABEL_FONT, fontSize: 0, segments: [] };
  const scale = getLabelScale(anchor);
  const fontSize = 14.5 * scale;
  const font = `800 ${fontSize}px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif`;
  ctx.save();
  ctx.font = font;
  const segments = entries.map((entry) => {
    const text = Number(entry.value || 0).toLocaleString(localization?.getIntlLocale?.() || "zh-TW");
    return { ...entry, text, textWidth: getTextMetrics(ctx, text) };
  });
  const iconAdvance = 23 * scale;
  const segmentGap = 6 * scale;
  const iconSize = 18 * scale;
  let cursor = 0;
  let contentLeft = Infinity;
  let contentRight = -Infinity;
  for (const entry of segments) {
    const spriteBox = CURRENCY_SPRITE_BOXES[entry.kind] || CURRENCY_SPRITE_BOXES.core;
    const iconLeft = cursor + spriteBox.x * iconSize;
    const iconRight = iconLeft + spriteBox.width * iconSize;
    const textLeft = cursor + iconAdvance;
    const textRight = textLeft + entry.textWidth;
    contentLeft = Math.min(contentLeft, iconLeft, textLeft);
    contentRight = Math.max(contentRight, iconRight, textRight);
    cursor = textRight + segmentGap;
  }
  const width = Math.max(
    Number(anchor?.width) > 0 ? Number(anchor.width) : 0,
    76 * scale,
    segments.reduce((sum, entry) => sum + iconAdvance + entry.textWidth + 12 * scale, 0)
      + Math.max(0, segments.length - 1) * segmentGap
  );
  const height = Math.max(
    Number(anchor?.height) > 0 ? Number(anchor.height) : 0,
    28 * scale,
    fontSize + 8 * scale
  );
  ctx.restore();
  return {
    width,
    height,
    scale,
    font,
    fontSize,
    segments,
    // Keep the complete icon/text group centered inside the badge. The old
    // left-padding cursor used the badge's left edge, so wider anchors pushed
    // the content visibly off-center.
    contentWidth: Math.max(0, contentRight - contentLeft),
    contentCenter: Number.isFinite(contentLeft) && Number.isFinite(contentRight)
      ? (contentLeft + contentRight) / 2
      : 0
  };
}

function getCurrencyLabelWidth(ctx, entries, localization = null, anchor = null) {
  return getCurrencyLabelMetrics(ctx, entries, localization, anchor).width || 0;
}

function drawCurrencyLabel(ctx, entries, x, y, localization = null, anchor = null, precomputedMetrics = null) {
  if (!entries.length) return;
  const metrics = precomputedMetrics || getCurrencyLabelMetrics(ctx, entries, localization, anchor);
  const segments = metrics.segments || entries.map((entry) => ({
    ...entry,
    text: Number(entry.value || 0).toLocaleString(localization?.getIntlLocale?.() || "zh-TW")
  }));
  const { width, height, scale } = metrics;
  const left = x - width / 2;
  roundedRect(ctx, left, y, width, height, height / 2);
  ctx.fillStyle = "rgba(27,21,40,.94)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#5a3fa2";
  ctx.stroke();
  ctx.font = metrics.font || NODE_LABEL_FONT;
  const iconSize = 18 * scale;
  const contentCenter = Number.isFinite(Number(metrics.contentCenter))
    ? Number(metrics.contentCenter)
    : width / 2 - 10 * scale;
  let cursor = x - contentCenter;
  for (const entry of segments) {
    if (entry.image) {
      const spriteBox = CURRENCY_SPRITE_BOXES[entry.kind] || CURRENCY_SPRITE_BOXES.core;
      ctx.drawImage(
        entry.image,
        cursor + spriteBox.x * iconSize,
        y + 5 * scale + spriteBox.y * iconSize,
        spriteBox.width * iconSize,
        spriteBox.height * iconSize
      );
    }
    cursor += 23 * scale;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(entry.text, cursor, y + height / 2 + 0.5 * scale);
    cursor += getTextMetrics(ctx, entry.text) + 6 * scale;
  }
}

function getAnchoredLabelMetrics(ctx, text, anchor = null) {
  const scale = getLabelScale(anchor);
  const fontSize = 14.5 * scale;
  const font = `800 ${fontSize}px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif`;
  ctx.save();
  ctx.font = font;
  const width = Math.max(
    Number(anchor?.width) > 0 ? Number(anchor.width) : 0,
    76 * scale,
    getTextMetrics(ctx, text) + 28 * scale
  );
  const height = Math.max(
    Number(anchor?.height) > 0 ? Number(anchor.height) : 0,
    28 * scale,
    fontSize + 8 * scale
  );
  ctx.restore();
  return { width, height, scale, font, fontSize };
}

function makeLabelRect(x, y, width, height) {
  return {
    left: x - width / 2,
    top: y,
    right: x + width / 2,
    bottom: y + height,
    x,
    y,
    width,
    height
  };
}

function rectanglesOverlap(left, right, gap = 0) {
  return left.left < right.right + gap
    && left.right > right.left - gap
    && left.top < right.bottom + gap
    && left.bottom > right.top - gap;
}

function addUniqueLabelPosition(positions, x, y) {
  const key = `${Math.round(x * 100) / 100}:${Math.round(y * 100) / 100}`;
  if (!positions.some((position) => position.key === key)) positions.push({ key, x, y });
}

function makeCurrencyLabelCandidate(ctx, node, localization, currencyImages) {
  const special = getUnlockConditionLabel(node.node);
  const entries = special ? [] : getCurrencyEntries(node, currencyImages);
  if (!special && entries.length === 0) return null;
  const metrics = special
    ? getAnchoredLabelMetrics(ctx, special, node.labelAnchor)
    : getCurrencyLabelMetrics(ctx, entries, localization, node.labelAnchor);
  return {
    id: String(node.id),
    node,
    kind: special ? "special" : "currency",
    metrics,
    baseX: getNodeLabelCenterX(node),
    baseY: getNodeLabelTop(node)
  };
}

function chooseCurrencyLabelPosition(candidate, placed, gap) {
  const { width, height } = candidate.metrics;
  const positions = [];
  addUniqueLabelPosition(positions, candidate.baseX, candidate.baseY);
  const verticalStep = height + gap;
  for (let lane = 1; lane <= 4; lane += 1) {
    addUniqueLabelPosition(positions, candidate.baseX, candidate.baseY - verticalStep * lane);
    addUniqueLabelPosition(positions, candidate.baseX, candidate.baseY + verticalStep * lane);
  }
  const horizontalShift = Math.min(24, Math.max(10, width * 0.18));
  for (const dx of [-horizontalShift, horizontalShift]) {
    addUniqueLabelPosition(positions, candidate.baseX + dx, candidate.baseY);
    addUniqueLabelPosition(positions, candidate.baseX + dx, candidate.baseY - verticalStep);
    addUniqueLabelPosition(positions, candidate.baseX + dx, candidate.baseY + verticalStep);
  }
  return positions.find((position) => {
    const rect = makeLabelRect(position.x, position.y, width, height);
    return !placed.some((entry) => rectanglesOverlap(rect, entry.rect, gap));
  }) || positions[0];
}

/**
 * Lay out the dynamic unlock badges in world space before painting them.
 * Canonical SVG badges are intentionally compact, but several adjacent nodes
 * share a row. Keep the badge attached to its own node and use short vertical
 * lanes for collisions; moving a badge across an unrelated node makes the
 * map harder to read than a compact local stack.
 */
export function buildCurrencyLabelLayout(ctx, nodes, localization = null, currencyImages = null) {
  const layout = new Map();
  if (!ctx || !Array.isArray(nodes) || nodes.length === 0) return layout;

  const candidates = [];
  for (const node of nodes) {
    const candidate = makeCurrencyLabelCandidate(ctx, node, localization, currencyImages);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((left, right) => left.baseY - right.baseY
    || left.baseX - right.baseX
    || left.id.localeCompare(right.id));
  const placed = [];
  const gap = 6;

  for (const candidate of candidates) {
    const { width, height } = candidate.metrics;
    const chosen = chooseCurrencyLabelPosition(candidate, placed, gap);
    const rect = makeLabelRect(chosen.x, chosen.y, width, height);
    placed.push({ id: candidate.id, rect });
    layout.set(candidate.id, {
      x: chosen.x,
      y: chosen.y,
      width,
      height,
      scale: candidate.metrics.scale,
      kind: candidate.kind,
      metrics: candidate.metrics
    });
  }
  return layout;
}

function drawNodeRing(ctx, node, color) {
  const { x, y, geometry } = node;
  const visualScale = NODE_VISUAL_SCALE[geometry.shape] || 1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  if (geometry.shape === "dice") {
    roundedRect(ctx, x - 68 * visualScale, y - 71 * visualScale, 136 * visualScale, 142 * visualScale, 17 * visualScale);
  } else if (geometry.shape === "perk") {
    roundedRect(ctx, x - 69 * visualScale, y - 39 * visualScale, 138 * visualScale, 78 * visualScale, 15 * visualScale);
  } else if (geometry.shape === "large-passive") {
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    roundedRect(ctx, -50 * visualScale, -50 * visualScale, 100 * visualScale, 100 * visualScale, 21 * visualScale);
  } else {
    ctx.beginPath();
    const isRune = geometry.shape === "rune";
    ctx.arc(x, y + (isRune ? 4 * visualScale : 0), (isRune ? 42.5 : 47) * visualScale, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function appendNodeOcclusionPath(ctx, node) {
  const { x, y, geometry } = node;
  const mask = getNodeOcclusionGeometry(geometry.shape);
  if (mask.kind === "roundedRect") {
    appendRoundedRectPath(ctx, x + mask.x, y + mask.y, mask.width, mask.height, mask.radius);
    ctx.closePath();
  } else if (mask.kind === "rotatedRoundedRect") {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    appendRoundedRectPath(ctx, -mask.size / 2, -mask.size / 2, mask.size, mask.size, mask.radius);
    ctx.closePath();
    ctx.restore();
  } else if (mask.kind === "ellipse") {
    ctx.ellipse(x + mask.x, y + mask.y, mask.radiusX, mask.radiusY, 0, 0, Math.PI * 2);
    ctx.closePath();
  } else {
    ctx.arc(x, y, mask.radius, 0, Math.PI * 2);
    ctx.closePath();
  }
}

function drawNodeOcclusion(ctx, node) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  appendNodeOcclusionPath(ctx, node);
  ctx.fillStyle = SIMULATION_OCCLUSION_FILL;
  ctx.fill();
  ctx.restore();
}

function traceSelectionRing(ctx, node) {
  const { x, y, geometry } = node;
  const visualScale = NODE_VISUAL_SCALE[geometry.shape] || 1;
  if (geometry.shape === "dice") {
    const width = 136 * visualScale;
    const height = 142 * visualScale;
    const radius = 17 * visualScale;
    roundedRect(ctx, x - width / 2, y - height / 2, width, height, radius);
    const perimeter = 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
    const dashLength = 80 * visualScale;
    return { dash: [dashLength, Math.max(1, perimeter / 2 - dashLength), dashLength, Math.max(1, perimeter / 2 - dashLength)], pathLength: perimeter, animated: true };
  }
  if (geometry.shape === "perk") {
    const width = 138 * visualScale;
    const height = 78 * visualScale;
    const radius = 15 * visualScale;
    roundedRect(ctx, x - width / 2, y - height / 2, width, height, radius);
    const perimeter = 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
    const dashLength = 65 * visualScale;
    return { dash: [dashLength, Math.max(1, perimeter / 2 - dashLength), dashLength, Math.max(1, perimeter / 2 - dashLength)], pathLength: perimeter, animated: true };
  }
  if (geometry.shape === "large-passive") {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    roundedRect(ctx, -50 * visualScale, -50 * visualScale, 100 * visualScale, 100 * visualScale, 21 * visualScale);
    ctx.restore();
    return { dash: [], pathLength: 0, animated: false };
  }
  const isRune = geometry.shape === "rune";
  const radius = (isRune ? 42.5 : 47) * visualScale;
  const centerY = isRune ? 4 * visualScale : 0;
  ctx.beginPath();
  ctx.arc(x, y + centerY, radius, 0, Math.PI * 2);
  const perimeter = 2 * Math.PI * radius;
  const dashLength = (isRune ? 45 : 50) * visualScale;
  const dashGap = Math.max(1, perimeter / 2 - dashLength);
  return { dash: [dashLength, dashGap, dashLength, dashGap], pathLength: perimeter, animated: true };
}

function drawSelectionRunner(ctx, node, colors, phase = 0) {
  const selection = traceSelectionRing(ctx, node);
  if (!selection.animated) return;
  ctx.save();
  ctx.strokeStyle = colors.runner;
  ctx.lineWidth = 3.8;
  ctx.lineCap = "round";
  ctx.shadowColor = colors.runner;
  ctx.shadowBlur = 8;
  ctx.setLineDash(selection.dash);
  ctx.lineDashOffset = -(phase % 1) * selection.pathLength;
  ctx.stroke();
  ctx.restore();
}

function drawCenterStats(ctx, model, localization) {
  for (let branch = 1; branch <= 5; branch += 1) {
    const point = CENTER_STATS[branch];
    const color = COLORS[branch] || COLORS[1];
    const fallback = ["自然", "工學", "魔法", "秩序", "渾沌"][branch - 1];
    const name = localization?.t?.(`faction.${branch}`, {}, fallback) || fallback;
    ctx.font = "700 16px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color.base;
    ctx.strokeStyle = "#302944";
    ctx.lineWidth = 1.2;
    ctx.strokeText(name, point.x, point.nameY);
    ctx.fillText(name, point.x, point.nameY);
    ctx.font = "800 44px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif";
    const value = String(model.factionLevels?.[branch] ?? 0);
    ctx.lineWidth = 2.6;
    ctx.strokeText(value, point.x, point.valueY);
    ctx.fillText(value, point.x, point.valueY);
  }
}

function drawCenterTitle(ctx, model, localization) {
  const title = localization?.t?.(
    model?.isSimulation ? "compendium.simulationCenterTitle" : "compendium.centerTitle",
    {},
    model?.isSimulation ? "Dice tree" : "Compendium"
  ) || (model?.isSimulation ? "Dice tree" : "Compendium");
  ctx.save();
  ctx.font = "800 18px 'Noto Sans TC','Microsoft JhengHei UI','Segoe UI',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#302944";
  ctx.lineWidth = 1.2;
  ctx.strokeText(title, 2000, 1735);
  ctx.fillText(title, 2000, 1735);
  ctx.restore();
}

function isActiveEdge(edge, model) {
  return Boolean(edge && model && (
    edge.isActive
    || (model.hasFilter && edge.isFilterActive)
    || (model.isSimulation && edge.isSimulationActive)
  ));
}

function isActiveCenterLink(link, model) {
  return Boolean(link && model && (
    link.isActive
    || (model.hasFilter && link.isFilterActive)
    || (model.hasPrereqHighlight && link.isPrereqActive)
  ));
}

function hasActiveEdgeVisual(model) {
  return Boolean(
    (model?.edges || []).some((edge) => isActiveEdge(edge, model))
    || (model?.centerLinks || []).some((link) => isActiveCenterLink(link, model))
  );
}

function getActiveEdgeStyle(item, model, isCenterLink = false) {
  let color = "#fff";
  if (!isCenterLink && item.isSimulationActive && model.isSimulation) color = "#d7b9ff";
  const width = model.hasFilter || model.hasPrereqHighlight ? 4 : 3.5;
  const alpha = item.isDimmed ? 0.18 : 0.96;
  return { color, width, alpha };
}

function addActiveEdgeGroup(groups, item, model, from, to, isCenterLink = false) {
  const style = getActiveEdgeStyle(item, model, isCenterLink);
  const key = `${style.color}|${style.width}|${style.alpha}`;
  const group = groups.get(key) || { style, edges: [] };
  group.edges.push({ from, to });
  groups.set(key, group);
}

function collectActiveEdgeGroups(model, skipDimmed) {
  const groups = new Map();
  for (const edge of model.edges || []) {
    if (!isActiveEdge(edge, model) || (skipDimmed && edge.isDimmed)) continue;
    addActiveEdgeGroup(groups, edge, model, edge.fromNode?.position, edge.toNode?.position);
  }
  for (const link of model.centerLinks || []) {
    if (!isActiveCenterLink(link, model) || (skipDimmed && link.isDimmed)) continue;
    addActiveEdgeGroup(groups, link, model, link.from, link.to, true);
  }
  return groups;
}

function drawActiveEdgeGroup(ctx, { style, edges }) {
  ctx.beginPath();
  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!from || !to) continue;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.globalAlpha = style.alpha;
  ctx.shadowColor = "rgba(205,164,255,.6)";
  ctx.shadowBlur = 5;
  ctx.stroke();
}

function drawActiveEdges(ctx, model, { skipDimmed = false } = {}) {
  if (!ctx || !model) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  const groups = collectActiveEdgeGroups(model, skipDimmed);
  for (const group of groups.values()) drawActiveEdgeGroup(ctx, group);
  ctx.restore();
}

function getActiveEdgeStrokeWidth(model) {
  return model.hasFilter || model.hasPrereqHighlight ? 4 : 3.5;
}

function collectBrightActiveEdges(model) {
  const edges = (model?.edges || []).filter((edge) => (
    isActiveEdge(edge, model)
    && !edge.isDimmed
    && edge.fromNode?.position
    && edge.toNode?.position
  ));
  const centerLinks = (model?.centerLinks || []).filter((link) => (
    isActiveCenterLink(link, model)
    && !link.isDimmed
    && link.from
    && link.to
  ));
  return { edges, centerLinks };
}

function countBrightActiveEdges(model) {
  const { edges, centerLinks } = collectBrightActiveEdges(model);
  return edges.length + centerLinks.length;
}

function drawFullMapEdgeCutouts(context, model) {
  const { edges, centerLinks } = collectBrightActiveEdges(model);
  if (edges.length === 0 && centerLinks.length === 0) return;
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "#000";
  context.lineWidth = getActiveEdgeStrokeWidth(model) + 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  for (const edge of edges) {
    context.moveTo(edge.fromNode.position.x, edge.fromNode.position.y);
    context.lineTo(edge.toNode.position.x, edge.toNode.position.y);
  }
  for (const link of centerLinks) {
    context.moveTo(link.from.x, link.from.y);
    context.lineTo(link.to.x, link.to.y);
  }
  context.stroke();
  context.restore();
}

function drawRasterTiles(context, entries, images, tileSize, bounds) {
  if (!context) throw new Error("Canvas raster context is unavailable.");
  const tiles = (entries || []).map((entry) => ({
    entry,
    image: images.get(String(entry.path))
  }));
  if (tiles.some(({ image }) => !image)) {
    throw new Error("Visible map raster is unavailable.");
  }

  // Paint the complete static portion into the same candidate surface as the
  // nodes and labels. Separate DOM Canvas surfaces can be uploaded by the
  // compositor in different frames, which is the source of the temporary
  // line-only / missing-corner presentation seen during a tile change.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (bounds?.width > 0 && bounds?.height > 0) {
    // Static tiles contain transparent pixels around the SVG paths. Precompose
    // them against the page surface so translating the root cannot make line
    // antialiasing blend a second time with the overview or frame mask.
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.fillStyle = SIMULATION_OCCLUSION_FILL;
    context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    context.restore();
  }
  for (const { entry, image } of tiles) {
    const width = Math.max(1, Number(entry.width || tileSize));
    const height = Math.max(1, Number(entry.height || tileSize));
    context.drawImage(
      image,
      Number(entry.column || 0) * tileSize,
      Number(entry.row || 0) * tileSize,
      width,
      height
    );
  }
}

function getStaticEdgeOpacity(model) {
  const focused = model?.hasFilter || model?.hasSelection || model?.hasPrereqHighlight;
  if (model?.isSimulation) return 0.14;
  if (focused) return 0.18;
  return 1;
}

function shouldUseFullMapEdgeDimMask(model) {
  return getStaticEdgeOpacity(model) < 1;
}

function resolveDevicePixelRatio(explicit, value) {
  if (explicit) return Number(value) || 1;
  if (typeof window !== "undefined") return window.devicePixelRatio || 1;
  return 1;
}

function areViewportScalesEqual(request, currentState) {
  const requestedScale = Number(request?.state?.viewport?.scale);
  const currentScale = Number(currentState?.viewport?.scale);
  return Number.isFinite(requestedScale)
    && Number.isFinite(currentScale)
    && Math.abs(requestedScale - currentScale) <= 0.0005;
}

function drawEdgeComposite(
  context,
  entries,
  images,
  tileSize,
  bounds,
  model,
  { useFullMapEdgeDimMask = false, drawActiveEdgeLayer = true } = {}
) {
  drawRasterTiles(context, entries, images, tileSize, bounds);
  const baseOpacity = useFullMapEdgeDimMask ? 1 : getStaticEdgeOpacity(model);
  if (baseOpacity < 1 && bounds?.width > 0 && bounds?.height > 0) {
    context.save();
    context.globalAlpha = 1 - baseOpacity;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = SIMULATION_OCCLUSION_FILL;
    context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    context.restore();
  }
  if (drawActiveEdgeLayer) {
    // When the fixed full-map veil is present, dimmed active paths are already
    // represented by the normal raster underneath it. Repainting them here
    // would apply the veil twice. Bright active paths remain crisp and are
    // uncovered by the mask's destination-out holes.
    drawActiveEdges(context, model, { skipDimmed: useFullMapEdgeDimMask });
  }
}

export class CanvasTreeRenderer {
  constructor({ store = null, tileRepository = null, devicePixelRatio = null, onReady = null, onError = null } = {}) {
    this.store = store;
    this.tileRepository = tileRepository;
    this._devicePixelRatioExplicit = devicePixelRatio !== null && devicePixelRatio !== undefined;
    this.devicePixelRatio = resolveDevicePixelRatio(this._devicePixelRatioExplicit, devicePixelRatio);
    this.onReady = onReady;
    this.onError = onError;
    this.appShell = null;
    this.scene = null;
    this.treeData = null;
    this.renderManifest = null;
    this.localization = null;
    this.model = null;
    this.lastState = null;
    this.layers = {};
    this.semanticButtons = new Map();
    this.atlasImages = new Map();
    this.atlasImagePaths = new Map();
    this.centerImages = new Map();
    this.currencyImages = new Map();
    this.visibleTileCanvases = new Map();
    this.tileLayer = null;
    this.overviewCanvas = null;
    this.overviewContext = null;
    this.overviewEdgeCanvas = null;
    this.overviewEdgeContext = null;
    this.overviewNodeArtCanvas = null;
    this.overviewNodeArtContext = null;
    this.overviewDynamicCanvas = null;
    this.overviewDynamicContext = null;
    this._overviewNodeArtModel = null;
    this._overviewNodeArtSignature = "";
    this._overviewSignature = "";
    this._overviewCompatibility = "";
    this._overviewBuildPromise = null;
    this._overviewBuildToken = 0;
    this._overviewNodeArtRefreshToken = 0;
    this._overviewNodeArtRefreshPromise = null;
    this.staticCanvas = null;
    this.staticContext = null;
    this.nodeArtCanvas = null;
    this.nodeArtContext = null;
    this._nodeArtModel = null;
    this.fullMapDimMaskCanvas = null;
    this.fullMapDimMaskContext = null;
    this._fullMapDimMaskModel = null;
    this._fullMapDimMaskSignature = "";
    this._fullMapDimMaskActive = false;
    this._fullMapDimMaskNodes = [];
    this.fullMapEdgeDimMaskCanvas = null;
    this.fullMapEdgeDimMaskContext = null;
    this._fullMapEdgeDimMaskModel = null;
    this._fullMapEdgeDimMaskSignature = "";
    this._fullMapEdgeDimMaskActive = false;
    this.dynamicCanvas = null;
    this.dynamicContext = null;
    this.nodeCanvas = null;
    this.nodeContext = null;
    this.activeEdgeCanvas = null;
    this.activeEdgeContext = null;
    this.centerCanvas = null;
    this.centerContext = null;
    this.centerStatsCanvas = null;
    this.centerStatsContext = null;
    this.stateCanvas = null;
    this.stateContext = null;
    this.selectionCanvas = null;
    this.selectionContext = null;
    this.selectionAnimationCanvas = null;
    this.selectionAnimationContext = null;
    this._selectionAnimationBounds = null;
    this._selectionAnimationScale = 1;
    this._selectionFrame = null;
    this._selectionPhase = 0;
    this._selectionStartTimestamp = null;
    this._selectionAnimating = false;
    this._pressedNodeId = null;
    this.currentResolution = 1;
    this.desiredResolution = 1;
    this._renderBounds = null;
    this._renderBoundsKey = "";
    this._staticFrameKey = "";
    this._nodeArtKey = "";
    this._renderedTileKey = "";
    this._renderedVisibleTileKey = "";
    this._sceneRevision = 0;
    this._renderEpoch = 0;
    this._viewportRevision = 0;
    this._sceneFramePromise = null;
    this._sceneQueuedRequest = null;
    this._prefetchKeys = new Set();
    this._coverageWarmupScheduled = false;
    this._coverageWarmupHandle = null;
    this._motionWarmKey = "";
    this._motionPrefetchKey = "";
    this._resolutionWarmupHandle = null;
    this._resolutionWarmupToken = 0;
    this._resolutionWarmupKey = "";
    this._backgroundRendersPaused = false;
    this._atlasTrimHandle = null;
    this._atlasTrimRequest = null;
    this._sceneFrameModel = null;
    this._sceneFrameState = null;
    this._sceneFrameOptions = null;
    this._sceneFrameResolution = 0;
    this._sceneFrameCoverage = null;
    this._sceneFrameRenderEntries = [];
    this._stateNodeArtRefreshToken = 0;
    this._stateNodeArtRefreshPromise = null;
    this._readyPromise = null;
    this._initialAssetsReady = false;
    this._fontRasterReady = false;
    this._pendingInitialRender = null;
    this._destroyed = false;
    this._initializationToken = 0;
    this._renderError = null;
    this._warmSceneKeys = new Set();
    this._onSemanticPointerDown = new Map();
    this._boundViewportInteractionStart = () => {
      // A real pointer/wheel sequence has priority over detached work. Keep
      // the already committed frame on screen, but invalidate a candidate that
      // could otherwise finish an atlas upload on the first gesture frame.
      this.pauseBackgroundRenders({ pauseWarmups: true });
    };
  }

  init({ container, treeData, renderManifest, localization } = {}) {
    if (this._readyPromise !== null) return this._readyPromise;
    this._destroyed = false;
    const token = ++this._initializationToken;
    this.scene = container;
    this.treeData = treeData || { nodes: [], edges: [] };
    this.renderManifest = renderManifest;
    this.localization = localization || null;
    if (this.renderManifest) {
      this.tileRepository.manifest = this.renderManifest;
      this._createLayers();
      this._createSemanticButtons();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("rd2:viewport-interaction-start", this._boundViewportInteractionStart);
    }
    this._readyPromise = this._initialize(token);
    return this._readyPromise;
  }

  async _initialize(token) {
    if (!isElement(this.scene)) throw new Error("Canvas map container is unavailable.");
    if (!this.tileRepository) throw new Error("Canvas map tile repository is unavailable.");
    await this.tileRepository.loadManifest();
    if (this._destroyed || token !== this._initializationToken) return this;
    this.renderManifest = this.tileRepository.manifest;
    if (!this.renderManifest?.viewBox || !Array.isArray(this.renderManifest.nodes)) {
      throw new Error("Canvas map render manifest is invalid.");
    }
    if (!this.layers.frame) this._createLayers();
    if (!this.semanticButtons.size) this._createSemanticButtons();
    const state = this.store?.getState?.() || { viewport: { scale: 1, x: 0, y: 0 } };
    this.desiredResolution = this._resolveResolution(state);
    this.currentResolution = this.desiredResolution;
    this.model = this._buildModel(state);
    this._renderFullMapDimMask(this.model);
    this._renderFullMapEdgeDimMask(this.model);
    const initialBounds = this._getDynamicRenderBounds(state);
    const fontWarmup = warmCanvasFonts();
    await Promise.all([
      this._ensureAtlases(this.currentResolution, this._requiredVariants(this.model), this.model, initialBounds),
      this._ensureCenterImages(this.currentResolution, [this.model.isSimulation ? "simulation" : "normal"]),
      this._ensureCurrencyImages(),
      this._buildOverview(this.model, state)
    ]);
    if (this._destroyed || token !== this._initializationToken) return this;
    this._initialAssetsReady = true;
    fontWarmup.then(() => {
      if (this._destroyed || token !== this._initializationToken || this._fontRasterReady) return;
      this._fontRasterReady = true;
      if (!this.lastState) return;
      this._sceneRevision += 1;
      this._scheduleSceneFrame(this.lastState, { force: true, reason: "font" })
        .catch((error) => this._setRenderError(error));
    }).catch(() => undefined);
    const pending = this._pendingInitialRender;
    this._pendingInitialRender = null;
    const initialState = pending?.state || state;
    this.render(initialState, pending?.action || null);
    await this._sceneFramePromise;
    if (this._destroyed || token !== this._initializationToken) return this;
    if (this.scene.dataset.canvasReady !== "true") throw new Error("Canvas map initial frame was not committed.");
    this.onReady?.(this);
    return this;
  }

  _createLayers() {
    if (this.layers.frame) return;
    const ownerDocument = this.scene.ownerDocument || document;
    this.appShell = this.scene.closest?.(".app-shell") || null;
    this.appShell?.classList?.add("canvas-map-mode");
    this.scene.classList?.add("canvas-map-scene");
    // The viewport controller may have applied its first root transform
    // before the Canvas layers existed. Clear that large-surface transform
    // immediately; the single render root below is seeded with the current
    // camera and kept in sync by the next viewport RAF.
    if (this.scene.style) {
      this.scene.style.transform = "none";
    }
    this.scene.setAttribute?.("aria-label", this.localization?.t?.("map.label", {}, "Interactive dice tree") || "Interactive dice tree");
    const renderRoot = ownerDocument.createElement("div");
    renderRoot.className = "tree-render-root";
    renderRoot.setAttribute("aria-hidden", "true");
    renderRoot.style.width = `${this.renderManifest.viewBox.width}px`;
    renderRoot.style.height = `${this.renderManifest.viewBox.height}px`;
    renderRoot.style.left = "0";
    renderRoot.style.top = "0";
    this.layers.root = renderRoot;
    this.scene.appendChild(renderRoot);
    const makeLayer = (className, hidden = false) => {
      const layer = ownerDocument.createElement("div");
      layer.className = `tree-canvas-layer ${className}`;
      layer.setAttribute("aria-hidden", "true");
      layer.style.width = `${this.renderManifest.viewBox.width}px`;
      layer.style.height = `${this.renderManifest.viewBox.height}px`;
      layer.style.left = "0";
      layer.style.top = "0";
      if (hidden) layer.style.display = "none";
      renderRoot.appendChild(layer);
      return layer;
    };

    this.layers.edge = makeLayer("tree-edge-canvas");
    // Keep stable compatibility markers for diagnostics and old integrations.
    // They contain no canvas and are never painted.
    this.layers.activeEdge = makeLayer("tree-active-edge-canvas", true);
    this.layers.center = makeLayer("tree-center-canvas", true);
    this.layers.centerStats = makeLayer("tree-center-stats-canvas", true);
    this.layers.node = makeLayer("tree-node-canvas", true);
    this.layers.nodeOcclusion = makeLayer("tree-node-occlusion-canvas", true);
    this.layers.state = makeLayer("tree-state-canvas", true);
    this.layers.labels = makeLayer("tree-state-label-canvas", true);
    this.layers.selection = makeLayer("tree-selection-canvas", true);

    this.layers.frame = makeLayer("tree-frame-canvas");
    this.overviewCanvas = ownerDocument.createElement("canvas");
    this.overviewCanvas.className = "tree-overview-surface";
    this.overviewCanvas.setAttribute("aria-hidden", "true");
    this.overviewCanvas.style.left = "0px";
    this.overviewCanvas.style.top = "0px";
    this.overviewCanvas.style.width = `${this.renderManifest.viewBox.width}px`;
    this.overviewCanvas.style.height = `${this.renderManifest.viewBox.height}px`;
    this.overviewCanvas.width = 1;
    this.overviewCanvas.height = 1;
    this.overviewCanvas.dataset.canvasReady = "false";
    this.overviewContext = getCanvas2DContext(this.overviewCanvas);
    if (!this.overviewContext) throw new Error("Canvas overview context is unavailable.");
    const frameHost = ownerDocument.createElement("div");
    frameHost.className = "tree-frame-surface";
    frameHost.setAttribute("aria-hidden", "true");
    this.layers.frame.appendChild(frameHost);
    this.layers.frameHost = frameHost;
    // Keep continuity content, the bounded candidate, and both fixed masks in
    // one stacking context. A sibling overview is not covered by the masks
    // when the camera leaves the committed candidate, so the moving viewport
    // briefly presents a different dimming composition than the settled one.
    frameHost.appendChild(this.overviewCanvas);
    const makeOverviewPlaceholder = (className, surface) => {
      const canvas = ownerDocument.createElement("canvas");
      canvas.className = className;
      canvas.setAttribute("aria-hidden", "true");
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.width = `${this.renderManifest.viewBox.width}px`;
      canvas.style.height = `${this.renderManifest.viewBox.height}px`;
      canvas.style.visibility = "hidden";
      canvas.dataset.canvasReady = "false";
      canvas.dataset.continuity = "full-map";
      canvas.dataset.surface = surface;
      const context = getCanvas2DContext(canvas);
      if (!context) throw new Error(`${surface} overview context is unavailable.`);
      frameHost.appendChild(canvas);
      return { canvas, context };
    };
    const overviewEdge = makeOverviewPlaceholder("tree-overview-edge-surface", "edge");
    this.overviewEdgeCanvas = overviewEdge.canvas;
    this.overviewEdgeContext = overviewEdge.context;
    const overviewNodeArt = makeOverviewPlaceholder("tree-overview-node-art-surface", "node-art");
    this.overviewNodeArtCanvas = overviewNodeArt.canvas;
    this.overviewNodeArtContext = overviewNodeArt.context;
    const overviewDynamic = makeOverviewPlaceholder("tree-overview-dynamic-surface", "dynamic");
    this.overviewDynamicCanvas = overviewDynamic.canvas;
    this.overviewDynamicContext = overviewDynamic.context;
    this.fullMapDimMaskCanvas = ownerDocument.createElement("canvas");
    this.fullMapDimMaskCanvas.className = "tree-full-dim-mask-surface";
    this.fullMapDimMaskCanvas.setAttribute("aria-hidden", "true");
    this.fullMapDimMaskCanvas.dataset.canvasReady = "false";
    this.fullMapDimMaskCanvas.dataset.renderBounds = "full-map";
    this.fullMapDimMaskContext = getCanvas2DContext(this.fullMapDimMaskCanvas);
    if (!this.fullMapDimMaskContext) throw new Error("Canvas full-map dim mask context is unavailable.");
    this._configureFullMapDimMaskCanvas(this.fullMapDimMaskCanvas, this.fullMapDimMaskContext);
    this.fullMapDimMaskCanvas.style.visibility = "hidden";
    frameHost.appendChild(this.fullMapDimMaskCanvas);
    this.fullMapEdgeDimMaskCanvas = ownerDocument.createElement("canvas");
    this.fullMapEdgeDimMaskCanvas.className = "tree-full-edge-dim-mask-surface";
    this.fullMapEdgeDimMaskCanvas.setAttribute("aria-hidden", "true");
    this.fullMapEdgeDimMaskCanvas.dataset.canvasReady = "false";
    this.fullMapEdgeDimMaskCanvas.dataset.active = "false";
    this.fullMapEdgeDimMaskCanvas.dataset.renderBounds = "full-map";
    this.fullMapEdgeDimMaskContext = getCanvas2DContext(this.fullMapEdgeDimMaskCanvas);
    if (!this.fullMapEdgeDimMaskContext) throw new Error("Canvas full-map edge dim mask context is unavailable.");
    // Keep the inactive mask at a 1x1 backing store. It still has full-map
    // world geometry in CSS, but does not reserve another full-map raster on
    // every normal-mode page load; the 0.25x bitmap is allocated only when a
    // state actually needs edge dimming.
    this._configureFullMapEdgeDimMaskCanvas(
      this.fullMapEdgeDimMaskCanvas,
      this.fullMapEdgeDimMaskContext,
      { allocate: false }
    );
    this.fullMapEdgeDimMaskCanvas.style.visibility = "hidden";
    frameHost.appendChild(this.fullMapEdgeDimMaskCanvas);
    // Active edges use a transparent foreground surface. The base raster stays
    // immutable when filters or prerequisite state change, so those updates
    // do not synchronously redraw every visible tile before the next RAF.
    this.activeEdgeCanvas = null;
    this.activeEdgeContext = null;
    this.dynamicCanvas = ownerDocument.createElement("canvas");
    this.dynamicCanvas.className = "tree-dynamic-surface tree-center-surface tree-center-stats-surface tree-node-surface tree-state-surface tree-selection-surface";
    this.dynamicCanvas.width = 1;
    this.dynamicCanvas.height = 1;
    this.dynamicCanvas.style.width = `${this.renderManifest.viewBox.width}px`;
    this.dynamicCanvas.style.height = `${this.renderManifest.viewBox.height}px`;
    this.dynamicCanvas.setAttribute("aria-hidden", "true");
    this.dynamicCanvas.dataset.canvasReady = "false";
    frameHost.appendChild(this.dynamicCanvas);
    this.dynamicContext = getCanvas2DContext(this.dynamicCanvas);
    if (!this.dynamicContext) throw new Error("Canvas 2D context is unavailable.");
    this._setCanvasAliases(this.dynamicCanvas, this.dynamicContext);

    this.layers.selectionAnimation = makeLayer("tree-selection-animation-canvas");
    this.layers.semantic = ownerDocument.createElement("div");
    this.layers.semantic.className = "tree-semantic-layer";
    this.layers.semantic.setAttribute("role", "group");
    this.layers.semantic.setAttribute("aria-label", this.localization?.t?.("map.controls", {}, "Dice tree nodes") || "Dice tree nodes");
    this.layers.semantic.style.width = `${this.renderManifest.viewBox.width}px`;
    this.layers.semantic.style.height = `${this.renderManifest.viewBox.height}px`;
    renderRoot.appendChild(this.layers.semantic);
    const viewport = this.store?.getState?.()?.viewport || {};
    const cameraTransform = `translate(${Number(viewport.x) || 0}px, ${Number(viewport.y) || 0}px) scale(${Number(viewport.scale) || 1})`;
    renderRoot.style.transform = cameraTransform;
  }

  _setCanvasAliases(canvas, context, activeEdgeCanvas = null, activeEdgeContext = null) {
    this.dynamicCanvas = canvas;
    this.dynamicContext = context;
    this.nodeCanvas = canvas;
    this.nodeContext = context;
    if (activeEdgeCanvas) {
      this.activeEdgeCanvas = activeEdgeCanvas;
      this.activeEdgeContext = activeEdgeContext || getCanvas2DContext(activeEdgeCanvas);
    } else if (!this.activeEdgeCanvas) {
      // Before the first committed frame there is no static surface yet. The
      // alias is only for legacy diagnostics; the dynamic canvas is never
      // painted as an edge layer.
      this.activeEdgeCanvas = this.staticCanvas || canvas;
      this.activeEdgeContext = this.staticContext || context;
    }
    this.centerCanvas = canvas;
    this.centerContext = context;
    this.centerStatsCanvas = canvas;
    this.centerStatsContext = context;
    this.stateCanvas = canvas;
    this.stateContext = context;
    this.selectionCanvas = canvas;
    this.selectionContext = context;
  }

  _createSemanticButtons() {
    if (this.semanticButtons.size) return;
    const ownerDocument = this.scene.ownerDocument || document;
    const fragment = ownerDocument.createDocumentFragment();
    for (const manifestNode of this.renderManifest.nodes || []) {
      const node = (this.treeData.nodes || []).find((candidate) => String(candidate.id) === String(manifestNode.id));
      if (!node) continue;
      const id = String(manifestNode.id);
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = "tree-node-semantic";
      button.dataset.nodeId = id;
      button.dataset.nodeType = getNodeType(node);
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", String(node.name_zh || node.name || id));
      button.title = String(node.name_zh || node.name || id);
      button.dataset.unlockLabel = getUnlockConditionLabel(node);
      const hitBox = manifestNode.hitBox || { x: manifestNode.x - 60, y: manifestNode.y - 60, width: 120, height: 120 };
      button.style.left = `${hitBox.x}px`;
      button.style.top = `${hitBox.y}px`;
      button.style.width = `${hitBox.width}px`;
      button.style.height = `${hitBox.height}px`;
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        button.classList.add("is-pressing");
        this.setPressedNode(id, true);
        try { button.setPointerCapture?.(event.pointerId); } catch { /* Optional on old WebKit. */ }
      });
      const endPress = () => {
        button.classList.remove("is-pressing");
        this.setPressedNode(id, false);
      };
      button.addEventListener("pointerup", endPress);
      button.addEventListener("pointercancel", endPress);
      button.addEventListener("lostpointercapture", endPress);
      fragment.appendChild(button);
      this.semanticButtons.set(id, button);
    }
    this.layers.semantic.appendChild(fragment);
    if (this.semanticButtons.size !== this.renderManifest.nodes.length) {
      throw new Error(`Canvas semantic node count mismatch: ${this.semanticButtons.size}.`);
    }
    const centerButton = ownerDocument.createElement("button");
    centerButton.type = "button";
    centerButton.id = "tree-center-compendium-btn";
    centerButton.className = "tree-center-compendium-semantic";
    centerButton.setAttribute("role", "button");
    centerButton.tabIndex = 0;
    centerButton.setAttribute("aria-label", this.localization?.t?.("compendium.open", {}, "Open compendium") || "Open compendium");
    centerButton.style.left = "1890px";
    centerButton.style.top = "1630px";
    centerButton.style.width = "220px";
    centerButton.style.height = "150px";
    this.layers.semantic.appendChild(centerButton);
  }

  _buildModel(state) {
    return buildTreeRenderModel({
      treeData: state?.treeData || this.treeData,
      state,
      renderManifest: this.renderManifest,
      nodePositions: state?.nodePositions,
      localization: this.localization
    });
  }

  _makeCommittedStateOverlayRequest(state, model, sourceReason = "state") {
    const bounds = this._sceneFrameCoverage || this._renderBounds;
    const resolution = Number(this._sceneFrameResolution || this.currentResolution);
    if (!state?.viewport || !model || !bounds || !this._renderBoundsKey || !Number.isFinite(resolution) || resolution <= 0) {
      return null;
    }
    const visibleKey = this._renderedVisibleTileKey || this._renderedTileKey || "";
    return {
      state,
      model,
      resolution,
      targetResolution: this._resolveResolution(state),
      bounds,
      boundsKey: this._renderBoundsKey,
      viewportBounds: this._viewportBounds(state),
      visibleEntries: [],
      renderEntries: [],
      allEntries: [],
      visiblePaths: new Set(),
      allPaths: new Set(),
      visibleKey,
      allKey: visibleKey,
      options: this._sceneOptions(model),
      revision: this._sceneRevision,
      epoch: this._renderEpoch,
      force: true,
      reason: "state-overlay",
      sourceReason,
      viewportRevision: this._viewportRevision
    };
  }

  _isStateOverlayCurrent(request) {
    return Boolean(request?.reason === "state-overlay"
      && !this._destroyed
      && request.model === this.model
      && request.revision === this._sceneRevision
      && request.epoch === this._renderEpoch
      && request.viewportRevision === this._viewportRevision
      && this.dynamicCanvas?.dataset.canvasReady === "true"
      && this._renderBoundsKey === request.boundsKey
      && this._sceneFrameResolution === request.resolution
      && this._sceneFrameCoverage === request.bounds);
  }

  _redrawNodeArtInPlace(request) {
    const canvas = this.nodeArtCanvas;
    const context = this.nodeArtContext;
    if (!request || !canvas || !context
      || canvas.dataset.canvasReady !== "true"
      || !this._isStateOverlayCurrent(request)) return false;

    const nextKey = this._nodeArtSignature(request);
    if (this._nodeArtKey === nextKey) {
      this._nodeArtModel = request.model;
      return true;
    }

    const bounds = request.bounds;
    const changedNodes = this._getNodeArtChanges(this._nodeArtModel, request.model, bounds);
    const region = this._nodeArtRedrawRegion(changedNodes, bounds) || bounds;
    const renderable = (request.model.nodes || []).filter((node) => this._nodeIntersects(node, region));
    // Never clear a committed bitmap until every replacement sprite needed by
    // that region is already decoded. A missing page is loaded by the
    // asynchronous retry below, independently of camera settling.
    if (!this._nodeArtAssetsReady(renderable, request.model, request.resolution)) return false;

    const pixelScale = Number(canvas.dataset.pixelScale || this._dynamicPixelScale(request.state, request.resolution));
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(
      Math.max(0, Math.floor((region.left - bounds.left) * pixelScale)),
      Math.max(0, Math.floor((region.top - bounds.top) * pixelScale)),
      Math.ceil((region.right - region.left) * pixelScale),
      Math.ceil((region.bottom - region.top) * pixelScale)
    );
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    for (const node of renderable) this._drawNodeArt(context, node, request.model, request.resolution);
    context.restore();

    canvas.dataset.canvasReady = "true";
    canvas.dataset.modelRevision = String(this._sceneRevision);
    canvas.dataset.renderedScale = String(request.resolution);
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.renderBounds = request.boundsKey;
    canvas.dataset.nodeCount = String((request.model.nodes || []).filter((node) => this._nodeIntersects(node, bounds)).length);
    canvas.dataset.pressedNode = this._pressedNodeId || "";
    this._nodeArtKey = nextKey;
    this._nodeArtModel = request.model;
    return true;
  }

  _scheduleStateNodeArtRefresh(request) {
    if (!request || this._destroyed) return;
    const token = ++this._stateNodeArtRefreshToken;
    const nodes = (request.model?.nodes || []).filter((node) => this._nodeIntersects(node, request.bounds));
    const refresh = this._ensureNodeArtAssets(nodes, request.model, request.resolution)
      .then(() => {
        if (token !== this._stateNodeArtRefreshToken || !this._isStateOverlayCurrent(request)) return false;
        if (!this._redrawNodeArtInPlace(request)) return false;
        return this._redrawDynamicInPlace(request);
      })
      .catch(() => false);
    const tracked = refresh.finally(() => {
      if (this._stateNodeArtRefreshPromise === tracked) this._stateNodeArtRefreshPromise = null;
    });
    this._stateNodeArtRefreshPromise = tracked;
  }

  _redrawStateOverlayInPlace(state, model, actionType) {
    const isSimulationStateAction = IMMEDIATE_SIMULATION_STATE_ACTIONS.has(actionType);
    if (!IMMEDIATE_STATE_OVERLAY_ACTIONS.has(actionType) && !isSimulationStateAction) return false;
    const request = this._makeCommittedStateOverlayRequest(state, model, actionType);
    if (!request) return false;
    if (!this._ensureActiveEdgeSurfaceInPlace(request)) return false;
    if (isSimulationStateAction && this._nodeArtKey !== this._nodeArtSignature(request)) {
      if (!this._redrawNodeArtInPlace(request)) this._scheduleStateNodeArtRefresh(request);
    }
    return this._redrawDynamicInPlace(request);
  }

  _resolveResolution(state) {
    return selectMapResolution({
      scale: state?.viewport?.scale || 1,
      devicePixelRatio: this._getDevicePixelRatio(),
      available: (this.renderManifest?.tile?.scales || ["1x", "2x", "3x"]).map((value) => Number.parseInt(value, 10))
    });
  }

  _getDevicePixelRatio() {
    if (!this._devicePixelRatioExplicit && typeof window !== "undefined") {
      const current = Number(window.devicePixelRatio);
      if (Number.isFinite(current) && current > 0) return current;
    }
    return this.devicePixelRatio;
  }

  _viewportSize() {
    const viewport = this.scene?.closest?.("#viewport,.map-viewport") || this.scene?.parentElement;
    return {
      width: viewport?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1280),
      height: viewport?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 800)
    };
  }

  _viewportBounds(state) {
    const { width, height } = this._viewportSize();
    const scale = Math.max(0.01, Number(state?.viewport?.scale || 1));
    const x = Number(state?.viewport?.x || 0);
    const y = Number(state?.viewport?.y || 0);
    const viewBox = this.renderManifest.viewBox;
    return {
      left: Math.max(viewBox.x, -x / scale),
      top: Math.max(viewBox.y, -y / scale),
      right: Math.min(viewBox.x + viewBox.width, (-x + width) / scale),
      bottom: Math.min(viewBox.y + viewBox.height, (-y + height) / scale)
    };
  }

  _getDynamicRenderBounds(state) {
    const viewBox = this.renderManifest?.viewBox || { x: 0, y: 0, width: 4000, height: 3400 };
    const visible = this._viewportBounds(state);
    if (visible.left <= viewBox.x
      && visible.top <= viewBox.y
      && visible.right >= viewBox.x + viewBox.width
      && visible.bottom >= viewBox.y + viewBox.height) {
      return {
        left: viewBox.x,
        top: viewBox.y,
        right: viewBox.x + viewBox.width,
        bottom: viewBox.y + viewBox.height,
        width: viewBox.width,
        height: viewBox.height
      };
    }
    const left = Math.max(viewBox.x, visible.left - DYNAMIC_BOUNDS_PADDING);
    const top = Math.max(viewBox.y, visible.top - DYNAMIC_BOUNDS_PADDING);
    const right = Math.min(viewBox.x + viewBox.width, visible.right + DYNAMIC_BOUNDS_PADDING);
    const bottom = Math.min(viewBox.y + viewBox.height, visible.bottom + DYNAMIC_BOUNDS_PADDING);
    return { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }

  _makeBoundsKey(bounds, resolution) {
    return [bounds?.left, bounds?.top, bounds?.width, bounds?.height, resolution].join(":");
  }

  _dynamicPixelScale(state, resolution) {
    const bucket = Math.max(1, Number(resolution) || 1);
    const cameraScale = Math.max(0.01, Number(state?.viewport?.scale) || 1);
    const displayDensity = cameraScale * Math.max(1, this._getDevicePixelRatio());
    // A canvas only needs the density that reaches the display. At a distant
    // zoom, keeping one physical pixel per world unit creates a huge backing
    // store for labels and state overlays that are ultimately sampled down to
    // a fraction of a pixel. The raster tile bucket still controls source
    // image quality; this scale controls the dynamic overlay workload.
    return Math.min(bucket, Math.max(0.25, displayDensity));
  }

  _configureCanvas(canvas, context, bounds, resolution, state, boundsKey) {
    if (!canvas || !context || !bounds) return 0;
    const scale = this._dynamicPixelScale(state, resolution);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    canvas.width = width;
    canvas.height = height;
    canvas.style.left = `${bounds.left}px`;
    canvas.style.top = `${bounds.top}px`;
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
    canvas.dataset.renderBounds = boundsKey;
    canvas.dataset.renderedScale = String(resolution);
    canvas.dataset.pixelScale = String(scale);
    // This is always a fresh candidate canvas. Its 2D context already has
    // the defaults below; resetting every drawing state here forces some
    // engines to allocate the backing surface synchronously before painting.
    // Keep candidate setup to the transform and smoothing policy only.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // Setting width/height on a new candidate already clears its bitmap. Do
    // not issue a second full-surface clear here; on large mobile canvases it
    // is an avoidable synchronous allocation/raster barrier.
    context.setTransform(scale, 0, 0, scale, -bounds.left * scale, -bounds.top * scale);
    return scale;
  }

  _nodeIntersects(node, bounds) {
    if (!node || !bounds) return false;
    const halfWidth = Math.max(96, Number(node.geometry?.width || 0) / 2);
    const halfHeight = Math.max(96, Number(node.geometry?.height || 0) / 2);
    return node.x + halfWidth >= bounds.left
      && node.x - halfWidth <= bounds.right
      && node.y + halfHeight >= bounds.top
      && node.y - halfHeight <= bounds.bottom;
  }

  _sceneOptions(model, mode = "live") {
    const isShare = mode === "share" || mode === "share-minimal";
    return {
      showNames: !isShare && typeof document !== "undefined" && document.body?.classList.contains("show-node-names"),
      showCurrency: !isShare && typeof document !== "undefined" && document.body?.classList.contains("show-currency-badges"),
      simulation: Boolean(model?.isSimulation),
      locale: model?.locale || "",
      includeCenterStats: mode !== "share-minimal"
    };
  }

  _fullMapBounds() {
    const viewBox = this.renderManifest?.viewBox || { x: 0, y: 0, width: 4000, height: 3400 };
    return {
      left: viewBox.x,
      top: viewBox.y,
      right: viewBox.x + viewBox.width,
      bottom: viewBox.y + viewBox.height,
      width: viewBox.width,
      height: viewBox.height
    };
  }

  _overviewPixelScale() {
    // The overview is a continuity surface, not the close-up source. Keep it
    // at a fixed 0.5x density: multiplying by a phone's DPR would allocate a
    // 4000x3400 backing store (more than 50 MB before compositor copies) and
    // turn the fallback itself into the mobile frame-time spike.
    return OVERVIEW_MIN_PIXEL_SCALE;
  }

  _setOverviewVisibility(model = this.model) {
    if (!this.overviewCanvas) return;
    const currentCompatibility = this._makeOverviewCompatibility(model);
    const overviewSurfaces = [
      this.overviewCanvas,
      this.overviewEdgeCanvas,
      this.overviewNodeArtCanvas,
      this.overviewDynamicCanvas
    ].filter(Boolean);
    const ready = overviewSurfaces.length === 4
      && overviewSurfaces.every((surface) => surface.dataset.canvasReady === "true");
    const visibility = ready
      && currentCompatibility === this._overviewCompatibility
      ? "visible"
      : "hidden";
    for (const surface of overviewSurfaces) {
      if (surface.style.visibility !== visibility) surface.style.visibility = visibility;
    }
  }

  _makeOverviewSignature(model) {
    const options = this._sceneOptions(model);
    const nodes = (model?.nodes || []).map((node) => [
      node.id,
      node.label,
      node.simulationVariant || "normal",
      node.isDimmed ? 1 : 0,
      node.isSelected ? 1 : 0,
      node.isLinkedSelected ? 1 : 0,
      node.isPrereq ? 1 : 0,
      node.simulationView?.isVisible ? 1 : 0,
      node.simulationView?.isSpecial ? 1 : 0
    ].join(":"));
    return [
      model?.isSimulation ? "simulation" : "normal",
      model?.locale || "",
      options.showNames ? 1 : 0,
      options.showCurrency ? 1 : 0,
      Object.entries(model?.factionLevels || {}).map(([key, value]) => `${key}:${value}`).join(","),
      nodes.join("|")
    ].join(";");
  }

  _makeOverviewCompatibility(model) {
    return `${model?.isSimulation ? "simulation" : "normal"};${model?.locale || ""}`;
  }

  _configureOverviewCanvas(canvas, context, pixelScale = this._overviewPixelScale()) {
    const bounds = this._fullMapBounds();
    const resolvedPixelScale = Math.max(0.1, Number(pixelScale) || this._overviewPixelScale());
    canvas.width = Math.max(1, Math.round(bounds.width * resolvedPixelScale));
    canvas.height = Math.max(1, Math.round(bounds.height * resolvedPixelScale));
    canvas.style.left = `${bounds.left}px`;
    canvas.style.top = `${bounds.top}px`;
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
    canvas.dataset.pixelScale = String(resolvedPixelScale);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, OVERVIEW_RESOLUTION);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(resolvedPixelScale, 0, 0, resolvedPixelScale, -bounds.left * resolvedPixelScale, -bounds.top * resolvedPixelScale);
    return { bounds, pixelScale: resolvedPixelScale };
  }

  _configureFullMapDimMaskCanvas(canvas, context) {
    const bounds = this._fullMapBounds();
    const pixelScale = FULL_MAP_DIM_MASK_PIXEL_SCALE;
    const width = Math.max(1, Math.round(bounds.width * pixelScale));
    const height = Math.max(1, Math.round(bounds.height * pixelScale));
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) {
      // Assigning width/height clears the bitmap and can allocate a large
      // backing store. Do this only when the manifest changes, never for a
      // normal filter/selection state update.
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.left = `${bounds.left}px`;
    canvas.style.top = `${bounds.top}px`;
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, "full-map");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    return { bounds, pixelScale, resized };
  }

  _configureFullMapEdgeDimMaskCanvas(canvas, context, { allocate = true } = {}) {
    const bounds = this._fullMapBounds();
    const pixelScale = FULL_MAP_EDGE_DIM_MASK_PIXEL_SCALE;
    const width = Math.max(1, Math.round(bounds.width * pixelScale));
    const height = Math.max(1, Math.round(bounds.height * pixelScale));
    const targetWidth = allocate ? width : 1;
    const targetHeight = allocate ? height : 1;
    const resized = canvas.width !== targetWidth || canvas.height !== targetHeight;
    if (resized) {
      // This is a fixed world-space surface. Resize only when the manifest
      // changes; state updates clear and repaint the existing bitmap in place.
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    canvas.style.left = `${bounds.left}px`;
    canvas.style.top = `${bounds.top}px`;
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, "full-map-edge");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    return { bounds, pixelScale, resized };
  }

  _makeFullMapDimMaskSignature(model) {
    return (model?.nodes || [])
      .filter((node) => node.isDimmed && !node.isSelected && !node.isLinkedSelected)
      .map((node) => [
        node.id,
        node.x,
        node.y,
        node.geometry?.shape || "small-passive"
      ].join(":"))
      .join("|");
  }

  _renderFullMapDimMask(model) {
    const canvas = this.fullMapDimMaskCanvas;
    const context = this.fullMapDimMaskContext;
    if (!canvas || !context) return false;

    const signature = this._makeFullMapDimMaskSignature(model);
    if (signature === this._fullMapDimMaskSignature && this._fullMapDimMaskModel === model) return true;

    const { bounds, pixelScale, resized } = this._configureFullMapDimMaskCanvas(canvas, context);
    const previousNodes = resized ? [] : this._fullMapDimMaskNodes;
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    const dimmed = (model?.nodes || []).filter((node) => (
      node.isDimmed && !node.isSelected && !node.isLinkedSelected
    ));
    if (previousNodes.length) {
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.globalAlpha = 1;
      context.beginPath();
      for (const node of previousNodes) appendNodeOcclusionPath(context, node);
      context.fill();
      context.restore();
    }
    if (dimmed.length) {
      context.save();
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = FULL_MAP_DIM_MASK_ALPHA;
      context.fillStyle = SIMULATION_OCCLUSION_FILL;
      context.filter = "none";
      context.shadowColor = "transparent";
      context.shadowBlur = 0;
      context.beginPath();
      for (const node of dimmed) appendNodeOcclusionPath(context, node);
      context.fill();
      context.restore();
    }
    canvas.dataset.canvasReady = "true";
    canvas.dataset.nodeCount = String(dimmed.length);
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, "full-map");
    canvas.style.visibility = dimmed.length ? "visible" : "hidden";
    this._fullMapDimMaskModel = model;
    this._fullMapDimMaskSignature = signature;
    this._fullMapDimMaskActive = dimmed.length > 0;
    this._fullMapDimMaskNodes = dimmed;
    return true;
  }

  _makeFullMapEdgeDimMaskSignature(model) {
    const baseOpacity = getStaticEdgeOpacity(model);
    const strokeMode = model?.hasFilter || model?.hasPrereqHighlight ? "wide" : "normal";
    const brightActiveEdges = (model?.edges || [])
      .filter((edge) => isActiveEdge(edge, model) && !edge.isDimmed)
      .map((edge) => String(edge.key || `${edge.from}:${edge.to}`))
      .join("|");
    const brightActiveCenterLinks = (model?.centerLinks || [])
      .filter((link) => isActiveCenterLink(link, model) && !link.isDimmed)
      .map((link) => String(link.key || `center-${link.branch}`))
      .join("|");
    return `${baseOpacity};${strokeMode};${brightActiveEdges};${brightActiveCenterLinks}`;
  }

  _renderFullMapEdgeDimMask(model) {
    const canvas = this.fullMapEdgeDimMaskCanvas;
    const context = this.fullMapEdgeDimMaskContext;
    if (!canvas || !context) return false;

    const signature = this._makeFullMapEdgeDimMaskSignature(model);
    if (signature === this._fullMapEdgeDimMaskSignature && canvas.dataset.canvasReady === "true") {
      // Labels, currency badges, and other dynamic state can rebuild the
      // model without changing the line veil. Keep the current bitmap and
      // only advance its model reference instead of clearing 3.4M pixels.
      this._fullMapEdgeDimMaskModel = model;
      return true;
    }

    const baseOpacity = getStaticEdgeOpacity(model);
    const { bounds, pixelScale } = this._configureFullMapEdgeDimMaskCanvas(
      canvas,
      context,
      { allocate: baseOpacity < 1 }
    );
    if (baseOpacity >= 1) {
      // Release the full backing store when the veil is not needed. Keeping a
      // hidden 2000x1700 bitmap alive on normal pages competes with the
      // high-resolution scene during subsequent zoom gestures.
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (baseOpacity < 1) context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);

    if (baseOpacity < 1) {
      context.save();
      context.globalAlpha = 1 - baseOpacity;
      context.globalCompositeOperation = "source-over";
      context.fillStyle = SIMULATION_OCCLUSION_FILL;
      context.filter = "none";
      context.shadowColor = "transparent";
      context.shadowBlur = 0;
      context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
      context.restore();
      // Cut transparent holes for bright active paths. The high-resolution
      // strokes below this surface then remain sharp at every camera scale,
      // while the veil still covers the complete map without viewport seams.
      drawFullMapEdgeCutouts(context, model);
    }

    canvas.dataset.canvasReady = "true";
    canvas.dataset.active = String(baseOpacity < 1);
    canvas.dataset.baseEdgeOpacity = String(baseOpacity);
    canvas.dataset.edgeCount = String((model?.edges || []).length + (model?.centerLinks || []).length);
    canvas.dataset.brightEdgeCount = String(countBrightActiveEdges(model));
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, "full-map-edge");
    canvas.style.visibility = baseOpacity < 1 ? "visible" : "hidden";
    this._fullMapEdgeDimMaskModel = model;
    this._fullMapEdgeDimMaskSignature = signature;
    this._fullMapEdgeDimMaskActive = baseOpacity < 1;
    return true;
  }

  async _drawOverviewNodeArt(context, model, isCurrent) {
    const bounds = this._fullMapBounds();
    const renderable = (model?.nodes || []).filter((node) => this._nodeIntersects(node, bounds));
    if (isCurrent && !isCurrent()) return false;
    const batchSize = getNodeArtBatchSize(context, bounds);
    for (let index = 0; index < renderable.length; index += batchSize) {
      if (isCurrent && !isCurrent()) return false;
      for (const node of renderable.slice(index, index + batchSize)) {
        // Keep overview node art in the same layer as the bounded node art.
        // The line veil is intentionally below both node-art surfaces; if
        // node art is painted into the overview's background canvas, the veil
        // darkens out-of-frame nodes a second time during camera motion.
        this._drawNodeArt(context, node, model, OVERVIEW_RESOLUTION, {
          includeOcclusion: true,
          alpha: 1
        });
      }
      if (index + batchSize < renderable.length) await yieldToNextFrame();
    }
    return true;
  }

  _redrawOverviewEdgeInPlace(model) {
    const canvas = this.overviewEdgeCanvas;
    const context = this.overviewEdgeContext;
    if (!canvas || !context
      || canvas.dataset.canvasReady !== "true"
      || this._makeOverviewCompatibility(model) !== this._overviewCompatibility) return false;

    const bounds = this._fullMapBounds();
    const pixelScale = Number(canvas.dataset.pixelScale || this._overviewPixelScale());
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.filter = "none";
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    drawActiveEdges(context, model, { skipDimmed: shouldUseFullMapEdgeDimMask(model) });
    context.restore();

    const activeEdgeCount = (model.edges || []).filter((edge) => isActiveEdge(edge, model)).length;
    canvas.dataset.canvasReady = "true";
    canvas.dataset.edgeComposite = "true";
    canvas.dataset.activeEdgeCount = String(activeEdgeCount);
    canvas.dataset.modelRevision = String(this._sceneRevision);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, OVERVIEW_RESOLUTION);
    return true;
  }

  async _drawOverviewDynamic(context, model, options, isCurrent) {
    const bounds = this._fullMapBounds();
    const renderable = (model?.nodes || []).filter((node) => this._nodeIntersects(node, bounds));
    const currencyLabelLayout = options.showCurrency
      ? buildCurrencyLabelLayout(context, model?.nodes || [], this.localization, this.currencyImages)
      : null;
    const frameOptions = currencyLabelLayout ? { ...options, currencyLabelLayout } : options;
    if (isCurrent && !isCurrent()) return false;
    this._drawCenter(context, model, OVERVIEW_RESOLUTION);
    const selectionDrawn = await drawNodeBatches(
      renderable,
      (node) => this._drawSelectionWithArtwork(context, node, model, OVERVIEW_RESOLUTION, false),
      isCurrent
    );
    if (!selectionDrawn) return false;
    if (options.includeCenterStats) drawCenterStats(context, model, this.localization);
    return drawNodeBatches(
      renderable,
      (node) => this._drawStateLabel(context, node, model, frameOptions),
      isCurrent
    );
  }

  _redrawOverviewDynamicInPlace(model) {
    const canvas = this.overviewDynamicCanvas;
    const context = this.overviewDynamicContext;
    if (!canvas || !context
      || canvas.dataset.canvasReady !== "true"
      || this._makeOverviewCompatibility(model) !== this._overviewCompatibility) return false;

    const bounds = this._fullMapBounds();
    const options = this._sceneOptions(model);
    const currencyLabelLayout = options.showCurrency
      ? buildCurrencyLabelLayout(context, model.nodes || [], this.localization, this.currencyImages)
      : null;
    const frameOptions = currencyLabelLayout ? { ...options, currencyLabelLayout } : options;
    const pixelScale = Number(canvas.dataset.pixelScale || this._overviewPixelScale());
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.filter = "none";
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    this._drawCenter(context, model, OVERVIEW_RESOLUTION);
    for (const node of model.nodes || []) {
      if (!this._nodeIntersects(node, bounds)) continue;
      this._drawSelectionWithArtwork(context, node, model, OVERVIEW_RESOLUTION, false);
    }
    if (options.includeCenterStats) drawCenterStats(context, model, this.localization);
    for (const node of model.nodes || []) {
      if (!this._nodeIntersects(node, bounds)) continue;
      this._drawStateLabel(context, node, model, frameOptions);
    }
    context.restore();

    canvas.dataset.canvasReady = "true";
    canvas.dataset.modelRevision = String(this._sceneRevision);
    canvas.dataset.selectedNode = String(model.selectedNodeId || "");
    canvas.dataset.prerequisiteCount = String((model.nodes || []).filter((node) => node.isPrereq).length);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, OVERVIEW_RESOLUTION);
    return true;
  }

  _redrawOverviewNodeArtInPlace(model) {
    const canvas = this.overviewNodeArtCanvas;
    const context = this.overviewNodeArtContext;
    if (!canvas || !context
      || canvas.dataset.canvasReady !== "true"
      || this._makeOverviewCompatibility(model) !== this._overviewCompatibility) return false;

    const nextSignature = this._makeOverviewNodeArtSignature(model);
    if (nextSignature === this._overviewNodeArtSignature) {
      this._overviewNodeArtModel = model;
      return true;
    }

    const bounds = this._fullMapBounds();
    const changedNodes = this._getNodeArtChanges(this._overviewNodeArtModel, model, bounds);
    const region = this._nodeArtRedrawRegion(changedNodes, bounds) || bounds;
    const renderable = (model.nodes || []).filter((node) => this._nodeIntersects(node, region));
    if (!this._nodeArtAssetsReady(renderable, model, OVERVIEW_RESOLUTION)) return false;

    const pixelScale = Number(canvas.dataset.pixelScale || this._overviewPixelScale());
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(
      Math.max(0, Math.floor((region.left - bounds.left) * pixelScale)),
      Math.max(0, Math.floor((region.top - bounds.top) * pixelScale)),
      Math.ceil((region.right - region.left) * pixelScale),
      Math.ceil((region.bottom - region.top) * pixelScale)
    );
    context.setTransform(pixelScale, 0, 0, pixelScale, -bounds.left * pixelScale, -bounds.top * pixelScale);
    for (const node of renderable) this._drawNodeArt(context, node, model, OVERVIEW_RESOLUTION);
    context.restore();

    canvas.dataset.canvasReady = "true";
    canvas.dataset.modelRevision = String(this._sceneRevision);
    canvas.dataset.renderBounds = this._makeBoundsKey(bounds, OVERVIEW_RESOLUTION);
    canvas.dataset.nodeCount = String((model.nodes || []).length);
    this._overviewNodeArtModel = model;
    this._overviewNodeArtSignature = nextSignature;
    return true;
  }

  _scheduleOverviewNodeArtRefresh(model) {
    if (!model || this._destroyed) return;
    const token = ++this._overviewNodeArtRefreshToken;
    const bounds = this._fullMapBounds();
    const changedNodes = this._getNodeArtChanges(this._overviewNodeArtModel, model, bounds);
    const region = this._nodeArtRedrawRegion(changedNodes, bounds) || bounds;
    const nodes = (model.nodes || []).filter((node) => this._nodeIntersects(node, region));
    const refresh = this._ensureNodeArtAssets(nodes, model, OVERVIEW_RESOLUTION)
      .then(() => {
        if (token !== this._overviewNodeArtRefreshToken
          || this._destroyed
          || this.model !== model
          || this._makeOverviewCompatibility(model) !== this._overviewCompatibility) return false;
        if (!this._redrawOverviewNodeArtInPlace(model)) return false;
        const edgeSynced = this._redrawOverviewEdgeInPlace(model);
        const dynamicSynced = this._redrawOverviewDynamicInPlace(model);
        if (edgeSynced && dynamicSynced) this._overviewSignature = this._makeOverviewSignature(model);
        return edgeSynced && dynamicSynced;
      })
      .catch(() => false);
    const tracked = refresh.finally(() => {
      if (this._overviewNodeArtRefreshPromise === tracked) this._overviewNodeArtRefreshPromise = null;
    });
    this._overviewNodeArtRefreshPromise = tracked;
  }

  async _buildOverviewInternal(model, state, token) {
    const signature = this._makeOverviewSignature(model);
    const compatibility = this._makeOverviewCompatibility(model);
    const bounds = this._fullMapBounds();
    const entries = this.tileRepository?.getVisibleTileEntries?.(OVERVIEW_RESOLUTION, bounds)
      || this.tileRepository?.getTileEntries?.(OVERVIEW_RESOLUTION, bounds, { prefetchRadius: 0 })
      || [];
    const loaded = new Map();
    const options = this._sceneOptions(model);
    await Promise.all([
      Promise.all(entries.map(async (entry) => {
        loaded.set(String(entry.path), await this.tileRepository.loadImage(entry.path));
      })),
      this._ensureAtlases(OVERVIEW_RESOLUTION, this._requiredVariants(model), model, bounds),
      this._ensureCenterImages(OVERVIEW_RESOLUTION, [model.isSimulation ? "simulation" : "normal"]),
      options.showCurrency ? this._ensureCurrencyImages() : Promise.resolve()
    ]);
    if (this._destroyed || token !== this._overviewBuildToken) return false;
    const ownerDocument = this.scene?.ownerDocument || document;
    const makeCanvas = (className, pixelScale = this._overviewPixelScale()) => {
      const canvas = ownerDocument.createElement("canvas");
      canvas.className = className;
      canvas.setAttribute("aria-hidden", "true");
      canvas.width = 1;
      canvas.height = 1;
      const context = getCanvas2DContext(canvas);
      if (!context) return null;
      this._configureOverviewCanvas(canvas, context, pixelScale);
      canvas.style.visibility = "hidden";
      return { canvas, context };
    };
    const staticSurface = makeCanvas("tree-overview-surface");
    const edgeSurface = makeCanvas("tree-overview-edge-surface", OVERVIEW_EDGE_PIXEL_SCALE);
    const nodeArtSurface = makeCanvas("tree-overview-node-art-surface");
    const dynamicSurface = makeCanvas("tree-overview-dynamic-surface");
    if (!staticSurface || !edgeSurface || !nodeArtSurface || !dynamicSurface) return false;
    const { canvas, context } = staticSurface;
    drawEdgeComposite(
      context,
      entries,
      loaded,
      Number(this.renderManifest.tile?.logicalSize || 512),
      bounds,
      model,
      {
        useFullMapEdgeDimMask: shouldUseFullMapEdgeDimMask(model),
        // Active paths live in the dedicated overview edge foreground. This
        // keeps the base raster state-independent and lets a state action
        // repaint the full-map highlight without reloading or reallocating
        // the continuity tiles.
        drawActiveEdgeLayer: false
      }
    );
    drawActiveEdges(
      edgeSurface.context,
      model,
      { skipDimmed: shouldUseFullMapEdgeDimMask(model) }
    );
    const isCurrent = () => (
      !this._destroyed
      && token === this._overviewBuildToken
      && this._makeOverviewCompatibility(this.model) === compatibility
    );
    const drawnNodeArt = await this._drawOverviewNodeArt(nodeArtSurface.context, model, isCurrent);
    const drawnDynamic = drawnNodeArt
      && await this._drawOverviewDynamic(dynamicSurface.context, model, options, isCurrent);
    if (!drawnDynamic || this._destroyed || token !== this._overviewBuildToken) return false;
    const overviewSurfaces = [
      { canvas, context, surface: "static" },
      { canvas: edgeSurface.canvas, context: edgeSurface.context, surface: "edge" },
      { canvas: nodeArtSurface.canvas, context: nodeArtSurface.context, surface: "node-art" },
      { canvas: dynamicSurface.canvas, context: dynamicSurface.context, surface: "dynamic" }
    ];
    for (const entry of overviewSurfaces) {
      entry.canvas.dataset.canvasReady = "true";
      entry.canvas.dataset.nodeCount = String((model.nodes || []).length);
      entry.canvas.dataset.continuity = "full-map";
      entry.canvas.dataset.surface = entry.surface;
      entry.canvas.dataset.renderBounds = this._makeBoundsKey(bounds, OVERVIEW_RESOLUTION);
      entry.canvas.style.visibility = "hidden";
    }
    canvas.dataset.nodeDimming = "fixed-full-map-mask";
    canvas.dataset.edgeDimming = "fixed-full-map-mask";
    edgeSurface.canvas.dataset.edgeComposite = "true";
    edgeSurface.canvas.dataset.activeEdgeCount = String((model.edges || []).filter((edge) => isActiveEdge(edge, model)).length);
    edgeSurface.canvas.dataset.modelRevision = String(this._sceneRevision);
    dynamicSurface.canvas.dataset.modelRevision = String(this._sceneRevision);
    dynamicSurface.canvas.dataset.selectedNode = String(model.selectedNodeId || "");
    dynamicSurface.canvas.dataset.prerequisiteCount = String((model.nodes || []).filter((node) => node.isPrereq).length);
    const frameHost = this.layers.frameHost;
    if (!frameHost) return false;
    const previousSurfaces = [
      this.overviewCanvas,
      this.overviewEdgeCanvas,
      this.overviewNodeArtCanvas,
      this.overviewDynamicCanvas
    ];
    for (const [index, previous] of previousSurfaces.entries()) {
      const next = overviewSurfaces[index].canvas;
      if (previous?.parentElement === frameHost) previous.replaceWith(next);
      else frameHost.insertBefore(next, frameHost.firstChild || null);
    }
    this.overviewCanvas = canvas;
    this.overviewContext = context;
    this.overviewEdgeCanvas = edgeSurface.canvas;
    this.overviewEdgeContext = edgeSurface.context;
    this.overviewNodeArtCanvas = nodeArtSurface.canvas;
    this.overviewNodeArtContext = nodeArtSurface.context;
    this.overviewDynamicCanvas = dynamicSurface.canvas;
    this.overviewDynamicContext = dynamicSurface.context;
    this._overviewNodeArtModel = model;
    this._overviewNodeArtSignature = this._makeOverviewNodeArtSignature(model);
    this._overviewSignature = signature;
    this._overviewCompatibility = compatibility;
    this._setOverviewVisibility(this.model);
    return true;
  }

  _buildOverview(model, state) {
    if (!model || !state || !this.layers.frame) return Promise.resolve(false);
    if (this._overviewBuildPromise !== null) return this._overviewBuildPromise;
    const token = ++this._overviewBuildToken;
    const build = this._buildOverviewInternal(model, state, token).catch(() => false);
    const tracked = build.finally(() => {
      if (this._overviewBuildPromise === tracked) this._overviewBuildPromise = null;
      const current = this.model;
      if (!this._destroyed && current && this._makeOverviewCompatibility(current) !== this._overviewCompatibility && this._overviewBuildPromise === null) {
        this._buildOverview(current, this.lastState || state).catch(() => undefined);
      }
    });
    this._overviewBuildPromise = tracked;
    return tracked;
  }

  _requiredVariants(model) {
    const variants = new Set(["normal"]);
    if (model?.isSimulation) {
      for (const node of model.nodes || []) variants.add(node.simulationVariant);
    }
    return [...variants];
  }

  _atlasPageEntries(variant, resolution, model = null, bounds = null) {
    const key = `${variant}-${resolution}x`;
    const atlas = this.renderManifest?.atlas?.[key];
    if (!atlas) return [];
    if (Array.isArray(atlas.pages) && atlas.pages.length > 0) return this._atlasPages(atlas, key, variant, resolution, model, bounds);
    if (atlas.path) return [{ key, pageIndex: 0, path: atlas.path }];
    return [];
  }

  _atlasPages(atlas, key, variant, resolution, model, bounds) {
    const pageIndexes = this._atlasPageIndexes(atlas, variant, resolution, model, bounds);
    return pageIndexes.sort((left, right) => left - right).map((pageIndex) => ({
      key,
      pageIndex,
      path: atlas.pages[pageIndex].path
    }));
  }

  _atlasPageIndexes(atlas, variant, resolution, model, bounds) {
    const scopedNodes = model && bounds
      ? (model.nodes || []).filter((node) => this._nodeIntersects(node, bounds))
      : null;
    if (!scopedNodes) return atlas.pages.map((_page, index) => index);
    const pageIndexes = new Set();
    for (const node of scopedNodes) {
      const nodeVariant = model.isSimulation ? node.simulationVariant : "normal";
      if (nodeVariant !== variant) continue;
      const frame = resolveNodeFrame(node, variant, resolution);
      if (Number.isInteger(frame?.page) && frame.page >= 0 && frame.page < atlas.pages.length) pageIndexes.add(frame.page);
    }
    return [...pageIndexes];
  }

  _atlasImage(variant, resolution, frame) {
    if (!frame) return null;
    const key = `${variant}-${resolution}x:${Number.isInteger(frame.page) ? frame.page : 0}`;
    return this.atlasImages.get(key) || null;
  }

  async _ensureAtlases(resolution, variants = ["normal"], model = null, bounds = null) {
    const pages = variants.flatMap((variant) => this._atlasPageEntries(variant, resolution, model, bounds));
    await Promise.all(pages.map(async ({ key, pageIndex, path }) => {
      const imageKey = `${key}:${pageIndex}`;
      if (this.atlasImages.has(imageKey)) return;
      const image = await this.tileRepository.loadImage(path);
      this.atlasImages.set(imageKey, image);
      this.atlasImagePaths.set(imageKey, String(path));
    }));
  }

  _atlasKeysForRequest(request) {
    if (!request) return new Set();
    return new Set(this._requiredVariants(request.model)
      .flatMap((variant) => this._atlasPageEntries(variant, request.resolution, request.model, request.bounds))
      .map(({ key, pageIndex }) => `${key}:${pageIndex}`));
  }

  _trimAtlasImages(request) {
    // A full-map continuity frame may still be painting its 1x atlas pages.
    // Do not close those ImageBitmaps underneath the detached canvas.
    if (this._overviewBuildPromise !== null
      || this._overviewNodeArtRefreshPromise !== null
      || this._stateNodeArtRefreshPromise !== null) return;
    const keepKeys = this._atlasKeysForRequest(request);
    for (const [imageKey] of this.atlasImages) {
      if (keepKeys.has(imageKey)) continue;
      const path = this.atlasImagePaths.get(imageKey);
      this.atlasImages.delete(imageKey);
      this.atlasImagePaths.delete(imageKey);
      this.tileRepository?.releaseImage?.(path);
    }
  }

  _cancelAtlasTrim() {
    if (this._atlasTrimHandle !== null) clearTimeout(this._atlasTrimHandle);
    this._atlasTrimHandle = null;
    this._atlasTrimRequest = null;
  }

  _scheduleAtlasTrim(request, delay = 600) {
    if (!request || this._destroyed) return;
    this._cancelAtlasTrim();
    const trimKey = [
      request.revision,
      request.resolution,
      request.boundsKey,
      request.model?.isSimulation ? "simulation" : "normal"
    ].join("|");
    this._atlasTrimRequest = { key: trimKey, request };
    const run = () => {
      this._atlasTrimHandle = null;
      const pending = this._atlasTrimRequest;
      if (!pending || this._destroyed) return;
      const isCurrent = this._sceneFrameModel === pending.request.model
        && this._sceneFrameResolution === pending.request.resolution
        && this._renderBoundsKey === pending.request.boundsKey
        && this._sceneFrameState === pending.request.state;
      if (!isCurrent || this._isCameraMotionActive()
        || this._sceneFramePromise !== null
        || this._overviewBuildPromise !== null) {
        this._atlasTrimHandle = setTimeout(run, 250);
        return;
      }
      this._atlasTrimRequest = null;
      this._trimAtlasImages(pending.request);
    };
    this._atlasTrimHandle = setTimeout(run, Math.max(0, Number(delay) || 0));
  }

  async _ensureCenterImages(resolution, variants = ["normal"]) {
    await Promise.all(variants.map(async (variant) => {
      const key = `${variant}-${resolution}x`;
      const center = this.renderManifest?.center?.[variant]?.[`${resolution}x`];
      if (!center?.path || this.centerImages.has(key)) return;
      const image = await this.tileRepository.loadImage(center.path);
      this.centerImages.set(key, image);
    }));
  }

  async _ensureCurrencyImages() {
    await Promise.all([
      ["gold", "icons/TreeShadow_sprite-185.png"],
      ["core", "icons/TreeShadow_sprite-186.png"]
    ].map(async ([key, path]) => {
      if (!this.currencyImages.has(key)) this.currencyImages.set(key, await this.tileRepository.loadImage(path));
    }));
  }

  _drawCenter(ctx, model, resolution) {
    const variant = model.isSimulation ? "simulation" : "normal";
    const image = this.centerImages.get(`${variant}-${resolution}x`);
    const center = this.renderManifest?.center?.[variant]?.[`${resolution}x`];
    if (image && center) {
      const width = Number(center.width) / resolution;
      const height = Number(center.height) / resolution;
      ctx.drawImage(image, 2000 - width / 2, 1700 - height / 2, width, height);
    }
    drawCenterTitle(ctx, model, this.localization);
  }

  _drawStateLabel(ctx, node, model, options) {
    const placement = options.currencyLabelLayout?.get(String(node.id));
    const labelX = placement?.x ?? getNodeLabelCenterX(node);
    const labelY = placement?.y ?? getNodeLabelTop(node);
    if (options.showNames && node.nodeType !== "DICE_RUNE") {
      drawLabel(ctx, node.label, node.x, getNodeLabelTop(node), { font: NODE_LABEL_FONT });
    }
    if (options.showCurrency) {
      const special = getUnlockConditionLabel(node.node);
      if (special) {
        const metrics = placement?.metrics || getAnchoredLabelMetrics(ctx, special, node.labelAnchor);
        drawLabel(ctx, special, labelX, labelY, {
          color: "#ffd859",
          stroke: "#ae7b24",
          font: metrics.font,
          width: metrics.width,
          height: metrics.height
        });
      } else {
        drawCurrencyLabel(
          ctx,
          getCurrencyEntries(node, this.currencyImages),
          labelX,
          labelY,
          this.localization,
          node.labelAnchor,
          placement?.metrics
        );
      }
    }
    const rankText = getSimulationRankBadgeText(node, Boolean(model.isSimulation));
    if (rankText) drawSimulationRankBadge(ctx, node, rankText);
  }

  _resolvePreferredNodeArt(node, model, resolution) {
    const locked = model.isSimulation && node.simulationVariant !== "normal";
    const variant = locked ? node.simulationVariant : "normal";
    const frame = resolveNodeFrame(node, variant, resolution);
    return {
      frame,
      image: this._atlasImage(variant, resolution, frame),
      locked,
      variant
    };
  }

  _resolveNodeArt(node, model, resolution) {
    const preferred = this._resolvePreferredNodeArt(node, model, resolution);
    let { frame, image } = preferred;
    if ((!frame || !image) && preferred.variant !== "normal") {
      frame = resolveNodeFrame(node, "normal", resolution);
      image = this._atlasImage("normal", resolution, frame);
    }
    return { frame, image, locked: preferred.locked };
  }

  _nodeArtAssetEntries(nodes, model, resolution) {
    const entries = new Map();
    for (const node of nodes || []) {
      const preferred = this._resolvePreferredNodeArt(node, model, resolution);
      let variant = preferred.variant;
      let frame = preferred.frame;
      if (!frame && variant !== "normal") {
        variant = "normal";
        frame = resolveNodeFrame(node, variant, resolution);
      }
      if (!frame) continue;
      const atlasKey = `${variant}-${resolution}x`;
      const atlas = this.renderManifest?.atlas?.[atlasKey];
      if (!atlas) continue;
      const pageIndex = Number.isInteger(frame.page) ? frame.page : 0;
      const path = atlas.pages?.[pageIndex]?.path || atlas.path;
      if (!path) continue;
      entries.set(`${atlasKey}:${pageIndex}`, {
        imageKey: `${atlasKey}:${pageIndex}`,
        path: String(path)
      });
    }
    return [...entries.values()];
  }

  _nodeArtAssetsReady(nodes, model, resolution) {
    for (const node of nodes || []) {
      const preferred = this._resolvePreferredNodeArt(node, model, resolution);
      if (preferred.frame && !preferred.image) return false;
    }
    return true;
  }

  async _ensureNodeArtAssets(nodes, model, resolution) {
    const entries = this._nodeArtAssetEntries(nodes, model, resolution);
    await Promise.all(entries.map(async ({ imageKey, path }) => {
      if (this.atlasImages.has(imageKey)) return;
      const image = await this.tileRepository.loadImage(path);
      this.atlasImages.set(imageKey, image);
      this.atlasImagePaths.set(imageKey, path);
    }));
  }

  _makeOverviewNodeArtSignature(model) {
    return [
      model?.isSimulation ? "simulation" : "normal",
      this._pressedNodeId || "",
      (model?.nodes || []).map((node) => [
        node.id,
        node.simulationVariant || "normal",
        node.x,
        node.y
      ].join(":")).join("|")
    ].join(";");
  }

  _getNodeArtChanges(previousModel, model, bounds = null) {
    const previousNodes = new Map((previousModel?.nodes || []).map((node) => [String(node.id), node]));
    return (model?.nodes || []).filter((node) => {
      if (bounds && !this._nodeIntersects(node, bounds)) return false;
      const previous = previousNodes.get(String(node.id));
      return !previous
        || previous.simulationVariant !== node.simulationVariant
        || previous.x !== node.x
        || previous.y !== node.y;
    });
  }

  _nodeArtRedrawRegion(nodes, bounds, padding = 24) {
    if (!nodes?.length || !bounds) return null;
    const region = nodes.reduce((result, node) => ({
      left: Math.min(result.left, node.x - NODE_CELL_SIZE / 2 - padding),
      top: Math.min(result.top, node.y - NODE_CELL_SIZE / 2 - padding),
      right: Math.max(result.right, node.x + NODE_CELL_SIZE / 2 + padding),
      bottom: Math.max(result.bottom, node.y + NODE_CELL_SIZE / 2 + padding)
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    region.left = Math.max(bounds.left, region.left);
    region.top = Math.max(bounds.top, region.top);
    region.right = Math.min(bounds.right, region.right);
    region.bottom = Math.min(bounds.bottom, region.bottom);
    if (region.right <= region.left || region.bottom <= region.top) return null;
    return region;
  }

  _drawNodeArt(ctx, node, model, resolution, { includeOcclusion = true, alpha = 1 } = {}) {
    const { frame, image, locked } = this._resolveNodeArt(node, model, resolution);
    if (!frame || !image) return false;
    if (includeOcclusion && locked) drawNodeOcclusion(ctx, node);
    const pressed = String(this._pressedNodeId || "") === String(node.id);
    const size = NODE_CELL_SIZE * (pressed ? 0.93 : 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, node.x - size / 2, node.y - size / 2, size, size);
    ctx.restore();
    return true;
  }

  _drawNode(ctx, node, model, resolution) {
    const dimmed = Boolean(node.isDimmed && !node.isSelected && !node.isLinkedSelected);
    if (dimmed) drawNodeOcclusion(ctx, node);
    return this._drawNodeArt(ctx, node, model, resolution, {
      includeOcclusion: !dimmed,
      alpha: dimmed ? 0.34 : 1
    });
  }

  async _drawNodeArtLayerAsync(context, model, resolution, bounds, isCurrent = null) {
    const renderable = (model.nodes || []).filter((node) => this._nodeIntersects(node, bounds));
    const batchSize = getNodeArtBatchSize(context, bounds);
    let drawn = 0;
    for (let index = 0; index < renderable.length; index += batchSize) {
      if (isCurrent && !isCurrent()) return null;
      const batch = renderable.slice(index, index + batchSize);
      for (const node of batch) {
        if (this._drawNodeArt(context, node, model, resolution)) drawn += 1;
      }
      if (index + batchSize < renderable.length) await yieldToNextFrame();
    }
    return drawn;
  }

  _drawNodeArtSnapshot(context, canvas) {
    if (!context || !canvas) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(canvas, 0, 0);
    context.restore();
  }

  _drawSelection(ctx, node, model, resolution, animated = false) {
    const colors = COLORS[node.branch] || { base: "#fff", runner: "#fff" };
    if (node.isSelected || node.isLinkedSelected) {
      const pressed = String(this._pressedNodeId || "") === String(node.id);
      ctx.save();
      if (pressed) {
        ctx.translate(node.x, node.y);
        ctx.scale(0.93, 0.93);
        ctx.translate(-node.x, -node.y);
      }
      // The sprite contains both the node frame and its artwork. Paint the
      // selection after that sprite, then cut the ring out wherever the
      // artwork can reach. This leaves the frame highlighted while keeping
      // the icon visually above the selection stroke.
      drawOutsideSelectionArtwork(ctx, node, () => {
        drawNodeRing(ctx, node, colors.base);
        if (animated) drawSelectionRunner(ctx, node, colors, this._selectionPhase);
      });
      ctx.restore();
    } else if (node.isPrereq) {
      drawOutsideSelectionArtwork(ctx, node, () => drawNodeRing(ctx, node, colors.runner));
    }
  }

  _drawSelectionWithArtwork(ctx, node, model, resolution, animated = false) {
    const hasSelectionVisual = Boolean(node.isSelected || node.isLinkedSelected || node.isPrereq);
    if (!hasSelectionVisual) return;
    this._drawNodeArt(ctx, node, model, resolution, { includeOcclusion: true, alpha: 1 });
    this._drawSelection(ctx, node, model, resolution, animated);
  }

  _drawCompleteDynamicFrame(context, model, resolution, bounds, state, options, { animatedSelection = false, nodeArtCanvas = null } = {}) {
    const renderable = (model.nodes || []).filter((node) => this._nodeIntersects(node, bounds));
    const currencyLabelLayout = options.showCurrency
      ? buildCurrencyLabelLayout(context, model.nodes || [], this.localization, this.currencyImages)
      : null;
    const frameOptions = currencyLabelLayout ? { ...options, currencyLabelLayout } : options;
    this._drawCenter(context, model, resolution);
    // Live scene frames receive a separate node-art surface.  Dimmed node art
    // is always covered by the fixed full-map mask; never synthesize a
    // viewport-bounded dim copy here.  The no-nodeArtCanvas path is reserved
    // for the full-map overview and standalone share canvas.
    for (const node of renderable) {
      if (!nodeArtCanvas) this._drawNode(context, node, model, resolution);
    }
    for (const node of renderable) this._drawSelectionWithArtwork(context, node, model, resolution, animatedSelection);
    if (options.includeCenterStats) drawCenterStats(context, model, this.localization);
    for (const node of renderable) this._drawStateLabel(context, node, model, frameOptions);
    return renderable.length;
  }

  async _drawCompleteDynamicFrameAsync(context, model, resolution, bounds, state, options, { animatedSelection = false, isCurrent = null, nodeArtCanvas = null } = {}) {
    const renderable = (model.nodes || []).filter((node) => this._nodeIntersects(node, bounds));
    const currencyLabelLayout = options.showCurrency
      ? buildCurrencyLabelLayout(context, model.nodes || [], this.localization, this.currencyImages)
      : null;
    const frameOptions = currencyLabelLayout ? { ...options, currencyLabelLayout } : options;
    if (isCurrent && !isCurrent()) return null;
    this._drawCenter(context, model, resolution);
    if (!nodeArtCanvas) {
      const nodesDrawn = await drawNodeBatches(
        renderable,
        (node) => this._drawNode(context, node, model, resolution),
        isCurrent
      );
      if (!nodesDrawn) return null;
    }
    const selectionsDrawn = await drawNodeBatches(
      renderable,
      (node) => this._drawSelectionWithArtwork(context, node, model, resolution, animatedSelection),
      isCurrent
    );
    if (!selectionsDrawn) return null;
    if (isCurrent && !isCurrent()) return null;
    if (options.includeCenterStats) drawCenterStats(context, model, this.localization);
    const labelsDrawn = await drawNodeBatches(
      renderable,
      (node) => this._drawStateLabel(context, node, model, frameOptions),
      isCurrent
    );
    if (!labelsDrawn) return null;
    return renderable.length;
  }

  _applyStaticLayerState(model) {
    if (!this.layers.edge) return;
    const opacity = String(getStaticEdgeOpacity(model));
    // The static canvas is now an opaque edge composite. Keep its CSS opacity
    // fixed so camera transforms never cause a second alpha-compositing pass;
    // the dim amount is painted into the same bitmap as the base and active
    // edge strokes.
    this.layers.edge.style.opacity = "1";
    this.layers.edge.dataset.baseEdgeOpacity = opacity;
    if (this.staticCanvas) {
      this.staticCanvas.style.opacity = "1";
      this.staticCanvas.dataset.edgeBaseOpacity = opacity;
    }
  }

  _updateSemanticButtons(model) {
    for (const node of model.nodes || []) {
      const button = this.semanticButtons.get(node.id);
      if (!button) continue;
      button.setAttribute("aria-label", node.label);
      button.title = node.label;
      button.dataset.unlockLabel = getUnlockConditionLabel(node.node);
      button.dataset.renderState = node.simulationVariant;
      button.dataset.nodeType = node.nodeType;
      button.setAttribute("aria-pressed", String(node.isSelected));
      button.classList.toggle("is-dimmed", Boolean(node.isDimmed));
    }
    const centerButton = this.layers.semantic?.querySelector?.("#tree-center-compendium-btn");
    if (centerButton) {
      const simulation = Boolean(model.isSimulation);
      centerButton.setAttribute("aria-label", simulation
        ? (this.localization?.t?.("compendium.simulationCenterTitle", {}, "骰子樹") || "骰子樹")
        : (this.localization?.t?.("compendium.open", {}, "開啟圖鑑") || "開啟圖鑑"));
      centerButton.setAttribute("aria-disabled", String(simulation));
      centerButton.tabIndex = simulation ? -1 : 0;
    }
  }

  _isViewportInside(bounds, viewportBounds) {
    return Boolean(bounds && viewportBounds
      && viewportBounds.left >= bounds.left
      && viewportBounds.top >= bounds.top
      && viewportBounds.right <= bounds.right
      && viewportBounds.bottom <= bounds.bottom);
  }

  _samePathSet(left, right) {
    if (!left || !right || left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
  }

  _makeSceneRequest(state, force = false, reason = "") {
    const model = this.model || this._buildModel(state);
    const targetResolution = this._resolveResolution(state);
    // Keep the committed raster bucket during an active gesture. The scene
    // transform can move continuously, while the settled request below can
    // still promote the bucket that covers the final display scale.
    const holdResolution = reason === "viewport"
      && this._isCameraMotionActive()
      && this.dynamicCanvas?.dataset.canvasReady === "true";
    const resolution = holdResolution ? this.currentResolution : targetResolution;
    // The one-tile ring is an asset prefetch contract, not a paint contract.
    // Rendering it into the dynamic surface would allocate multi-megapixel
    // canvases during every zoom bucket change and cause long compositor
    // stalls. Keep enough padding for node art and edge shadows instead.
    const bounds = this._getDynamicRenderBounds(state);
    const viewportBounds = this._viewportBounds(state);
    const visibleEntries = this.tileRepository?.getVisibleTileEntries?.(resolution, viewportBounds)
      || this.tileRepository?.getTileEntries?.(resolution, viewportBounds, { prefetchRadius: 0 }) || [];
    const renderEntries = this.tileRepository?.getTileEntries?.(resolution, bounds, { prefetchRadius: 0 }) || visibleEntries;
    const allEntries = this.tileRepository?.getTileEntries?.(resolution, viewportBounds, { prefetchRadius: 1 }) || visibleEntries;
    const visiblePaths = new Set(visibleEntries.map((entry) => String(entry.path)));
    const allPaths = new Set(allEntries.map((entry) => String(entry.path)));
    return {
      state,
      model,
      resolution,
      targetResolution,
      bounds,
      boundsKey: this._makeBoundsKey(bounds, resolution),
      viewportBounds,
      visibleEntries,
      renderEntries,
      allEntries,
      visiblePaths,
      allPaths,
      visibleKey: this._tileEntriesKey(visibleEntries, resolution),
      allKey: this._tileEntriesKey(allEntries, resolution),
      options: this._sceneOptions(model),
      revision: this._sceneRevision,
      epoch: this._renderEpoch,
      force,
      reason,
      viewportRevision: this._viewportRevision
    };
  }

  _tileEntriesKey(entries, resolution) {
    return `${resolution}|${(entries || []).map((entry) => String(entry.path)).sort((left, right) => left.localeCompare(right)).join("|")}`;
  }

  _currentFrameMatches(request) {
    const frameCoversViewport = this._isViewportInside(this._sceneFrameCoverage, request.viewportBounds);
    const frameHasVisibleTiles = [...request.visiblePaths].every((path) => this.visibleTileCanvases.has(path));
    const expectedPixelScale = this._dynamicPixelScale(request.state, request.resolution);
    const committedPixelScale = Number(this.dynamicCanvas?.dataset.pixelScale || 0);
    const pixelScaleMatches = Number.isFinite(committedPixelScale)
      && Math.abs(committedPixelScale - expectedPixelScale) < 0.001;
    return !request.force
      && this._sceneFrameModel === request.model
      && this._sceneFrameResolution === request.resolution
      && this.dynamicCanvas?.dataset.canvasReady === "true"
      && pixelScaleMatches
      && frameCoversViewport
      && frameHasVisibleTiles;
  }

  _isCameraMotionActive() {
    const body = typeof document !== "undefined" ? document.body : null;
    return Boolean(body?.classList.contains("is-zooming") || body?.classList.contains("is-navigating"));
  }

  _prefetchSceneResources(request) {
    if (!request || this._destroyed || typeof this.tileRepository?.prefetchImages !== "function") return;
    const variants = this._requiredVariants(request.model).sort((left, right) => left.localeCompare(right));
    const resolution = request.targetResolution || request.resolution;
    const allEntries = resolution === request.resolution
      ? request.allEntries
      : (this.tileRepository?.getTileEntries?.(resolution, request.viewportBounds, { prefetchRadius: 1 }) || []);
    const allKey = this._tileEntriesKey(allEntries, resolution);
    const key = [resolution, allKey, variants.join(","), request.model?.isSimulation ? "simulation" : "normal"].join("|");
    if (this._prefetchKeys.has(key)) return;
    this._prefetchKeys.add(key);
    const paths = [...allEntries].map((entry) => String(entry.path));
    for (const variant of variants) {
      paths.push(...this._atlasPageEntries(variant, resolution, request.model, request.bounds)
        .map((entry) => String(entry.path)));
    }
    const center = this.renderManifest?.center?.[request.model?.isSimulation ? "simulation" : "normal"]?.[`${resolution}x`];
    if (center?.path) paths.push(String(center.path));
    paths.push("icons/TreeShadow_sprite-185.png", "icons/TreeShadow_sprite-186.png");
    const assets = this.tileRepository.prefetchImages(paths);
    assets.catch(() => undefined).finally(() => {
      // Keep the key only while a load is active.  MapTileRepository already
      // owns the decoded-image LRU, so a later viewport request can cheaply
      // retry a failed or evicted entry without growing this set forever.
      this._prefetchKeys.delete(key);
    });
  }

  _warmSceneResources(request, { fullCoverage = false, shouldContinue = null } = {}) {
    if (!request || this._destroyed || typeof this.tileRepository?.warmImages !== "function") return Promise.resolve();
    const variants = this._requiredVariants(request.model).sort((left, right) => left.localeCompare(right));
    const resolution = request.targetResolution || request.resolution;
    const viewBox = this.renderManifest?.viewBox;
    const warmBounds = this._warmBounds(request, fullCoverage, viewBox);
    const visibleEntries = this._warmVisibleEntries(request, resolution, warmBounds, fullCoverage);
    const visibleKey = this._tileEntriesKey(visibleEntries, resolution);
    const paths = [...visibleEntries].map((entry) => String(entry.path));
    const atlasBounds = fullCoverage ? warmBounds : this._expandViewportBounds(request.viewportBounds);
    for (const variant of variants) {
      paths.push(...this._atlasPageEntries(variant, resolution, request.model, atlasBounds)
        .map((entry) => String(entry.path)));
    }
    const center = this.renderManifest?.center?.[request.model?.isSimulation ? "simulation" : "normal"]?.[`${resolution}x`];
    if (center?.path) paths.push(String(center.path));
    paths.push("icons/TreeShadow_sprite-185.png", "icons/TreeShadow_sprite-186.png");
    const key = [fullCoverage ? "coverage" : "viewport", resolution, visibleKey, variants.join(","), request.model?.isSimulation ? "simulation" : "normal"].join("|");
    if (this._warmSceneKeys.has(key)) return Promise.resolve();
    this._warmSceneKeys.add(key);
    const assets = this.tileRepository.warmImages(paths, {
      shouldContinue: () => !this._destroyed
        && !this._backgroundRendersPaused
        && !this._isCameraMotionActive()
        && (!shouldContinue || shouldContinue())
    });
    return assets.catch(() => undefined).finally(() => {
      this._warmSceneKeys.delete(key);
    });
  }

  _warmBounds(request, fullCoverage, viewBox) {
    if (fullCoverage && viewBox) return viewBox;
    return request.viewportBounds;
  }

  _warmVisibleEntries(request, resolution, warmBounds, fullCoverage) {
    if (fullCoverage) {
      return this.tileRepository?.getVisibleTileEntries?.(resolution, warmBounds)
        || this.tileRepository?.getTileEntries?.(resolution, warmBounds, { prefetchRadius: 0 }) || [];
    }
    if (resolution === request.resolution) return request.visibleEntries;
    return this.tileRepository?.getVisibleTileEntries?.(resolution, request.viewportBounds)
      || this.tileRepository?.getTileEntries?.(resolution, request.viewportBounds, { prefetchRadius: 0 }) || [];
  }

  _expandViewportBounds(bounds, padding = DYNAMIC_BOUNDS_PADDING) {
    const viewBox = this.renderManifest?.viewBox;
    if (!bounds) return viewBox || null;
    const left = Math.max(viewBox?.x ?? -Infinity, Number(bounds.left) - padding);
    const top = Math.max(viewBox?.y ?? -Infinity, Number(bounds.top) - padding);
    const right = Math.min((viewBox?.x ?? 0) + (viewBox?.width ?? Infinity), Number(bounds.right) + padding);
    const bottom = Math.min((viewBox?.y ?? 0) + (viewBox?.height ?? Infinity), Number(bounds.bottom) + padding);
    return { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }

  _scheduleInitialCoverageWarmup(request) {
    if (this._coverageWarmupScheduled || this._destroyed || request?.resolution !== 1 || request.model?.isSimulation) return;
    this._coverageWarmupScheduled = true;
    const run = () => {
      this._coverageWarmupHandle = null;
      if (this._destroyed || !this.renderManifest?.viewBox) return;
      // Coverage is a convenience for a later idle visit, not part of the
      // first interaction path.  If the user is already moving the camera,
      // wait until it settles instead of decoding dozens of off-screen images
      // beside a zoom or pan gesture.
      if (this._isCameraMotionActive()) {
        this._coverageWarmupHandle = setTimeout(run, 750);
        return;
      }
      const viewBox = this.renderManifest.viewBox;
      const warmRequest = {
        ...request,
        targetResolution: 1,
        resolution: 1,
        bounds: viewBox,
        viewportBounds: viewBox,
        visibleEntries: this.tileRepository?.getVisibleTileEntries?.(1, viewBox) || [],
        model: request.model
      };
      this._warmSceneResources(warmRequest, { fullCoverage: true }).catch(() => undefined);
    };
    // Do not compete with the first interaction window.  A fixed delay is
    // intentional here: requestIdleCallback may run immediately during a
    // short gap between startup frames, which is exactly when a first zoom
    // or drag is most likely to arrive.
    this._coverageWarmupHandle = setTimeout(run, 4000);
  }

  _adjacentResolutionTargets(resolution) {
    const available = (this.renderManifest?.tile?.scales || ["1x", "2x", "3x"])
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const current = Number(resolution) || available[0] || 1;
    const maxScale = Number(this.lastState?.viewport?.maxScale || this.lastState?.viewport?.scale || 1);
    const target = selectMapResolution({
      scale: maxScale,
      devicePixelRatio: this._getDevicePixelRatio(),
      available
    });
    const higher = available.filter((value) => value > current && value <= target);
    const lower = [...available].reverse().find((value) => value < current);
    return [...higher, lower].filter((value, index, values) => value !== undefined && values.indexOf(value) === index);
  }

  _cancelResolutionWarmup() {
    const handle = this._resolutionWarmupHandle;
    if (handle !== null) {
      if (handle.kind === "idle" && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle.id);
      } else {
        clearTimeout(handle.id);
      }
    }
    this._resolutionWarmupHandle = null;
    this._resolutionWarmupToken += 1;
    this._resolutionWarmupKey = "";
  }

  _scheduleResolutionWarmupTask(callback, timeout = 450) {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      return { kind: "idle", id: window.requestIdleCallback(callback, { timeout }) };
    }
    return { kind: "timeout", id: setTimeout(callback, 140) };
  }

  _scheduleAdjacentResolutionWarmup(request) {
    if (!request || this._destroyed) return;
    if (request.model?.hasFilter || request.model?.hasSelection || request.model?.hasPrereqHighlight) return;
    const targets = this._adjacentResolutionTargets(request.resolution);
    if (targets.length === 0) return;
    const key = [request.boundsKey, request.resolution, targets.join(","), request.model?.isSimulation ? "simulation" : "normal"].join("|");
    if (this._resolutionWarmupKey === key) return;
    this._cancelResolutionWarmup();
    const token = this._resolutionWarmupToken;
    let targetIndex = 0;
    const scheduleNext = (delay = 0) => {
      if (token !== this._resolutionWarmupToken || this._destroyed || targetIndex >= targets.length) {
        if (token === this._resolutionWarmupToken) this._resolutionWarmupKey = "";
        return;
      }
      const warm = () => {
        this._resolutionWarmupHandle = null;
        if (token !== this._resolutionWarmupToken || this._destroyed || this._isCameraMotionActive()) {
          if (token === this._resolutionWarmupToken) this._resolutionWarmupKey = "";
          return;
        }
        const targetResolution = targets[targetIndex];
        targetIndex += 1;
        const warmRequest = { ...request, targetResolution };
        this._prefetchSceneResources(warmRequest);
        this._warmSceneResources(warmRequest, {
          shouldContinue: () => token === this._resolutionWarmupToken
        }).then(() => {
          if (token !== this._resolutionWarmupToken || this._destroyed || this._isCameraMotionActive()) {
            if (token === this._resolutionWarmupToken) this._resolutionWarmupKey = "";
            return;
          }
          scheduleNext();
        });
      };
      if (delay > 0) {
        // Adjacent buckets are a convenience for a later gesture, not part of
        // the committed frame.  Give the first paint and the first likely
        // interaction a quiet window before starting image decode/upload work.
        this._resolutionWarmupHandle = { kind: "timeout", id: setTimeout(() => {
          this._resolutionWarmupHandle = null;
          if (token !== this._resolutionWarmupToken || this._destroyed || this._isCameraMotionActive()) {
            if (token === this._resolutionWarmupToken) this._resolutionWarmupKey = "";
            return;
          }
          this._resolutionWarmupHandle = this._scheduleResolutionWarmupTask(warm);
        }, delay) };
      } else {
        this._resolutionWarmupHandle = this._scheduleResolutionWarmupTask(warm);
      }
    };
    this._resolutionWarmupKey = key;
    // Leave a short quiet window after the commit before asking the browser to
    // decode/upload adjacent buckets. A user can start a gesture immediately
    // after the first paint; the interaction-start hook cancels this timer so
    // warmup never competes with that first RAF sequence.
    scheduleNext(ADJACENT_RESOLUTION_WARMUP_DELAY_MS);
  }

  _scheduleSceneFrame(state, { force = false, reason = "" } = {}) {
    if (this._destroyed || !this.renderManifest || !state?.viewport) return Promise.resolve(false);
    const request = this._makeSceneRequest(state, force, reason);
    this.desiredResolution = request.targetResolution || request.resolution;
    if (this._currentFrameMatches(request)) return Promise.resolve(true);
    // During any camera gesture the committed frame is deliberately kept
    // intact. Rebuilding a large dynamic Canvas for every intermediate
    // scale or pan makes the browser repeatedly resample incomplete
    // candidates and can leave the whole transformed scene soft on mobile.
    // The resource warm-up above continues in the background; the first
    // viewport request after the gesture guard is cleared commits the final
    // bounds and bucket atomically. This also keeps the pointermove path free
    // of Canvas allocation and node raster work.
    if (reason === "viewport"
      && typeof document !== "undefined"
      && this._isCameraMotionActive()
      && this.dynamicCanvas?.dataset.canvasReady === "true") {
      return Promise.resolve(true);
    }
    // A state change can arrive while a camera animation is already running
    // (for example a filter toggle followed by its automatic focus).  Do not
    // start a replacement frame with a moving viewport: the candidate would
    // compete with the animation and its bounds would be stale by the time it
    // could be committed. Keep only the newest request; the next viewport
    // tick, and the final settled tick, will consume it.
    if (reason !== "viewport"
      && typeof document !== "undefined"
      && this._isCameraMotionActive()
      && this.dynamicCanvas?.dataset.canvasReady === "true") {
      this._sceneQueuedRequest = request;
      return Promise.resolve(true);
    }
    // If there is no committed frame yet, retain the request during camera
    // motion so the first usable frame can still be built. Once a frame
    // exists, the branch above handles all gesture-time viewport updates.
    const previous = this._sceneQueuedRequest;
    this._sceneQueuedRequest = request;
    if (previous?.revision === request.revision && previous.model === request.model) {
      request.force ||= previous.force;
    }
    if (!this._sceneFramePromise) {
      this._sceneFramePromise = this._drainSceneFrames().finally(() => {
        this._sceneFramePromise = null;
        const queuedRequest = this._sceneQueuedRequest;
        if (queuedRequest?.state && !this._destroyed) {
          this._scheduleSceneFrame(queuedRequest.state, {
            force: queuedRequest.force,
            reason: queuedRequest.reason
          });
        }
      });
    }
    return this._sceneFramePromise;
  }

  async _drainSceneFrames() {
    while (this._sceneQueuedRequest && !this._destroyed) {
      const request = this._sceneQueuedRequest;
      this._sceneQueuedRequest = null;
      if (this._currentFrameMatches(request)) continue;
      await this._buildSceneFrame(request);
    }
    return true;
  }

  _requestIsCurrent(request) {
    const viewportCandidate = this._isViewportCandidateCurrent(request);
    if (this._destroyed
      || request.epoch !== this._renderEpoch
      || request.revision !== this._sceneRevision
      || (!viewportCandidate && request.viewportRevision !== this._viewportRevision)
      || this.model !== request.model) return false;
    const latest = this._sceneQueuedRequest;
    if (!latest) {
      const currentState = this.lastState || request.state;
      const expectedResolution = request.reason === "viewport"
        && this._isCameraMotionActive()
        && this.dynamicCanvas?.dataset.canvasReady === "true"
        ? this.currentResolution
        : this._resolveResolution(currentState);
      return expectedResolution === request.resolution
        && this._isViewportInside(request.bounds, this._viewportBounds(currentState));
    }
    if (viewportCandidate) {
      return latest.revision === request.revision
        && latest.model === request.model
        && latest.resolution === request.resolution
        && this._isViewportInside(request.bounds, this._viewportBounds(this.lastState || request.state))
        && [...latest.visiblePaths].every((path) => request.visiblePaths.has(path));
    }
    return latest.revision === request.revision
      && latest.model === request.model
      && latest.viewportRevision === request.viewportRevision
      && latest.viewportRevision === this._viewportRevision
      && latest.resolution === request.resolution
      && this._isViewportInside(request.bounds, latest.viewportBounds)
      && [...latest.visiblePaths].every((path) => request.visiblePaths.has(path));
  }

  _isViewportCandidateCurrent(request) {
    if (request?.reason !== "viewport" || !request.state?.viewport) return false;
    const currentState = this.lastState || request.state;
    if (!areViewportScalesEqual(request, currentState)) return false;
    if (request.model !== this.model || request.revision !== this._sceneRevision) return false;
    const expectedResolution = this._isCameraMotionActive()
      && this.dynamicCanvas?.dataset.canvasReady === "true"
      ? this.currentResolution
      : this._resolveResolution(currentState);
    if (expectedResolution !== request.resolution) return false;
    return this._isViewportInside(request.bounds, this._viewportBounds(currentState));
  }

  _createSceneSurface(ownerDocument, className, contextError) {
    const canvas = ownerDocument.createElement("canvas");
    canvas.className = className;
    canvas.setAttribute("aria-hidden", "true");
    const context = getCanvas2DContext(canvas);
    if (!context) {
      canvas.remove?.();
      throw new Error(contextError);
    }
    return { canvas, context };
  }

  async _loadSceneFrameAssets(request, loaded) {
    const renderEntries = request.renderEntries || request.allEntries || [];
    const loadCandidateTiles = renderEntries.map(async (entry) => {
      loaded.set(String(entry.path), await this.tileRepository.loadImage(entry.path));
    });
    await Promise.all([
      Promise.all(loadCandidateTiles),
      this._ensureAtlases(request.resolution, this._requiredVariants(request.model), request.model, request.bounds),
      this._ensureCenterImages(request.resolution, [request.model.isSimulation ? "simulation" : "normal"]),
      this._ensureCurrencyImages()
    ]);
    return renderEntries;
  }

  _createStaticSceneSurface(ownerDocument, request, renderEntries, loaded, tileSize, frame) {
    const surface = this._createSceneSurface(ownerDocument, "tree-static-surface", "Canvas static context is unavailable.");
    frame.staticCanvas = surface.canvas;
    const pixelScale = this._configureCanvas(surface.canvas, surface.context, request.bounds, request.resolution, request.state, request.boundsKey);
    drawEdgeComposite(
      surface.context,
      renderEntries,
      loaded,
      tileSize,
      request.bounds,
      request.model,
      {
        useFullMapEdgeDimMask: shouldUseFullMapEdgeDimMask(request.model),
        drawActiveEdgeLayer: false
      }
    );
    surface.canvas.dataset.canvasReady = "true";
    surface.canvas.dataset.motionStable = "true";
    surface.canvas.dataset.edgeComposite = "true";
    return { ...surface, pixelScale };
  }

  async _createNodeArtSurface(ownerDocument, request, frame) {
    const surface = this._createSceneSurface(ownerDocument, "tree-node-art-surface", "Canvas node art context is unavailable.");
    frame.nodeArtCanvas = surface.canvas;
    const pixelScale = this._configureCanvas(surface.canvas, surface.context, request.bounds, request.resolution, request.state, request.boundsKey);
    const renderableCount = (request.model?.nodes || [])
      .filter((node) => this._nodeIntersects(node, request.bounds)).length;
    if (renderableCount > 64) await yieldToNextFrame();
    const drawnArt = await this._drawNodeArtLayerAsync(
      surface.context,
      request.model,
      request.resolution,
      request.bounds,
      () => this._requestIsCurrent(request)
    );
    if (drawnArt === null) return { ...surface, pixelScale, drawnArt };
    surface.canvas.dataset.canvasReady = "true";
    surface.canvas.dataset.motionStable = "true";
    surface.canvas.dataset.nodeCount = String(drawnArt);
    surface.canvas.dataset.pressedNode = this._pressedNodeId || "";
    return { ...surface, pixelScale, drawnArt };
  }

  _createActiveEdgeSurface(ownerDocument, request, frame) {
    if (!hasActiveEdgeVisual(request.model)) return null;
    const surface = this._createSceneSurface(ownerDocument, "tree-active-edge-surface", "Canvas active edge context is unavailable.");
    frame.activeEdgeCanvas = surface.canvas;
    this._configureCanvas(surface.canvas, surface.context, request.bounds, request.resolution, request.state, request.boundsKey);
    drawActiveEdges(surface.context, request.model, {
      skipDimmed: shouldUseFullMapEdgeDimMask(request.model)
    });
    surface.canvas.dataset.canvasReady = "true";
    surface.canvas.dataset.motionStable = "true";
    surface.canvas.dataset.edgeComposite = "true";
    surface.canvas.dataset.activeEdgeCount = String(
      (request.model.edges || []).filter((edge) => isActiveEdge(edge, request.model)).length
      + (request.model.centerLinks || []).filter((link) => isActiveCenterLink(link, request.model)).length
    );
    return surface;
  }

  async _createDynamicSceneSurface(ownerDocument, request, nodeArtCanvas, staticPixelScale, nodeArtPixelScale, frame) {
    const className = this.dynamicCanvas?.className || "tree-dynamic-surface tree-node-surface";
    const surface = this._createSceneSurface(ownerDocument, className, "Canvas 2D context is unavailable.");
    frame.dynamicCanvas = surface.canvas;
    const pixelScale = this._configureCanvas(surface.canvas, surface.context, request.bounds, request.resolution, request.state, request.boundsKey);
    if (staticPixelScale !== pixelScale || nodeArtPixelScale !== pixelScale) throw new Error("Canvas candidate scales diverged.");
    if (!this._requestIsCurrent(request)) return { ...surface, pixelScale, drawnNodes: null };
    const drawnNodes = await this._drawCompleteDynamicFrameAsync(surface.context, request.model, request.resolution, request.bounds, request.state, request.options, {
      isCurrent: () => this._requestIsCurrent(request),
      nodeArtCanvas
    });
    if (drawnNodes === null) return { ...surface, pixelScale, drawnNodes };
    surface.canvas.dataset.canvasReady = "true";
    surface.canvas.dataset.motionPrefetchComplete = "true";
    surface.canvas.dataset.nodeCount = String(drawnNodes);
    surface.canvas.dataset.pressedNode = this._pressedNodeId || "";
    surface.canvas.dataset.renderedScale = String(request.resolution);
    surface.canvas.dataset.pixelScale = String(pixelScale);
    surface.canvas.dataset.nodeVisualSignature = this._nodeVisualSignature(request);
    surface.canvas.dataset.centerStatsSignature = this._centerStatsSignature(request.model, request.resolution);
    if (!this._requestIsCurrent(request)) return { ...surface, pixelScale, drawnNodes: null };
    return { ...surface, pixelScale, drawnNodes };
  }

  async _buildSceneFrame(request) {
    const ownerDocument = this.scene?.ownerDocument || document;
    if (this._redrawDynamicInPlace(request)) return true;
    const loaded = new Map();
    const frame = {
      dynamicCanvas: null,
      staticCanvas: null,
      nodeArtCanvas: null,
      activeEdgeCanvas: null
    };
    let committed = false;
    try {
      const renderEntries = await this._loadSceneFrameAssets(request, loaded);
      if (!this._requestIsCurrent(request)) return false;
      const tileSize = Number(this.renderManifest.tile?.logicalSize || 512);
      const staticLayer = this._createStaticSceneSurface(ownerDocument, request, renderEntries, loaded, tileSize, frame);
      const nodeArtLayer = await this._createNodeArtSurface(ownerDocument, request, frame);
      if (nodeArtLayer.drawnArt === null) return false;
      const activeEdgeLayer = this._createActiveEdgeSurface(ownerDocument, request, frame);
      const dynamicLayer = await this._createDynamicSceneSurface(
        ownerDocument,
        request,
        nodeArtLayer.canvas,
        staticLayer.pixelScale,
        nodeArtLayer.pixelScale,
        frame
      );
      if (dynamicLayer.drawnNodes === null) return false;
      this._commitSceneFrame(request, dynamicLayer.canvas, dynamicLayer.context, dynamicLayer.drawnNodes, {
        tileCanvases: new Map(request.visibleEntries.map((entry) => [String(entry.path), true])),
        staticCanvas: staticLayer.canvas,
        nodeArtCanvas: nodeArtLayer.canvas,
        activeEdgeCanvas: activeEdgeLayer?.canvas,
        activeEdgeContext: activeEdgeLayer?.context
      });
      committed = true;
      return true;
    } catch (error) {
      if (this._requestIsCurrent(request)) this._setRenderError(error);
      return false;
    } finally {
      if (!committed) {
        for (const canvas of [frame.dynamicCanvas, frame.staticCanvas, frame.nodeArtCanvas, frame.activeEdgeCanvas]) canvas?.remove?.();
      }
    }
  }

  _canRedrawDynamicInPlace(request) {
    const isStateOverlay = request?.reason === "state-overlay";
    const expectedPixelScale = this._dynamicPixelScale(request?.state, request?.resolution);
    const committedPixelScale = Number(this.dynamicCanvas?.dataset.pixelScale || 0);
    return Boolean(request?.force
      && request.reason !== "viewport"
      && (isStateOverlay || !this._isCameraMotionActive())
      && this.dynamicCanvas?.dataset.canvasReady === "true"
      && this.dynamicContext
      && this.staticCanvas
      && this.staticContext
      && this.nodeArtCanvas
      && this.nodeArtContext
      && this._renderBoundsKey === request.boundsKey
      && this._sceneFrameResolution === request.resolution
      && Number.isFinite(committedPixelScale)
      && (isStateOverlay || Math.abs(committedPixelScale - expectedPixelScale) < 0.001)
      && Boolean(this._sceneFrameModel?.isSimulation) === Boolean(request.model?.isSimulation)
      // Simulation rank mutations may change a node from a locked sprite to
      // its normal sprite. The dynamic labels/edges still have to paint in
      // the current committed frame while that replacement page is loading;
      // the state-overlay caller schedules the node-art retry separately.
      && (isStateOverlay || this._nodeArtKey === this._nodeArtSignature(request))
      && this._sceneFrameCoverage);
  }

  _redrawActiveEdgesInPlace(request) {
    if (!request || !this._sceneFrameCoverage) return false;
    const hasDedicatedSurface = this.activeEdgeCanvas
      && this.activeEdgeCanvas !== this.dynamicCanvas
      && this.activeEdgeCanvas !== this.staticCanvas;
    if (!hasActiveEdgeVisual(request.model)) {
      if (hasDedicatedSurface) {
        this.activeEdgeCanvas.remove?.();
        this.activeEdgeCanvas = this.staticCanvas;
        this.activeEdgeContext = this.staticContext;
      }
      return true;
    }
    if (!hasDedicatedSurface || !this.activeEdgeContext) return false;
    const isCurrent = request.reason === "state-overlay"
      ? this._isStateOverlayCurrent(request)
      : this._requestIsCurrent(request);
    if (!isCurrent) return false;
    const canvas = this.activeEdgeCanvas;
    const context = this.activeEdgeContext;
    const pixelScale = Number(canvas.dataset.pixelScale || this._dynamicPixelScale(request.state, request.resolution));
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(
      pixelScale,
      0,
      0,
      pixelScale,
      -request.bounds.left * pixelScale,
      -request.bounds.top * pixelScale
    );
    drawActiveEdges(context, request.model, {
      skipDimmed: shouldUseFullMapEdgeDimMask(request.model)
    });
    canvas.dataset.canvasReady = "true";
    canvas.dataset.motionStable = "true";
    canvas.dataset.edgeComposite = "true";
    canvas.dataset.renderedScale = String(request.resolution);
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.renderBounds = request.boundsKey;
    canvas.dataset.activeEdgeCount = String(
      (request.model.edges || []).filter((edge) => isActiveEdge(edge, request.model)).length
      + (request.model.centerLinks || []).filter((link) => isActiveCenterLink(link, request.model)).length
    );
    return true;
  }

  _ensureActiveEdgeSurfaceInPlace(request) {
    if (!request || !this.layers.frameHost || !this._sceneFrameCoverage) return false;
    const hasActiveVisual = hasActiveEdgeVisual(request.model);
    const current = this.activeEdgeCanvas;
    const hasDedicatedSurface = current
      && current !== this.dynamicCanvas
      && current !== this.staticCanvas;

    if (!hasActiveVisual) {
      if (hasDedicatedSurface) current.remove?.();
      this.activeEdgeCanvas = this.staticCanvas;
      this.activeEdgeContext = this.staticContext;
      return true;
    }
    if (hasDedicatedSurface && this.activeEdgeContext) return true;

    const ownerDocument = this.scene?.ownerDocument || document;
    const canvas = ownerDocument.createElement("canvas");
    canvas.className = "tree-active-edge-surface";
    canvas.setAttribute("aria-hidden", "true");
    const context = getCanvas2DContext(canvas);
    if (!context) return false;
    this._configureCanvas(canvas, context, request.bounds, request.resolution, request.state, request.boundsKey);
    const frameHost = this.layers.frameHost;
    const reference = [
      this.nodeArtCanvas,
      this.fullMapDimMaskCanvas,
      this.dynamicCanvas
    ].find((candidate) => candidate?.parentElement === frameHost);
    if (reference) frameHost.insertBefore(canvas, reference);
    else frameHost.appendChild(canvas);
    this.activeEdgeCanvas = canvas;
    this.activeEdgeContext = context;
    return true;
  }

  _redrawDynamicInPlace(request) {
    if (!this._canRedrawDynamicInPlace(request)) return false;
    if (!this._redrawActiveEdgesInPlace(request)) return false;
    const canvas = this.dynamicCanvas;
    const context = this.dynamicContext;
    const pixelScale = Number(canvas.dataset.pixelScale || request.resolution || 1);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(
      pixelScale,
      0,
      0,
      pixelScale,
      -request.bounds.left * pixelScale,
      -request.bounds.top * pixelScale
    );
    const drawnNodes = this._drawCompleteDynamicFrame(
      context,
      request.model,
      request.resolution,
      request.bounds,
      request.state,
      request.options,
      { nodeArtCanvas: this.nodeArtCanvas }
    );
    const isCurrent = request.reason === "state-overlay"
      ? this._isStateOverlayCurrent(request)
      : this._requestIsCurrent(request);
    if (!isCurrent) return false;
    canvas.dataset.canvasReady = "true";
    canvas.dataset.motionPrefetchComplete = "true";
    canvas.dataset.nodeCount = String(drawnNodes);
    canvas.dataset.pressedNode = this._pressedNodeId || "";
    canvas.dataset.renderedScale = String(request.resolution);
    canvas.dataset.pixelScale = String(pixelScale);
    canvas.dataset.nodeVisualSignature = this._nodeVisualSignature(request);
    canvas.dataset.centerStatsSignature = this._centerStatsSignature(request.model, request.resolution);
    this._commitSceneFrame(request, canvas, context, drawnNodes);
    return true;
  }

  _nodeArtSignature(request) {
    const renderable = (request?.model?.nodes || [])
      .filter((node) => this._nodeIntersects(node, request.bounds))
      .map((node) => `${node.id}:${node.simulationVariant || "normal"}`)
      .join(",");
    return [
      request?.resolution,
      request?.boundsKey,
      request?.model?.isSimulation ? "simulation" : "normal",
      this._pressedNodeId || "",
      renderable
    ].join("|");
  }

  _nodeVisualSignature(request) {
    return [
      request.revision,
      request.resolution,
      request.boundsKey,
      request.options.showNames ? 1 : 0,
      request.options.showCurrency ? 1 : 0,
      request.model.isSimulation ? 1 : 0,
      this._pressedNodeId || ""
    ].join("|");
  }

  _centerStatsSignature(model, resolution) {
    return [
      resolution,
      model?.locale || "",
      model?.isSimulation ? "simulation" : "normal",
      Object.entries(model?.factionLevels || {}).map(([key, value]) => `${key}:${value}`).join(",")
    ].join("|");
  }

  _appendCommittedFrameSurfaces(host, canvas, staticCanvas, nodeArtCanvas, activeEdgeCanvas) {
    const continuitySurfaces = [
      this.overviewCanvas,
      this.overviewEdgeCanvas,
      this.overviewNodeArtCanvas,
      this.overviewDynamicCanvas
    ];
    for (const surface of continuitySurfaces) {
      if (surface) host.appendChild(surface);
    }
    host.appendChild(staticCanvas);
    if (this.fullMapEdgeDimMaskCanvas) host.appendChild(this.fullMapEdgeDimMaskCanvas);
    if (activeEdgeCanvas) host.appendChild(activeEdgeCanvas);
    if (nodeArtCanvas) host.appendChild(nodeArtCanvas);
    if (this.fullMapDimMaskCanvas) host.appendChild(this.fullMapDimMaskCanvas);
    host.appendChild(canvas);
  }

  _replaceCommittedFrame(canvas, staticCanvas, nodeArtCanvas, activeEdgeCanvas) {
    const previousCanvas = this.dynamicCanvas;
    const replacingFrame = canvas !== previousCanvas && Boolean(staticCanvas);
    if (replacingFrame) {
      const ownerDocument = this.scene?.ownerDocument || document;
      const nextFrameHost = ownerDocument.createElement("div");
      nextFrameHost.className = "tree-frame-surface";
      nextFrameHost.setAttribute("aria-hidden", "true");
      // The overview is a full-map continuity base, not part of the bounded
      // candidate. Move the current surface into the replacement host first
      // so it shares the exact z-order and stacking context with the fixed
      // masks and the candidate frame.
      this._appendCommittedFrameSurfaces(nextFrameHost, canvas, staticCanvas, nodeArtCanvas, activeEdgeCanvas);
      const previousHost = this.layers.frameHost || previousCanvas;
      previousHost.replaceWith(nextFrameHost);
      this.layers.frameHost = nextFrameHost;
    } else if (canvas !== previousCanvas) {
      previousCanvas.replaceWith(canvas);
    }
    if (replacingFrame && !activeEdgeCanvas && this.activeEdgeCanvas) {
      this.activeEdgeCanvas.remove?.();
      this.activeEdgeCanvas = null;
      this.activeEdgeContext = null;
    }
    return replacingFrame;
  }

  _setCommittedStaticCanvas(request, staticCanvas) {
    if (!staticCanvas) return;
    this.staticCanvas = staticCanvas;
    this.staticContext = getCanvas2DContext(staticCanvas);
    this._staticFrameKey = request.boundsKey;
    this.staticCanvas.dataset.canvasReady = "true";
    this.staticCanvas.dataset.motionStable = "true";
    this.staticCanvas.dataset.edgeComposite = "true";
    this.staticCanvas.dataset.renderedScale = String(request.resolution);
    this.staticCanvas.dataset.pixelScale = String(this._dynamicPixelScale(request.state, request.resolution));
    this.staticCanvas.dataset.renderBounds = request.boundsKey;
  }

  _setCommittedActiveEdgeCanvas(request, activeEdgeCanvas, activeEdgeContext, staticCanvas) {
    if (!activeEdgeCanvas && !staticCanvas) return;
    if (!activeEdgeCanvas) {
      // Preserve the legacy diagnostic alias when this frame has no active
      // foreground paths. A later focused state will install a dedicated
      // transparent surface in the replacement frame.
      this.activeEdgeCanvas = this.staticCanvas;
      this.activeEdgeContext = this.staticContext;
      return;
    }
    this.activeEdgeCanvas = activeEdgeCanvas;
    this.activeEdgeContext = activeEdgeContext || getCanvas2DContext(activeEdgeCanvas);
    this.activeEdgeCanvas.dataset.canvasReady = "true";
    this.activeEdgeCanvas.dataset.motionStable = "true";
    this.activeEdgeCanvas.dataset.edgeComposite = "true";
    this.activeEdgeCanvas.dataset.renderedScale = String(request.resolution);
    this.activeEdgeCanvas.dataset.pixelScale = String(this._dynamicPixelScale(request.state, request.resolution));
    this.activeEdgeCanvas.dataset.renderBounds = request.boundsKey;
  }

  _setCommittedNodeArtCanvas(request, nodeArtCanvas) {
    if (!nodeArtCanvas) return;
    this.nodeArtCanvas = nodeArtCanvas;
    this.nodeArtContext = getCanvas2DContext(nodeArtCanvas);
    this._nodeArtKey = this._nodeArtSignature(request);
    this._nodeArtModel = request.model;
    this.nodeArtCanvas.dataset.canvasReady = "true";
    this.nodeArtCanvas.dataset.motionStable = "true";
    this.nodeArtCanvas.dataset.renderedScale = String(request.resolution);
    this.nodeArtCanvas.dataset.pixelScale = String(this._dynamicPixelScale(request.state, request.resolution));
    this.nodeArtCanvas.dataset.renderBounds = request.boundsKey;
    this.nodeArtCanvas.dataset.pressedNode = this._pressedNodeId || "";
  }

  _commitSceneFrame(request, canvas, context, drawnNodes, {
    tileCanvases = null,
    staticCanvas = null,
    nodeArtCanvas = null,
    activeEdgeCanvas = null,
    activeEdgeContext = null
  } = {}) {
    this._replaceCommittedFrame(canvas, staticCanvas, nodeArtCanvas, activeEdgeCanvas);
    this.visibleTileCanvases = tileCanvases ? new Map(tileCanvases) : this.visibleTileCanvases;
    this._setCanvasAliases(canvas, context, activeEdgeCanvas, activeEdgeContext);
    this._setCommittedStaticCanvas(request, staticCanvas);
    this._setCommittedActiveEdgeCanvas(request, activeEdgeCanvas, activeEdgeContext, staticCanvas);
    this._setCommittedNodeArtCanvas(request, nodeArtCanvas);
    this._renderBounds = request.bounds;
    this._renderBoundsKey = request.boundsKey;
    this._renderedTileKey = request.visibleKey;
    this._renderedVisibleTileKey = request.visibleKey;
    this.currentResolution = request.resolution;
    this.desiredResolution = request.resolution;
    this._sceneFrameModel = request.model;
    this._sceneFrameState = request.state;
    this._sceneFrameOptions = request.options;
    this._sceneFrameResolution = request.resolution;
    this._sceneFrameCoverage = request.bounds;
    if (request.renderEntries?.length) this._sceneFrameRenderEntries = [...request.renderEntries];
    else if (request.allEntries?.length) this._sceneFrameRenderEntries = [...request.allEntries];
    this._applyStaticLayerState(request.model);
    this._setOverviewVisibility(request.model);
    // Viewport-only candidates keep the same semantic model and button state;
    // walking all 239 buttons during a resolution promotion only adds style
    // work at the boundary where the new canvas is being uploaded.
    if (request.reason !== "viewport" && !FILTER_RENDER_ACTIONS.has(request.reason)) {
      this._updateSemanticButtons(request.model);
    }
    // Keep only the pages that can be painted by the committed frame.  The
    // repository also drops the corresponding decoded Image objects; without
    // this boundary, visiting several zoom buckets leaves all large atlas
    // textures resident and the browser may blur the entire composited map
    // under GPU memory pressure.
    this._scheduleAtlasTrim(request);
    this.scene.dataset.canvasReady = "true";
    this.scene.dataset.sceneRevision = String(request.revision);
    this.scene.dataset.renderedScale = String(request.resolution);
    this.nodeCanvas.dataset.nodeCount = String(drawnNodes);
    this._refreshSelectionAnimation(request.model, request.resolution);
    this._scheduleAdjacentResolutionWarmup(request);
  }

  prepareViewport(state) {
    if (this._destroyed || !state?.viewport || !this._initialAssetsReady) return;
    this.lastState = state;
    if (!this._isCameraMotionActive()) this._backgroundRendersPaused = false;
    this._setOverviewVisibility(this.model);
    // A viewport update is a new scene generation even when the render model
    // is unchanged.  This prevents an older resolution candidate from being
    // committed after a fast zoom reverses direction.
    this._viewportRevision += 1;
    if (this._isCameraMotionActive() && this.dynamicCanvas?.dataset.canvasReady === "true") {
      // Keep the camera RAF path strictly transform-only.  Tile lookup,
      // preload-link insertion, image decode, and Canvas allocation all wait
      // for the settled viewport request below; even low-priority image work
      // can steal a refresh interval from a 120 Hz pointer gesture.
      this.desiredResolution = this._resolveResolution(state);
      return;
    }
    this._scheduleSceneFrame(state, { force: false, reason: "viewport" }).catch((error) => this._setRenderError(error));
  }

  render(state, action = null) {
    if (this._destroyed || !this.scene) return;
    this.lastState = state;
    if (!this._initialAssetsReady) {
      this._pendingInitialRender = { state, action: null };
      return;
    }
    const isViewportAction = action?.type === "UPDATE_VIEWPORT" || action?.type === "SET_VIEWPORT";
    if (isViewportAction) {
      this.prepareViewport(state);
      return;
    }
    this._cancelResolutionWarmup();
    this.model = this._buildModel(state);
    this._sceneRevision += 1;
    // Dimming is a world-space overlay. Refresh it from the complete model at
    // action time; camera changes never rebuild or crop this surface.
    this._renderFullMapDimMask(this.model);
    this._renderFullMapEdgeDimMask(this.model);
    this.scene.classList.toggle("has-tree-focus", Boolean(this.model.hasFilter || this.model.hasSelection || this.model.hasPrereqHighlight));
    this.scene.classList.toggle("has-tree-filter", Boolean(this.model.hasFilter));
    this.scene.classList.toggle("has-tree-prereq", Boolean(this.model.hasPrereqHighlight));
    if (typeof document !== "undefined") document.body?.classList.toggle("simulation-mode", this.model.isSimulation);
    if (!FILTER_RENDER_ACTIONS.has(action?.type)) this._updateSemanticButtons(this.model);
    this._setOverviewVisibility(this.model);
    const overviewSignature = this._makeOverviewSignature(this.model);
    if (this._makeOverviewCompatibility(this.model) !== this._overviewCompatibility) {
      this._buildOverview(this.model, state).catch(() => undefined);
    } else if (overviewSignature !== this._overviewSignature) {
      // The overview is what remains visible when the camera outruns the
      // bounded candidate. Synchronize both stateful foreground surfaces in
      // this same state-dispatch turn, before automatic camera navigation can
      // move the viewport away from the candidate's coverage.
      const nodeArtSynced = this._redrawOverviewNodeArtInPlace(this.model);
      if (!nodeArtSynced) this._scheduleOverviewNodeArtRefresh(this.model);
      const edgeSynced = this._redrawOverviewEdgeInPlace(this.model);
      // Filter state is represented by the fixed full-map node/edge veils and
      // does not change the overview's labels or selected artwork. Avoid
      // clearing and repainting the whole 0.5x dynamic overview on every
      // filter click; the committed viewport frame is redrawn immediately.
      // Other state actions still repaint the overview in this dispatch turn.
      const dynamicSynced = FILTER_RENDER_ACTIONS.has(action?.type)
        ? true
        : this._redrawOverviewDynamicInPlace(this.model);
      if (nodeArtSynced && edgeSynced && dynamicSynced) this._overviewSignature = overviewSignature;
    }
    // Selection and prerequisite state only affect the dynamic content and
    // edge composite. Paint both against the already committed frame immediately,
    // including while the camera is travelling, instead of waiting for the
    // settled viewport request to rebuild the whole candidate.
    if (this._redrawStateOverlayInPlace(state, this.model, action?.type)) {
      return;
    }
    // A queued candidate may not be ready yet, but the selection runner must
    // still exist before the camera transition begins. The settled frame will
    // refresh its density later without changing the visible state.
    this._refreshSelectionAnimation(this.model, this.currentResolution || this._resolveResolution(state));
    this._scheduleSceneFrame(state, { force: true, reason: action?.type || "state" }).catch((error) => this._setRenderError(error));
  }

  _findSceneNode(nodeId) {
    if (nodeId === undefined || nodeId === null) return null;
    const key = String(nodeId);
    return this._sceneFrameModel?.nodesById?.get?.(key)
      || (this._sceneFrameModel?.nodes || []).find((node) => String(node.id) === key)
      || null;
  }

  _redrawPressedNodeInPlace(previousNodeId, nextNodeId) {
    const model = this._sceneFrameModel;
    const canvas = this.nodeArtCanvas;
    const context = this.nodeArtContext;
    const bounds = this._renderBounds;
    const resolution = this._sceneFrameResolution;
    const state = this._sceneFrameState || this.lastState;
    if (!model || !canvas || !context || !bounds || !resolution || !state
      || canvas.dataset.canvasReady !== "true"
      || this._renderBoundsKey !== canvas.dataset.renderBounds
      || this._sceneFrameResolution !== Number(canvas.dataset.renderedScale || resolution)) return false;

    const changedNodes = [this._findSceneNode(previousNodeId), this._findSceneNode(nextNodeId)].filter(Boolean);
    if (!changedNodes.length) return false;
    const padding = 24;
    const region = changedNodes.reduce((result, node) => ({
      left: Math.min(result.left, node.x - NODE_CELL_SIZE / 2 - padding),
      top: Math.min(result.top, node.y - NODE_CELL_SIZE / 2 - padding),
      right: Math.max(result.right, node.x + NODE_CELL_SIZE / 2 + padding),
      bottom: Math.max(result.bottom, node.y + NODE_CELL_SIZE / 2 + padding)
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    region.left = Math.max(bounds.left, region.left);
    region.top = Math.max(bounds.top, region.top);
    region.right = Math.min(bounds.right, region.right);
    region.bottom = Math.min(bounds.bottom, region.bottom);
    if (region.right <= region.left || region.bottom <= region.top) return false;

    const pixelScale = Number(canvas.dataset.pixelScale || this._dynamicPixelScale(state, resolution));
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(
      Math.max(0, Math.floor((region.left - bounds.left) * pixelScale)),
      Math.max(0, Math.floor((region.top - bounds.top) * pixelScale)),
      Math.ceil((region.right - region.left) * pixelScale),
      Math.ceil((region.bottom - region.top) * pixelScale)
    );
    context.setTransform(
      pixelScale,
      0,
      0,
      pixelScale,
      -bounds.left * pixelScale,
      -bounds.top * pixelScale
    );
    const redrawBounds = region;
    for (const node of model.nodes || []) {
      if (this._nodeIntersects(node, redrawBounds)) this._drawNodeArt(context, node, model, resolution);
    }
    context.restore();

    const dynamicCanvas = this.dynamicCanvas;
    const dynamicContext = this.dynamicContext;
    if (!dynamicCanvas || !dynamicContext || dynamicCanvas.dataset.canvasReady !== "true") return false;
    const options = this._sceneFrameOptions || this._sceneOptions(model);
    const dynamicPixelScale = Number(dynamicCanvas.dataset.pixelScale || pixelScale);
    dynamicContext.save();
    dynamicContext.setTransform(1, 0, 0, 1, 0, 0);
    dynamicContext.clearRect(0, 0, dynamicCanvas.width, dynamicCanvas.height);
    dynamicContext.setTransform(
      dynamicPixelScale,
      0,
      0,
      dynamicPixelScale,
      -bounds.left * dynamicPixelScale,
      -bounds.top * dynamicPixelScale
    );
    const drawnNodes = this._drawCompleteDynamicFrame(
      dynamicContext,
      model,
      resolution,
      bounds,
      state,
      options,
      { nodeArtCanvas: canvas }
    );
    dynamicContext.restore();
    const request = {
      revision: this._sceneRevision,
      resolution,
      bounds,
      boundsKey: this._renderBoundsKey,
      options,
      model
    };
    dynamicCanvas.dataset.canvasReady = "true";
    dynamicCanvas.dataset.motionPrefetchComplete = "true";
    dynamicCanvas.dataset.nodeCount = String(drawnNodes);
    dynamicCanvas.dataset.pressedNode = this._pressedNodeId || "";
    dynamicCanvas.dataset.renderedScale = String(resolution);
    dynamicCanvas.dataset.pixelScale = String(dynamicPixelScale);
    dynamicCanvas.dataset.nodeVisualSignature = this._nodeVisualSignature(request);
    dynamicCanvas.dataset.centerStatsSignature = this._centerStatsSignature(model, resolution);
    this._nodeArtKey = this._nodeArtSignature(request);
    this._nodeArtModel = model;
    canvas.dataset.pressedNode = this._pressedNodeId || "";
    if (this.selectionAnimationCanvas && this._selectionAnimationBounds) {
      this._drawSelectionAnimation(model, resolution);
    }
    return true;
  }

  setPressedNode(nodeId, pressed = true) {
    const nextId = pressed && nodeId !== undefined && nodeId !== null ? String(nodeId) : null;
    if (this._pressedNodeId === nextId) return;
    const previousId = this._pressedNodeId;
    this._pressedNodeId = nextId;
    this.pauseBackgroundRenders();
    this._sceneRevision += 1;
    if (this._redrawPressedNodeInPlace(previousId, nextId)) {
      this.scene?.setAttribute?.("data-pressed-node", nextId || "");
      this.scene && (this.scene.dataset.sceneRevision = String(this._sceneRevision));
      return;
    }
    if (this.dynamicCanvas) {
      this.dynamicCanvas.dataset.pressedNode = nextId || "";
      // Keep a diagnostic signature even when the first frame is not ready;
      // the fallback candidate below will paint the same state once assets are
      // available.
      this.dynamicCanvas.dataset.nodeVisualSignature = [
        this.dynamicCanvas.dataset.nodeVisualSignature || "",
        "press",
        nextId || ""
      ].join("|");
    }
    if (this.lastState && this._initialAssetsReady) {
      this._scheduleSceneFrame(this.lastState, { force: true, reason: "press" }).catch((error) => this._setRenderError(error));
    }
  }

  pauseBackgroundRenders({ preserveViewportCandidate = false, pauseWarmups = false } = {}) {
    // Resource promises remain useful, but a detached candidate must stop at
    // its next cooperative yield.  Otherwise a drag/selection can leave an
    // obsolete high-resolution frame consuming the main thread in parallel
    // with the camera gesture.
    if (preserveViewportCandidate) {
      this._cancelResolutionWarmup();
      this._cancelAtlasTrim();
      return;
    }
    this._renderEpoch += 1;
    this._sceneQueuedRequest = null;
    this._cancelResolutionWarmup();
    this._cancelAtlasTrim();
    if (pauseWarmups) this._backgroundRendersPaused = true;
  }

  refreshLocalizedLabels(localization = this.localization) {
    this.localization = localization || null;
    if (this.model && this.lastState) {
      this.model = this._buildModel(this.lastState);
      this._sceneRevision += 1;
      this._scheduleSceneFrame(this.lastState, { force: true, reason: "locale" }).catch((error) => this._setRenderError(error));
    }
  }

  getNodeScreenRect(nodeId) {
    const button = this.semanticButtons.get(String(nodeId));
    if (button?.getBoundingClientRect) return button.getBoundingClientRect();
    const node = this.model?.nodesById?.get(String(nodeId));
    if (!node) return null;
    const viewport = this.scene?.closest?.("#viewport,.map-viewport");
    const viewportRect = viewport?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const state = this.lastState?.viewport || { x: 0, y: 0, scale: 1 };
    const scale = Number(state.scale || 1);
    return {
      left: viewportRect.left + Number(state.x || 0) + (node.x - node.geometry.width / 2) * scale,
      top: viewportRect.top + Number(state.y || 0) + (node.y - node.geometry.height / 2) * scale,
      width: node.geometry.width * scale,
      height: node.geometry.height * scale,
      right: viewportRect.left + Number(state.x || 0) + (node.x + node.geometry.width / 2) * scale,
      bottom: viewportRect.top + Number(state.y || 0) + (node.y + node.geometry.height / 2) * scale
    };
  }

  _refreshSelectionAnimation(model, resolution) {
    const selected = (model?.nodes || []).filter((node) => node.isSelected || node.isLinkedSelected);
    const shouldAnimate = selected.some((node) => node.geometry?.shape !== "large-passive")
      && typeof requestAnimationFrame === "function"
      && !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    if (!shouldAnimate) {
      this._stopSelectionAnimation();
      this.selectionAnimationCanvas?.remove?.();
      this.selectionAnimationCanvas = null;
      this.selectionAnimationContext = null;
      this._selectionAnimationBounds = null;
      return;
    }
    const minX = Math.min(...selected.map((node) => node.x - 90)) - 8;
    const minY = Math.min(...selected.map((node) => node.y - 90)) - 8;
    const maxX = Math.max(...selected.map((node) => node.x + 90)) + 8;
    const maxY = Math.max(...selected.map((node) => node.y + 90)) + 8;
    const bounds = { left: minX, top: minY, right: maxX, bottom: maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    const ownerDocument = this.scene.ownerDocument || document;
    if (!this.selectionAnimationCanvas) {
      this.selectionAnimationCanvas = ownerDocument.createElement("canvas");
      this.selectionAnimationCanvas.className = "tree-selection-animation-surface";
      this.selectionAnimationCanvas.setAttribute("aria-hidden", "true");
      this.selectionAnimationContext = getCanvas2DContext(this.selectionAnimationCanvas);
      if (!this.selectionAnimationContext) return;
      this.layers.selectionAnimation.appendChild(this.selectionAnimationCanvas);
    }
    this._selectionAnimationBounds = bounds;
    this._selectionAnimationScale = this._dynamicPixelScale(this.lastState, resolution);
    this._drawSelectionAnimation(model, resolution);
    if (!this._selectionAnimating) this._startSelectionAnimation();
  }

  _drawSelectionAnimation(model, resolution) {
    const context = this.selectionAnimationContext;
    const bounds = this._selectionAnimationBounds;
    if (!context || !bounds) return;
    const scale = this._selectionAnimationScale;
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    // Resizing a Canvas reallocates its backing store and resets the drawing
    // state. The selection animation runs every RAF, so doing this
    // unconditionally was an avoidable source of compositor churn and could
    // make the frame appear only after the camera settled.
    if (this.selectionAnimationCanvas.width !== width) this.selectionAnimationCanvas.width = width;
    if (this.selectionAnimationCanvas.height !== height) this.selectionAnimationCanvas.height = height;
    const styles = {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`
    };
    for (const [property, value] of Object.entries(styles)) {
      if (this.selectionAnimationCanvas.style[property] !== value) this.selectionAnimationCanvas.style[property] = value;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.selectionAnimationCanvas.width, this.selectionAnimationCanvas.height);
    context.setTransform(scale, 0, 0, scale, -bounds.left * scale, -bounds.top * scale);
    this.selectionAnimationCanvas.dataset.modelRevision = String(this._sceneRevision);
    this.selectionAnimationCanvas.dataset.selectedNode = String(model.selectedNodeId || "");
    for (const node of model.nodes || []) {
      if (!node.isSelected && !node.isLinkedSelected) continue;
      const colors = COLORS[node.branch] || { runner: "#fff" };
      const pressed = String(this._pressedNodeId || "") === String(node.id);
      // The committed dynamic surface already contains the selected sprite
      // followed by its static selection frame. Keep this animation surface
      // runner-only; repainting the complete sprite here would sit above the
      // static frame and make that frame look as if it were beneath the node
      // base frame while the runner still appeared at the correct level.
      context.save();
      if (pressed) {
        context.translate(node.x, node.y);
        context.scale(0.93, 0.93);
        context.translate(-node.x, -node.y);
      }
      drawOutsideSelectionArtwork(context, node, () => drawSelectionRunner(context, node, colors, this._selectionPhase));
      context.restore();
    }
  }

  _startSelectionAnimation() {
    if (this._selectionAnimating || typeof requestAnimationFrame !== "function") return;
    this._selectionAnimating = true;
    this._selectionStartTimestamp = null;
    const tick = (now) => {
      if (!this._selectionAnimating || this._destroyed || !this.model) return;
      const timestamp = Number.isFinite(now) ? now : Date.now();
      if (this._selectionStartTimestamp === null) this._selectionStartTimestamp = timestamp;
      this._selectionPhase = ((timestamp - this._selectionStartTimestamp) / SELECTION_ANIMATION_DURATION_MS) % 1;
      this._drawSelectionAnimation(this.model, this.currentResolution);
      this._selectionFrame = requestAnimationFrame(tick);
    };
    this._selectionFrame = requestAnimationFrame(tick);
  }

  _stopSelectionAnimation() {
    if (this._selectionFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._selectionFrame);
    this._selectionFrame = null;
    this._selectionStartTimestamp = null;
    this._selectionAnimating = false;
  }

  async prepareShare({ pixelScale = 1 } = {}) {
    const scale = selectMapResolution({ scale: pixelScale, devicePixelRatio: 1 });
    await Promise.all([
      this._ensureAtlases(scale, ["normal", "dice-locked", "rune-locked", "passive-locked"]),
      this._ensureCenterImages(scale, ["normal", "simulation"]),
      this.tileRepository.preloadAll(scale),
      this._ensureCurrencyImages(),
      warmCanvasFonts()
    ]);
    return { scale };
  }

  renderToCanvas({ context, state = this.lastState, rect = { x: 0, y: 0, width: 1600, height: 780 }, pixelScale = 1, mode = "share" } = {}) {
    if (!context || !state || !this.renderManifest) return false;
    const model = this._buildModel(state);
    const viewBox = this.renderManifest.viewBox;
    const fit = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
    const offsetX = rect.x + (rect.width - viewBox.width * fit) / 2;
    const offsetY = rect.y + (rect.height - viewBox.height * fit) / 2;
    const resolution = selectMapResolution({ scale: pixelScale, devicePixelRatio: 1 });
    const options = this._sceneOptions(model, mode);
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(fit, fit);
    const tileSize = Number(this.renderManifest.tile?.logicalSize || 512);
    const tiles = this.renderManifest.tile?.tiles?.[`${resolution}x`]?.files || [];
    const loaded = new Map();
    for (const entry of tiles) {
      const image = this.tileRepository.getCachedImage(entry.path);
      if (image) loaded.set(String(entry.path), image);
    }
    if (loaded.size === tiles.length) {
      drawEdgeComposite(context, tiles, loaded, tileSize, viewBox, model);
    } else {
      context.fillStyle = SIMULATION_OCCLUSION_FILL;
      context.fillRect(viewBox.x, viewBox.y, viewBox.width, viewBox.height);
      for (const entry of tiles) {
        const image = loaded.get(String(entry.path));
        if (image) context.drawImage(image, entry.column * tileSize, entry.row * tileSize, Number(entry.width || tileSize), Number(entry.height || tileSize));
      }
      drawActiveEdges(context, model);
    }
    this._drawCompleteDynamicFrame(context, model, resolution, viewBox, state, options);
    context.restore();
    return true;
  }

  _setRenderError(error) {
    if (this._destroyed) return;
    const message = error?.message || "Canvas render failed";
    this._renderError = error instanceof Error ? error : new Error(message);
    this.scene?.setAttribute?.("data-render-error", message);
    this.scene?.classList?.add("has-render-error");
    this.onError?.(this._renderError);
    if (typeof CustomEvent !== "undefined") {
      this.scene?.dispatchEvent?.(new CustomEvent("rd2:canvas-render-error", { detail: { error } }));
    }
  }

  destroy() {
    this._destroyed = true;
    this._initializationToken += 1;
    this._renderEpoch += 1;
    this._overviewBuildToken += 1;
    this._overviewNodeArtRefreshToken += 1;
    this._stateNodeArtRefreshToken += 1;
    this._sceneQueuedRequest = null;
    this._cancelResolutionWarmup();
    this._cancelAtlasTrim();
    if (typeof document !== "undefined") {
      document.removeEventListener("rd2:viewport-interaction-start", this._boundViewportInteractionStart);
    }
    if (this._coverageWarmupHandle !== null) clearTimeout(this._coverageWarmupHandle);
    this._coverageWarmupHandle = null;
    this._stopSelectionAnimation();
    this._selectionAnimationBounds = null;
    this.selectionAnimationCanvas = null;
    this.selectionAnimationContext = null;
    this.semanticButtons.clear();
    this.atlasImages.clear();
    this.atlasImagePaths.clear();
    this.centerImages.clear();
    this.currencyImages.clear();
    this.visibleTileCanvases.clear();
    this.tileLayer = null;
    this.tileRepository?.destroy?.();
    this.appShell?.classList?.remove("canvas-map-mode");
    this.appShell = null;
    Object.values(this.layers).forEach((layer) => layer?.remove?.());
    this.layers = {};
    this.scene = null;
    this.model = null;
    this.lastState = null;
    this.dynamicCanvas = null;
    this.dynamicContext = null;
    this.overviewCanvas = null;
    this.overviewContext = null;
    this.overviewEdgeCanvas = null;
    this.overviewEdgeContext = null;
    this.overviewNodeArtCanvas = null;
    this.overviewNodeArtContext = null;
    this._overviewNodeArtModel = null;
    this._overviewNodeArtSignature = "";
    this._overviewNodeArtRefreshToken = 0;
    this._overviewNodeArtRefreshPromise = null;
    this.overviewDynamicCanvas = null;
    this.overviewDynamicContext = null;
    this._overviewSignature = "";
    this._overviewCompatibility = "";
    this._overviewBuildPromise = null;
    this.staticCanvas = null;
    this.staticContext = null;
    this._sceneFrameRenderEntries = [];
    this._stateNodeArtRefreshToken = 0;
    this._stateNodeArtRefreshPromise = null;
    this._staticFrameKey = "";
    this.nodeArtCanvas = null;
    this.nodeArtContext = null;
    this._nodeArtModel = null;
    this._nodeArtKey = "";
    this.fullMapDimMaskCanvas = null;
    this.fullMapDimMaskContext = null;
    this._fullMapDimMaskModel = null;
    this._fullMapDimMaskSignature = "";
    this._fullMapDimMaskActive = false;
    this._fullMapDimMaskNodes = [];
    this.fullMapEdgeDimMaskCanvas = null;
    this.fullMapEdgeDimMaskContext = null;
    this._fullMapEdgeDimMaskModel = null;
    this._fullMapEdgeDimMaskSignature = "";
    this._fullMapEdgeDimMaskActive = false;
    this.nodeCanvas = null;
    this.nodeContext = null;
    this.activeEdgeCanvas = null;
    this.activeEdgeContext = null;
    this.centerCanvas = null;
    this.centerContext = null;
    this.centerStatsCanvas = null;
    this.centerStatsContext = null;
    this.stateCanvas = null;
    this.stateContext = null;
    this.selectionCanvas = null;
    this.selectionContext = null;
    this._readyPromise = null;
    this._initialAssetsReady = false;
    this._backgroundRendersPaused = false;
    this._pendingInitialRender = null;
    this._prefetchKeys.clear();
    this._warmSceneKeys.clear();
  }
}
