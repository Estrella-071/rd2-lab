import { getNodeMap, isInitialSimulationNode } from "../domain/simulation_plan.js";
import { computeUpstreamTopologyPath } from "../domain/dag_topology.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";

export const SHARE_IMAGE_LOGICAL_SIZE = Object.freeze({ width: 1600, height: 1000 });

const imageCache = new Map();
const snapshotImageDataCache = new Map();
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/**
 * Resolve external SVG image references before the SVG is moved into a Blob.
 * Relative URLs resolve against the Blob URL after serialization, so they
 * would otherwise point at a non-existent `blob:` path and disappear from
 * the exported share image.
 *
 * @param {SVGElement} svg
 * @param {string} [baseUrl]
 * @returns {number} number of rewritten references
 */
export function resolveSnapshotImageReferences(svg, baseUrl = null) {
  if (!svg || typeof svg.querySelectorAll !== "function") return 0;

  const documentBase = typeof document !== "undefined" ? document.baseURI : "";
  const windowBase = typeof window !== "undefined" ? window.location?.href : "";
  const resolvedBase = baseUrl || (documentBase && documentBase !== "about:blank" ? documentBase : windowBase);
  if (!resolvedBase) return 0;

  let rewritten = 0;
  svg.querySelectorAll("image").forEach((image) => {
    for (const attribute of ["href", "xlink:href"]) {
      const value = image.getAttribute(attribute);
      if (!value || value.startsWith("#") || /^(?:data|blob):/i.test(value)) continue;

      let absoluteUrl;
      try {
        absoluteUrl = new URL(value, resolvedBase).href;
      } catch {
        continue;
      }
      if (absoluteUrl === value) continue;

      if (attribute === "xlink:href" && typeof image.setAttributeNS === "function") {
        image.setAttributeNS(XLINK_NAMESPACE, attribute, absoluteUrl);
      } else {
        image.setAttribute(attribute, absoluteUrl);
      }
      rewritten += 1;
    }
  });
  return rewritten;
}

