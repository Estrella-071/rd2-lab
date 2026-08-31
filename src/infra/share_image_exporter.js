import { getNodeMap, isInitialSimulationNode } from "../domain/simulation_plan.js";
import { computeUpstreamTopologyPath } from "../domain/dag_topology.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";

export const SHARE_IMAGE_LOGICAL_SIZE = Object.freeze({ width: 1600, height: 1000 });

const imageCache = new Map();

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
  prepareRender = null,
  renderTree = null
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

    if (typeof prepareRender === "function") {
      await prepareRender({
        pixelScale: layout.scale,
        rect: { x: treeAreaX, y: treeAreaTop, width: treeAreaW, height: treeAreaH },
        mode: "share",
        simulation,
        treeData
      });
    }

    if (typeof renderTree === "function") {
      const rendered = await renderTree({
        context: ctx,
        rect: { x: treeAreaX, y: treeAreaTop, width: treeAreaW, height: treeAreaH },
        pixelScale: layout.scale,
        mode: "share",
        simulation,
        treeData,
        renderUnlockState: computeShareRenderUnlockState(simulation, treeData)
      });
      if (!rendered) return { ok: false, error: "tree-renderer-unavailable", layout };
    } else {
      return { ok: false, error: "tree-renderer-unavailable", layout };
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