function readBlobAsDataUrl(blob) {
  if (typeof FileReader === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function loadSnapshotImageDataUrl(url) {
  if (snapshotImageDataCache.has(url)) return snapshotImageDataCache.get(url);
  const promise = (async () => {
    if (typeof fetch !== "function") return null;
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
      if (!response.ok) return null;
      return readBlobAsDataUrl(await response.blob());
    } catch {
      return null;
    }
  })();
  snapshotImageDataCache.set(url, promise);
  return promise;
}

async function inlineSnapshotImageReferences(svg) {
  resolveSnapshotImageReferences(svg);
  const imagesByUrl = new Map();
  svg.querySelectorAll("image").forEach((image) => {
    const urls = new Set();
    for (const attribute of ["href", "xlink:href"]) {
      const value = image.getAttribute(attribute);
      if (value && /^(?:https?:)\/\//i.test(value)) urls.add(value);
    }
    for (const url of urls) {
      if (!imagesByUrl.has(url)) imagesByUrl.set(url, []);
      imagesByUrl.get(url).push(image);
    }
  });

  await Promise.all([...imagesByUrl.entries()].map(async ([url, images]) => {
    const dataUrl = await loadSnapshotImageDataUrl(url);
    if (!dataUrl) return;
    for (const image of images) {
      image.setAttribute("href", dataUrl);
      if (typeof image.setAttributeNS === "function") {
        image.setAttributeNS(XLINK_NAMESPACE, "xlink:href", dataUrl);
      } else {
        image.setAttribute("xlink:href", dataUrl);
      }
    }
  }));
}

function loadImageAsync(src) {
  if (typeof Image === "undefined" || !src) return Promise.resolve(null);
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function buildShareImageLayout({ width = SHARE_IMAGE_LOGICAL_SIZE.width, height = SHARE_IMAGE_LOGICAL_SIZE.height, scale = 2 } = {}) {
  const logicalWidth = Math.max(800, Math.floor(Number(width) || SHARE_IMAGE_LOGICAL_SIZE.width));
  const logicalHeight = Math.max(600, Math.floor(Number(height) || SHARE_IMAGE_LOGICAL_SIZE.height));
  const pixelScale = Math.max(1, Math.min(4, Number(scale) || 2));
  return {
    width: logicalWidth * pixelScale,
    height: logicalHeight * pixelScale,
    logicalWidth,
    logicalHeight,
    scale: pixelScale
  };
}

function getSimulationRankEntries(ranks) {
  if (ranks instanceof Map) return [...ranks.entries()];
  if (Array.isArray(ranks)) return ranks;
  return Object.entries(ranks || {});
}

function positiveSimulationRankIds(ranks) {
  const entries = getSimulationRankEntries(ranks);
  return new Set(entries
    .filter(([, rank]) => Number.isFinite(Number(rank)) && Number(rank) > 0)
    .map(([id]) => String(id)));
}

/** Resolve which simulator nodes and edges are visibly unlocked in a share image. */
export function computeShareRenderUnlockState(simulation = {}, treeData = {}) {
  const nodesMap = getNodeMap(treeData);
  const preUnlockedIds = new Set();
  nodesMap.forEach((node, id) => {
    if (isInitialSimulationNode(node)) preUnlockedIds.add(String(id));
  });

  const allocatedIds = positiveSimulationRankIds(simulation?.ranks);
  const manualIds = [...allocatedIds].filter((id) => !preUnlockedIds.has(id));
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

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-TW");
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawText(ctx, text, x, y, {
  size,
  color,
  weight = 600,
  align = "left",
  strokeColor = null,
  strokeWidth = 0
} = {}) {
  ctx.font = `${weight} ${size}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    ctx.strokeText(String(text || ""), x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(String(text || ""), x, y);
}

const FACTION_COLORS = {
  1: "#7ee352",
  2: "#f6c445",
  3: "#50b5ff",
  4: "#baa8e5",
  5: "#d656ff"
};

function getBranchColor(branch) {
  return FACTION_COLORS[Number(branch || 1)] || "#d5c6eb";
}

function getShareTeamCount(team1, team2) {
  if (team2.length > 0) return 2;
  if (team1.length > 0) return 1;
  return 0;
}

function calculateTreeAreaBottom(teamCount, height) {
  if (teamCount === 2) return height - 180;
  if (teamCount === 1) return height - 110;
  return height - 40;
}

async function renderCompactTeamRow(ctx, nodesMap, teamDice, teamTitle, startY) {
  const rowX = 48;
  const rowW = 5 * 74 + 110;
  const rowH = 74;

  ctx.fillStyle = "rgba(18, 14, 28, 0.92)";
  drawRoundedRect(ctx, rowX, startY, rowW, rowH, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, rowX, startY, rowW, rowH, 14);
  ctx.stroke();

  ctx.fillStyle = "#8c67e8";
  drawRoundedRect(ctx, rowX + 12, startY + 22, 68, 30, 8);
  ctx.fill();
  drawText(ctx, teamTitle, rowX + 46, startY + 37, { size: 13, color: "#ffffff", weight: 850, align: "center" });

  for (let index = 0; index < 5; index += 1) {
    const entry = teamDice[index];
    const node = entry ? nodesMap.get(entry.id || entry) : null;
    const slotX = rowX + 90 + index * 72;
    const slotY = startY + 8;
    const slotSize = 58;

    const branchColor = node ? getBranchColor(node.branch) : "rgba(255, 255, 255, 0.08)";
    ctx.fillStyle = node ? "rgba(35, 26, 56, 0.9)" : "rgba(20, 16, 30, 0.6)";
    drawRoundedRect(ctx, slotX, slotY, slotSize, slotSize, 10);
    ctx.fill();
    ctx.strokeStyle = branchColor;
    ctx.lineWidth = node ? 2 : 1;
    drawRoundedRect(ctx, slotX, slotY, slotSize, slotSize, 10);
    ctx.stroke();

    if (!node) {
      drawText(ctx, String(index + 1), slotX + slotSize / 2, slotY + slotSize / 2, { size: 16, color: "#5d4d7a", weight: 800, align: "center" });
      continue;
    }

    const iconFilename = resolveNode3Icon(node) || "Dice_Fire3.png";
    const image = await loadImageAsync(`icons/${iconFilename}`);
    if (image) ctx.drawImage(image, slotX + 5, slotY + 5, slotSize - 10, slotSize - 10);

    ctx.fillStyle = "#f5d358";
    ctx.beginPath();
    ctx.arc(slotX + 10, slotY + 10, 8, 0, Math.PI * 2);
    ctx.fill();
    drawText(ctx, String(index + 1), slotX + 10, slotY + 10, { size: 10, color: "#1a1228", weight: 900, align: "center" });

    const cleanName = (node.name_zh || node.name || "").replace(/骰子$/, "");
    drawText(ctx, cleanName, slotX + slotSize / 2, slotY + slotSize + 9, { size: 11, color: "#e9dcff", weight: 700, align: "center" });
  }
}

async function renderShareTeams(ctx, nodesMap, team1, team2, teamCount, height, teamLabels = {}) {
  const labels = {
    team1: teamLabels.team1 || "隊伍 1",
    team2: teamLabels.team2 || "隊伍 2"
  };
  if (teamCount === 1) {
    await renderCompactTeamRow(ctx, nodesMap, team1, labels.team1, height - 94);
    return;
  }
  if (teamCount === 2) {
    await renderCompactTeamRow(ctx, nodesMap, team1, labels.team1, height - 168);
    await renderCompactTeamRow(ctx, nodesMap, team2, labels.team2, height - 86);
  }
}

function calculateSnapshotViewBox(clonedSvg, targetWidth, targetHeight) {
  const points = [{ x: 2000, y: 1700 }];
  clonedSvg.querySelectorAll(".node.is-sim-unlocked, .tree-center").forEach((node) => {
    const transform = node.getAttribute("transform") || "";
    const match = /translate\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/.exec(transform);
    if (!match) return;
    const x = Number.parseFloat(match[1]);
    const y = Number.parseFloat(match[2]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) points.push({ x, y });
  });

  const padding = 280;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  let spanX = Math.max(1400, maxX - minX);
  let spanY = Math.max(850, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const targetAspect = targetWidth / targetHeight;
  if (spanX / spanY < targetAspect) spanX = spanY * targetAspect;
  else spanY = spanX / targetAspect;
  return [
    Math.round(centerX - spanX / 2),
    Math.round(centerY - spanY / 2),
    Math.round(spanX),
    Math.round(spanY)
  ].join(" ");
}

function applySnapshotSimulationVisibility(clonedSvg, renderState) {
  if (!clonedSvg || !renderState) return;
  const { preUnlockedIds, renderUnlockedIds } = renderState;
  clonedSvg.querySelectorAll(".node[data-node-id]").forEach((node) => {
    const id = String(node.dataset.nodeId || "");
    if (!preUnlockedIds.has(id) || renderUnlockedIds.has(id)) return;
    node.classList.remove("is-sim-unlocked", "is-sim-visible", "is-selected", "is-linked-selected", "is-sim-special");
    node.classList.add("is-sim-locked");
  });

  clonedSvg.querySelectorAll(".node-simulation-occlusion[data-occlusion-for]").forEach((occlusion) => {
    const id = String(occlusion.dataset.occlusionFor || "");
    if (!preUnlockedIds.has(id) || renderUnlockedIds.has(id)) return;
    occlusion.classList.remove("is-sim-special", "is-selected", "is-linked-selected");
    occlusion.classList.add("is-sim-locked");
  });

  clonedSvg.querySelectorAll("path.edge, line.edge, .tree-edge, [data-edge-key]").forEach((edge) => {
    const startId = String(edge.dataset.startNodeId || "");
    const endId = String(edge.dataset.endNodeId || "");
    if (!startId || !endId) return;
    const isVisiblePath = renderUnlockedIds.has(startId) && renderUnlockedIds.has(endId);
    edge.classList.toggle("is-simulation-active-edge", isVisiblePath);
    edge.classList.toggle("is-simulation-locked-edge", !isVisiblePath);
  });
}

function collectSnapshotCss(baseCss) {
  let cssText = baseCss;
  if (typeof document === "undefined" || !document.styleSheets) return cssText;
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const ruleText = rule.cssText || "";
        if (/\burl\s*\(/i.test(ruleText)) continue;
        cssText += `${ruleText}\n`;
      }
    } catch (error) {
      if (error?.name !== "SecurityError") throw error;
    }
  }
  return cssText;
}

export function buildSimulationSnapshotCss() {
  return `
    .cost-badge { display: none !important; }
    .node-simulation-occlusion-layer { display: block !important; pointer-events: none !important; }
    .node-simulation-occlusion { display: none !important; pointer-events: none !important; }
    .node-simulation-occlusion.is-sim-locked:not(.is-selected):not(.is-linked-selected),
    .node-simulation-occlusion.is-sim-special:not(.is-selected):not(.is-linked-selected) { display: block !important; }
    .node.is-sim-locked.node-type-dice:not(.is-selected):not(.is-linked-selected),
    .node.is-sim-locked.node-type-perk:not(.is-selected):not(.is-linked-selected) { opacity: 0.52 !important; }
    .node.is-sim-locked.node-type-dice:not(.is-selected):not(.is-linked-selected) .node-body .node-icon,
    .node.is-sim-locked.node-type-perk:not(.is-selected):not(.is-linked-selected) .node-body .node-icon { filter: grayscale(1) brightness(0.6) !important; }
    .node.is-sim-locked.node-type-dice-rune:not(.is-selected):not(.is-linked-selected) { opacity: 0.18 !important; filter: none !important; }
    .node.is-sim-locked.node-type-player-passive:not(.is-selected):not(.is-linked-selected) { opacity: 0.52 !important; filter: none !important; }
    .node.is-sim-special:not(.is-selected):not(.is-linked-selected) { opacity: 0.34 !important; filter: none !important; }
    .node.is-sim-locked.node-type-player-passive:not(.is-selected):not(.is-linked-selected) .node-body > circle,
    .node.is-sim-special.node-type-player-passive:not(.is-selected):not(.is-linked-selected) .node-body > circle { fill: #5c4d83 !important; }
    .node.is-sim-locked.is-selected,
    .node.is-sim-locked.is-linked-selected,
    .node.is-sim-special.is-selected,
    .node.is-sim-special.is-linked-selected { opacity: 1 !important; filter: none !important; }
    .node.is-sim-unlocked { opacity: 1 !important; filter: none !important; }
    .node.is-sim-unlocked .node-icon,
    .node.is-sim-unlocked .node-icon-flat,
    .node.is-sim-unlocked .node-icon-deep { filter: none !important; }
    path.is-simulation-locked-edge { opacity: 0.06 !important; }
    path.is-simulation-active-edge { opacity: 0.98 !important; stroke-width: 4.5px !important; filter: drop-shadow(0 0 6px rgba(205, 164, 255, 0.6)) !important; }
    .tree-center { opacity: 1 !important; }
  `;
}

/** Snapshot the tree used by the share image. */
async function snapshotRealSvgTreeAsync({ svgElement, targetWidth = 1600, targetHeight = 780, renderState = null } = {}) {
  const svg = svgElement || (typeof document !== "undefined" ? document.querySelector("#scene svg") : null);
  if (!svg) return null;

  // Clone the current SVG.
  const clonedSvg = svg.cloneNode(true);
  await inlineSnapshotImageReferences(clonedSvg);

  // Remove cost badges from the share image.
  clonedSvg.querySelectorAll(".cost-badge").forEach((el) => el.remove());

  applySnapshotSimulationVisibility(clonedSvg, renderState);

  // Set the viewBox used by the image.
  clonedSvg.setAttribute("viewBox", calculateSnapshotViewBox(clonedSvg, targetWidth, targetHeight));
  clonedSvg.setAttribute("width", String(targetWidth));
  clonedSvg.setAttribute("height", String(targetHeight));

  // Include the styles needed by the snapshot.
  const cssText = collectSnapshotCss(buildSimulationSnapshotCss());

  let defs = clonedSvg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    clonedSvg.insertBefore(defs, clonedSvg.firstChild);
  }
  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = cssText;
  defs.appendChild(styleEl);

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(clonedSvg);
  if (!/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svgString)) {
    svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/.test(svgString)) {
    svgString = svgString.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ img, url, width: targetWidth, height: targetHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Create a share image from the current tree. */
export async function generateSimulationShareImage({
  simulation,
  treeData,
  title = "骰子樹模擬配點",
  currencyLabels = {},
  teamLabels = {},
  watermark = "Random Dice 2 Lab",
  width,
  height,
  scale,
  canvas: suppliedCanvas,
  svgElement = null
} = {}) {
  const rawDice = Array.isArray(simulation?.team?.dice) ? simulation.team.dice.filter(Boolean) : [];
  const team1 = rawDice.slice(0, 5);
  const team2 = rawDice.slice(5, 10);
  const teamCount = getShareTeamCount(team1, team2);

  const layout = buildShareImageLayout({ width, height, scale });
  if (typeof document === "undefined" && !suppliedCanvas) {
    return { ok: false, error: "canvas-unavailable", layout };
  }

  let canvas = suppliedCanvas;
  try {
    if (!canvas) canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: "context-unavailable", layout };
    if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(layout.scale, 0, 0, layout.scale, 0, 0);
    const { logicalWidth: w, logicalHeight: h } = layout;

    // Background.
    ctx.fillStyle = "#0d0b17";
    ctx.fillRect(0, 0, w, h);

    // Border.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 16, 16, w - 32, h - 32, 20);
    ctx.stroke();

    // Header.
    drawText(ctx, title, 48, 56, { size: 28, color: "#ffffff", weight: 800 });

    const spent = simulation?.spent || { gold: 0, core: 0 };
    const goldX = w - 360;
    ctx.fillStyle = "rgba(24, 18, 38, 0.85)";
    drawRoundedRect(ctx, goldX, 36, 150, 42, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 215, 89, 0.35)";
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, goldX, 36, 150, 42, 10);
    ctx.stroke();
    drawText(ctx, currencyLabels.gold || "金幣", goldX + 16, 57, { size: 13, color: "#ffd759", weight: 700 });
    drawText(ctx, formatNumber(spent.gold), goldX + 136, 57, { size: 18, color: "#ffffff", weight: 800, align: "right" });

    const coreX = w - 194;
    ctx.fillStyle = "rgba(24, 18, 38, 0.85)";
    drawRoundedRect(ctx, coreX, 36, 146, 42, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(133, 232, 255, 0.35)";
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, coreX, 36, 146, 42, 10);
    ctx.stroke();
    drawText(ctx, currencyLabels.core || "核心", coreX + 16, 57, { size: 13, color: "#85e8ff", weight: 700 });
    drawText(ctx, formatNumber(spent.core), coreX + 132, 57, { size: 18, color: "#ffffff", weight: 800, align: "right" });

    // Tree.
    const treeAreaTop = 96;
    const treeAreaBottom = calculateTreeAreaBottom(teamCount, h);
    const treeAreaH = treeAreaBottom - treeAreaTop;
    const treeAreaW = w - 80;
    const treeAreaX = 40;

    const svgSnapshot = await snapshotRealSvgTreeAsync({
      svgElement,
      targetWidth: Math.max(1, Math.round(treeAreaW * layout.scale)),
      targetHeight: Math.max(1, Math.round(treeAreaH * layout.scale)),
      renderState: computeShareRenderUnlockState(simulation, treeData)
    });

    if (svgSnapshot?.img) {
      ctx.drawImage(svgSnapshot.img, treeAreaX, treeAreaTop, treeAreaW, treeAreaH);
      if (svgSnapshot.url) URL.revokeObjectURL(svgSnapshot.url);
    }

    // Teams.
    const allNodes = treeData?.nodes || [];
    const nodesMap = getNodeMap(allNodes);
    await renderShareTeams(ctx, nodesMap, team1, team2, teamCount, h, teamLabels);

    // Watermark.
    drawText(ctx, watermark, w - 48, h - 34, { size: 14, color: "#6b5d85", weight: 600, align: "right" });

    let dataUrl = null;
    if (typeof canvas.toDataURL === "function") dataUrl = canvas.toDataURL("image/png");
    let blob = null;
    if (typeof canvas.toBlob === "function") {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    return { ok: true, canvas, blob, dataUrl, layout };
  } catch (error) {
    return { ok: false, error: error?.message || "image-generation-failed", layout };
  }
}
