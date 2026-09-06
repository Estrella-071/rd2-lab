import {
  getNodeMap,
  getRunesForDiceNode,
  getMaxRank,
  getNodeCost,
  calculateImageSplitLayout,
  getUnlockedBounds,
  computeShareRenderUnlockState
} from "../domain/simulation_plan.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";
import { FACTION_DATA } from "../domain/faction_data.js";

export {
  computeShareRenderUnlockState,
  stripDiceSuffix,
  TEAM_LABELS_BY_LOCALE,
  resolveTeamTitle,
  renderShareTeams
};

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
  const logicalWidth = Math.max(480, Math.floor(Number(width) || SHARE_IMAGE_LOGICAL_SIZE.width));
  const logicalHeight = Math.max(300, Math.floor(Number(height) || SHARE_IMAGE_LOGICAL_SIZE.height));
  const pixelScale = Math.max(1, Math.min(4, Number(scale) || 2));
  return {
    width: logicalWidth * pixelScale,
    height: logicalHeight * pixelScale,
    logicalWidth,
    logicalHeight,
    scale: pixelScale
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
  return FACTION_DATA[Number(branch || 1)]?.color || FACTION_COLORS[Number(branch || 1)] || "#d5c6eb";
}

function getShareTeamCount(team1) {
  return (team1 && team1.length > 0) ? 1 : 0;
}

function calculateTreeAreaBottom(teamCount, height) {
  if (teamCount >= 1) return height - 110;
  return height - 40;
}

const DICE_SUFFIX_PATTERN = /(?:のダイス|ダイス|骰子|Dice|주사위)$/i;

/**
 * 移除骰子名稱後綴（繁中「骰子」、英文「Dice」、日文「ダイス/のダイス」、韓文「주사위」）
 * @param {string} name 原始骰子名稱
 * @returns {string} 去除後綴後的純名稱
 */
function stripDiceSuffix(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  return trimmed.replace(DICE_SUFFIX_PATTERN, "").trim();
}

const TEAM_LABELS_BY_LOCALE = Object.freeze({
  "zh-tw": "隊伍",
  "zh-cn": "队伍",
  en: "Team",
  ja: "チーム",
  ko: "팀"
});

export const SHARE_TITLES_BY_LOCALE = Object.freeze({
  "zh-tw": "骰子樹模擬配點",
  "zh-cn": "骰子树模拟配点",
  en: "Dice Tree Simulation",
  ja: "ダイスツリー シミュレーション",
  ko: "주사위 트리 시뮬레이션"
});

export const DETAILS_TITLES_BY_LOCALE = Object.freeze({
  "zh-tw": "配點配置詳情",
  "zh-cn": "配点配置详情",
  en: "Build Allocation Details",
  ja: "ビルド詳細",
  ko: "빌드 상세 정보"
});

export function resolveShareTitle(title, locale = "zh-tw") {
  const loc = String(locale || "zh-tw").toLowerCase();
  if (!title || title === "骰子樹模擬配點") {
    return SHARE_TITLES_BY_LOCALE[loc] || SHARE_TITLES_BY_LOCALE["zh-tw"];
  }
  return title;
}

export function resolveDetailsTitle(title, locale = "zh-tw") {
  const loc = String(locale || "zh-tw").toLowerCase();
  if (!title || title === "配點配置詳情") {
    return DETAILS_TITLES_BY_LOCALE[loc] || DETAILS_TITLES_BY_LOCALE["zh-tw"];
  }
  return title;
}

function resolveTeamTitle(teamLabels = {}, locale = "zh-tw") {
  if (teamLabels?.team1) return teamLabels.team1;
  if (teamLabels?.team) return teamLabels.team;
  const key = String(locale || "zh-tw").toLowerCase();
  return TEAM_LABELS_BY_LOCALE[key] || TEAM_LABELS_BY_LOCALE["zh-tw"] || "隊伍";
}

function getNodeLocalizedName(node, locale = "zh-tw") {
  if (!node) return "";
  const key = String(locale || "zh-tw").toLowerCase();
  if (key.startsWith("en") && node.name_en) return node.name_en;
  if (key.startsWith("ja") && node.name_ja) return node.name_ja;
  if (key.startsWith("ko") && node.name_ko) return node.name_ko;
  return node.name_zh || node.name || "";
}

async function renderCompactTeamRow(ctx, nodesMap, teamDice, teamTitle, startY, locale = "zh-tw") {
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
    const slotY = startY + 20;
    const slotSize = 48;

    if (node) {
      const cleanName = stripDiceSuffix(getNodeLocalizedName(node, locale));
      drawText(ctx, cleanName, slotX + slotSize / 2, startY + 11, {
        size: 11,
        color: "#e9dcff",
        weight: 700,
        align: "center"
      });
    }

    const borderColor = node ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.08)";
    ctx.fillStyle = node ? "rgba(35, 26, 56, 0.9)" : "rgba(20, 16, 30, 0.6)";
    drawRoundedRect(ctx, slotX, slotY, slotSize, slotSize, 10);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = node ? 2 : 1;
    drawRoundedRect(ctx, slotX, slotY, slotSize, slotSize, 10);
    ctx.stroke();

    if (!node) {
      drawText(ctx, String(index + 1), slotX + slotSize / 2, slotY + slotSize / 2, { size: 16, color: "#5d4d7a", weight: 800, align: "center" });
      continue;
    }

    const iconFilename = resolveNode3Icon(node) || "Dice_Fire3.png";
    const image = await loadImageAsync(`icons/${iconFilename}`);
    if (image) ctx.drawImage(image, slotX + 4, slotY + 4, slotSize - 8, slotSize - 8);

    ctx.fillStyle = "#f5d358";
    ctx.beginPath();
    ctx.arc(slotX + 9, slotY + 9, 7.5, 0, Math.PI * 2);
    ctx.fill();
    drawText(ctx, String(index + 1), slotX + 9, slotY + 9, { size: 9.5, color: "#1a1228", weight: 900, align: "center" });
  }
}

async function renderShareTeams(ctx, nodesMap, team1, height, teamLabels = {}, locale = "zh-tw") {
  const teamTitle = resolveTeamTitle(teamLabels, locale);
  if (team1 && team1.length > 0) {
    await renderCompactTeamRow(ctx, nodesMap, team1, teamTitle, height - 94, locale);
  }
}

function _drawShareBackground(ctx, w, h) {
  if (typeof ctx.save === "function") ctx.save();
  drawRoundedRect(ctx, 0, 0, w, h, 20);
  if (typeof ctx.clip === "function") ctx.clip();

  ctx.fillStyle = "#2F2942";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 16, 16, w - 32, h - 32, 20);
  ctx.stroke();
}

function _drawShareCapsule(ctx, cfg, iconImg, rightCursor) {
  const capsuleHeight = 32;
  const capsuleY = 36;
  const iconSize = 36;
  const valueText = formatNumber(cfg.value);

  if (typeof ctx.save === "function") ctx.save();
  ctx.font = '850 16px "Noto Sans TC", sans-serif';
  const textWidth = typeof ctx.measureText === "function"
    ? (ctx.measureText(valueText)?.width || String(valueText).length * 10)
    : String(valueText).length * 10;
  const capsuleWidth = Math.max(64, Math.ceil(textWidth + iconSize + 20));
  const capsuleX = rightCursor - capsuleWidth;

  if ("shadowColor" in ctx) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
  }

  ctx.fillStyle = "rgba(12, 9, 20, 0.96)";
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, 10);
  ctx.fill();

  if ("shadowColor" in ctx) ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, 10);
  ctx.stroke();

  drawText(ctx, valueText, capsuleX + capsuleWidth - 14, capsuleY + capsuleHeight / 2, {
    size: 16,
    color: "#ffffff",
    weight: 850,
    align: "right"
  });

  if (iconImg && typeof ctx.drawImage === "function") {
    if ("shadowColor" in ctx) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    }
    const iconSize = 36;
    const iconX = capsuleX - 2;
    const iconY = capsuleY + capsuleHeight - iconSize + 2;
    ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
  }

  if (typeof ctx.restore === "function") ctx.restore();
  return capsuleX;
}

async function _drawShareCurrencyCapsules(ctx, w, spent = {}) {
  const currencyConfigs = [];
  if (Number(spent?.solar) > 0) {
    currencyConfigs.push({ key: "solar", iconPath: "icons/item_stone_solar.png", value: spent.solar });
  }
  currencyConfigs.push(
    { key: "core", iconPath: "icons/TreeShadow_sprite-186.png", value: spent?.core || 0 },
    { key: "gold", iconPath: "icons/TreeShadow_sprite-185.png", value: spent?.gold || 0 }
  );

  const currencyImages = await Promise.all(
    currencyConfigs.map((cfg) => loadImageAsync(cfg.iconPath))
  );

  let rightCursor = w - 48;
  const gap = 10;
  for (let i = currencyConfigs.length - 1; i >= 0; i -= 1) {
    const capsuleX = _drawShareCapsule(ctx, currencyConfigs[i], currencyImages[i], rightCursor);
    rightCursor = capsuleX - gap;
  }
}

async function _drawShareTree(ctx, layout, { treeAreaX, treeAreaTop, treeAreaW, treeAreaH, prepareRender, renderTree, simulation, treeData, showNames }) {
  const rect = { x: treeAreaX, y: treeAreaTop, width: treeAreaW, height: treeAreaH };
  if (typeof prepareRender === "function") {
    await prepareRender({
      pixelScale: layout.scale,
      rect,
      mode: "share",
      simulation,
      treeData
    });
  }

  if (typeof renderTree !== "function") return false;
  const rendered = await renderTree({
    context: ctx,
    rect,
    pixelScale: layout.scale,
    mode: "share",
    simulation,
    treeData,
    showNames,
    renderUnlockState: computeShareRenderUnlockState(simulation, treeData)
  });
  return Boolean(rendered);
}

async function _exportCanvasResult(canvas, format, quality, layout) {
  const mimeType = (format === "image/jpeg" || format === "jpeg") ? "image/jpeg" : "image/png";
  let dataUrl = null;
  if (typeof canvas.toDataURL === "function") dataUrl = canvas.toDataURL(mimeType, quality);
  let blob = null;
  if (typeof canvas.toBlob === "function") {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
  }
  return { ok: true, canvas, blob, dataUrl, layout };
}

/** Create a share image from the current tree. */
export async function generateSimulationShareImage({
  simulation,
  treeData,
  title = "骰子樹模擬配點",
  currencyLabels = {},
  teamLabels = {},
  watermark = "Random Dice 2 Lab",
  locale = "zh-tw",
  width,
  height,
  scale,
  showNames = false,
  showTeam = true,
  format = "image/png",
  quality = 0.92,
  canvas: suppliedCanvas,
  prepareRender = null,
  renderTree = null
} = {}) {
  const rawDice = Array.isArray(simulation?.team?.dice) ? simulation.team.dice.filter(Boolean) : [];
  const team1 = rawDice.slice(0, 5);
  const teamCount = showTeam ? getShareTeamCount(team1) : 0;

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

    _drawShareBackground(ctx, w, h);
    const resolvedTitle = resolveShareTitle(title, locale);
    drawText(ctx, resolvedTitle, 48, 56, { size: 24, color: "#ffffff", weight: 800 });
    await _drawShareCurrencyCapsules(ctx, w, simulation?.spent);

    const treeOk = await _drawShareTree(ctx, layout, {
      treeAreaX: 40,
      treeAreaTop: 96,
      treeAreaW: w - 80,
      treeAreaH: calculateTreeAreaBottom(teamCount, h) - 96,
      prepareRender,
      renderTree,
      simulation,
      treeData,
      showNames
    });
    if (!treeOk) return { ok: false, error: "tree-renderer-unavailable", layout };

    if (showTeam) {
      const allNodes = treeData?.nodes || [];
      const nodesMap = getNodeMap(allNodes);
      await renderShareTeams(ctx, nodesMap, team1, h, teamLabels, locale);
    }

    drawText(ctx, watermark, w - 48, h - 34, { size: 14, color: "#6b5d85", weight: 600, align: "right" });
    if (typeof ctx.restore === "function") ctx.restore();

    return await _exportCanvasResult(canvas, format, quality, layout);
  } catch (error) {
    return { ok: false, error: error?.message || "image-generation-failed", layout };
  }
}

function drawComplexRoundedRectPath(ctx, x, y, width, height, { topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0 } = {}) {
  ctx.beginPath();
  ctx.moveTo(x + topLeft, y);
  ctx.lineTo(x + width - topRight, y);
  if (topRight > 0) ctx.arcTo(x + width, y, x + width, y + topRight, topRight);
  else ctx.lineTo(x + width, y);

  ctx.lineTo(x + width, y + height - bottomRight);
  if (bottomRight > 0) ctx.arcTo(x + width, y + height, x + width - bottomRight, y + height, bottomRight);
  else ctx.lineTo(x + width, y + height);

  ctx.lineTo(x + bottomLeft, y + height);
  if (bottomLeft > 0) ctx.arcTo(x, y + height, x, y + height - bottomLeft, bottomLeft);
  else ctx.lineTo(x, y + height);

  ctx.lineTo(x, y + topLeft);
  if (topLeft > 0) ctx.arcTo(x, y, x + topLeft, y, topLeft);
  else ctx.lineTo(x, y);

  ctx.closePath();
}

async function _buildSingleSplitResult(canvas, baseResult, layout, pixelScale, mimeType, quality) {
  let singleBlob = baseResult?.blob;
  let singleDataUrl = baseResult?.dataUrl;
  if (!singleDataUrl && typeof canvas.toDataURL === "function") {
    singleDataUrl = canvas.toDataURL(mimeType, quality);
  }
  if (!singleBlob && typeof canvas.toBlob === "function") {
    singleBlob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
  }
  return {
    ok: true,
    layout: layout || { mode: "single", parts: [{ index: 0, x: 0, y: 0, width: Math.floor(canvas.width / pixelScale), height: Math.floor(canvas.height / pixelScale) }] },
    images: [{
      index: 0,
      canvas,
      blob: singleBlob,
      dataUrl: singleDataUrl,
      width: canvas.width,
      height: canvas.height
    }]
  };
}

async function _cropSingleSplitPart(canvas, part, pixelScale, mimeType, quality) {
  const subCanvas = document.createElement("canvas");
  subCanvas.width = Math.floor(part.width * pixelScale);
  subCanvas.height = Math.floor(part.height * pixelScale);
  const subCtx = subCanvas.getContext("2d");
  if (!subCtx) return null;

  subCtx.imageSmoothingEnabled = true;
  subCtx.imageSmoothingQuality = "high";

  if (part.roundedCorners) {
    subCtx.save();
    drawComplexRoundedRectPath(subCtx, 0, 0, subCanvas.width, subCanvas.height, {
      topLeft: (part.roundedCorners.topLeft || 0) * pixelScale,
      topRight: (part.roundedCorners.topRight || 0) * pixelScale,
      bottomRight: (part.roundedCorners.bottomRight || 0) * pixelScale,
      bottomLeft: (part.roundedCorners.bottomLeft || 0) * pixelScale
    });
    subCtx.clip();
  }

  subCtx.drawImage(
    canvas,
    Math.floor(part.x * pixelScale),
    Math.floor(part.y * pixelScale),
    subCanvas.width,
    subCanvas.height,
    0,
    0,
    subCanvas.width,
    subCanvas.height
  );

  if (part.roundedCorners) subCtx.restore();

  let dataUrl = null;
  if (typeof subCanvas.toDataURL === "function") dataUrl = subCanvas.toDataURL(mimeType, quality);
  let blob = null;
  if (typeof subCanvas.toBlob === "function") {
    blob = await new Promise((resolve) => subCanvas.toBlob(resolve, mimeType, quality));
  }

  return {
    index: part.index,
    canvas: subCanvas,
    blob,
    dataUrl,
    width: subCanvas.width,
    height: subCanvas.height
  };
}

/**
 * 依據分割幾何規格，裁切出對應的子圖
 */
export async function generateSplitShareImages(options = {}) {
  let canvas = options.sourceCanvas;
  let layout = options.splitLayout;
  let pixelScale = options.pixelScale || options.scale || 2;
  const format = options.format || "image/png";
  const quality = options.quality ?? 0.92;
  const mimeType = format === "image/jpeg" || format === "jpeg" ? "image/jpeg" : "image/png";

  const splitMode = options.splitMode || "auto";
  const simulation = options.simulation;
  const treeData = options.treeData;
  const unlockedBounds = options.unlockedBounds || getUnlockedBounds(simulation, treeData);

  let baseResult = null;
  if (!canvas) {
    const prelimLayout = calculateImageSplitLayout({
      splitMode,
      unlockedBounds,
      canvasWidth: options.width || 1600,
      canvasHeight: options.height || 1000
    });
    const targetWidth = options.width || prelimLayout.recommendedSize?.width || 1600;
    const targetHeight = options.height || prelimLayout.recommendedSize?.height || 1000;
    baseResult = await generateSimulationShareImage({
      ...options,
      width: targetWidth,
      height: targetHeight
    });
    if (!baseResult?.ok) return baseResult || { ok: false, error: "base-image-failed" };
    canvas = baseResult.canvas;
    pixelScale = baseResult.layout?.scale || pixelScale;
  }

  if (!layout) {
    layout = calculateImageSplitLayout({
      canvasWidth: baseResult?.layout?.logicalWidth || Math.floor(canvas.width / pixelScale),
      canvasHeight: baseResult?.layout?.logicalHeight || Math.floor(canvas.height / pixelScale),
      unlockedBounds,
      splitMode
    });
  }

  const parts = layout?.parts || [];
  if (parts.length <= 1) {
    return _buildSingleSplitResult(canvas, baseResult, layout, pixelScale, mimeType, quality);
  }

  const results = [];
  for (const part of parts) {
    const subPart = await _cropSingleSplitPart(canvas, part, pixelScale, mimeType, quality);
    if (subPart) results.push(subPart);
  }

  return {
    ok: true,
    layout,
    images: results
  };
}

function cleanNodeDescription(text) {
  if (!text) return "";
  const str = String(text);
  let result = "";
  let inTag = false;
  let tagBuffer = "";

  for (const ch of str) {
    if (ch === "<") {
      inTag = true;
      tagBuffer = "<";
    } else if (ch === ">" && inTag) {
      inTag = false;
      const lower = tagBuffer.toLowerCase().slice(1).trim();
      if (lower.startsWith("br")) {
        result += "\n";
      }
      tagBuffer = "";
    } else if (inTag) {
      tagBuffer += ch;
    } else {
      result += ch;
    }
  }
  return result.trim();
}

function _measureLineWidth(ctx, text, size) {
  if (typeof ctx.measureText === "function") {
    return ctx.measureText(text)?.width || text.length * (size * 0.7);
  }
  return text.length * (size * 0.7);
}

function _wrapParagraphLines(ctx, para, maxWidth, size) {
  const lines = [];
  let current = "";
  for (const char of para) {
    const testLine = current + char;
    const testWidth = _measureLineWidth(ctx, testLine, size);
    if (testWidth > maxWidth && current.length > 0) {
      lines.push(current);
      current = char;
    } else {
      current = testLine;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function drawMultilineText(ctx, text, x, y, {
  maxWidth = 260,
  lineHeight = 17,
  maxLines = 4,
  size = 11,
  color = "#c2b5d8",
  weight = 500,
  align = "left"
} = {}) {
  const cleaned = cleanNodeDescription(text);
  const rawParagraphs = cleaned.split("\n");
  ctx.font = `${weight} ${size}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;

  const lines = [];
  for (const para of rawParagraphs) {
    lines.push(..._wrapParagraphLines(ctx, para, maxWidth, size));
  }

  const renderLines = lines.slice(0, maxLines);
  if (lines.length > maxLines && renderLines.length > 0) {
    const lastIdx = renderLines.length - 1;
    renderLines[lastIdx] = renderLines[lastIdx].slice(0, -1) + "…";
  }

  for (let i = 0; i < renderLines.length; i += 1) {
    ctx.fillText(renderLines[i], x, y + i * lineHeight);
  }
  return renderLines.length * lineHeight;
}

const FACTION_NAMES = Object.freeze({
  1: "自然",
  2: "工學",
  3: "魔法",
  4: "秩序",
  5: "渾沌"
});

const SUPPORT_TRAIT_IDS = new Set(["1115", "2115", "3115", "4115", "5115"]);

function _drawDetailsCurrencyCapsule(ctx, cfg, iconImg, rightCursor) {
  const capsuleHeight = 24;
  const capsuleY = 18;
  const iconSize = 22;
  const valueText = formatNumber(cfg.value);

  if (typeof ctx.save === "function") ctx.save();
  ctx.font = '800 11.5px "Noto Sans TC", sans-serif';
  const textWidth = typeof ctx.measureText === "function"
    ? (ctx.measureText(valueText)?.width || String(valueText).length * 8)
    : String(valueText).length * 8;
  const capsuleWidth = Math.max(48, Math.ceil(iconSize + textWidth + 14));
  const capsuleX = rightCursor - capsuleWidth;

  ctx.fillStyle = "rgba(12, 9, 20, 0.96)";
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, 6);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, 6);
  ctx.stroke();

  drawText(ctx, valueText, capsuleX + capsuleWidth - 8, capsuleY + capsuleHeight / 2, {
    size: 11.5,
    color: "#ffffff",
    weight: 800,
    align: "right"
  });

  if (iconImg && typeof ctx.drawImage === "function") {
    const iconSize = 22;
    ctx.drawImage(iconImg, capsuleX - 1, capsuleY + capsuleHeight - iconSize, iconSize, iconSize);
  }
  if (typeof ctx.restore === "function") ctx.restore();
  return capsuleX;
}

async function _drawDetailsHeader(ctx, { title, spent = {}, w }) {
  drawText(ctx, title, 22, 30, { size: 15, color: "#ffffff", weight: 800 });

  const currencyConfigs = [];
  if (Number(spent?.solar) > 0) {
    currencyConfigs.push({ key: "solar", iconPath: "icons/item_stone_solar.png", value: spent.solar });
  }
  currencyConfigs.push(
    { key: "core", iconPath: "icons/TreeShadow_sprite-186.png", value: spent?.core || 0 },
    { key: "gold", iconPath: "icons/TreeShadow_sprite-185.png", value: spent?.gold || 0 }
  );
  const currencyImages = await Promise.all(currencyConfigs.map((cfg) => loadImageAsync(cfg.iconPath)));

  let rightCursor = w - 22;
  const gap = 8;
  for (let i = currencyConfigs.length - 1; i >= 0; i -= 1) {
    const capsuleX = _drawDetailsCurrencyCapsule(ctx, currencyConfigs[i], currencyImages[i], rightCursor);
    rightCursor = capsuleX - gap;
  }
}

function _drawDetailsRuneCost(ctx, rune, entryCenterY, entryTopY, entriesX, entriesW, currencyIcons) {
  const cost = getNodeCost(rune, 1);
  let costImg = currencyIcons.goldIconImg;
  let costText = "";
  const g = Number(cost.gold) || 0;

  if (g > 0) {
    costImg = currencyIcons.goldIconImg;
    costText = g >= 10000 ? `${Math.floor(g / 10000)}萬` : String(g);
  } else if (Number(cost.solar) > 0) {
    costImg = currencyIcons.solarIconImg;
    costText = String(cost.solar);
  } else if (Number(cost.core) > 0) {
    costImg = currencyIcons.coreIconImg;
    costText = String(cost.core);
  }

  const capW = 36;
  const capH = 13;
  const capX = entriesX + entriesW - capW - 4;
  const capY = entryTopY + 3;

  ctx.fillStyle = "rgba(12, 9, 20, 0.96)";
  drawRoundedRect(ctx, capX, capY, capW, capH, 3);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, capX, capY, capW, capH, 3);
  ctx.stroke();

  if (costImg) {
    ctx.drawImage(costImg, capX + 1, capY + 0.5, 12, 12);
  }
  drawText(ctx, costText, capX + capW - 3, entryCenterY, {
    size: 8.5,
    color: "#ffffff",
    weight: 700,
    align: "right"
  });
}

async function _drawDetailsRuneUnlocked(ctx, { rune, rName, rRank, runeMaxRank, entryCenterY, entryTopY, entriesX, entriesW, branchColor, currencyIcons }) {
  const rIconPath = rune.icon_file || resolveNode3Icon(rune);
  const rImg = rIconPath ? await loadImageAsync(rIconPath) : null;
  if (rImg) {
    ctx.drawImage(rImg, entriesX + 3, entryTopY + 2, 15, 15);
  } else {
    drawText(ctx, "◆", entriesX + 10, entryCenterY, { size: 8, color: branchColor, align: "center" });
  }

  drawText(ctx, rName, entriesX + 21, entryCenterY, {
    size: 10,
    color: "#ffffff",
    weight: 600,
    align: "left"
  });

  if (runeMaxRank > 1) {
    const capW = 30;
    const capH = 13;
    const capX = entriesX + entriesW - capW - 4;
    const capY = entryTopY + 3;

    ctx.fillStyle = "rgba(245, 211, 88, 0.22)";
    drawRoundedRect(ctx, capX, capY, capW, capH, 3);
    ctx.fill();
    drawText(ctx, `Lv.${rRank}`, capX + capW / 2, entryCenterY, {
      size: 8.5,
      color: "#f5d358",
      weight: 800,
      align: "center"
    });
  } else {
    _drawDetailsRuneCost(ctx, rune, entryCenterY, entryTopY, entriesX, entriesW, currencyIcons);
  }
}

function _drawDetailsRuneLocked(ctx, { rName, entryCenterY, entriesX }) {
  drawText(ctx, rName, entriesX + 21, entryCenterY, {
    size: 10,
    color: "rgba(255, 255, 255, 0.22)",
    weight: 500,
    align: "left"
  });

  const textW = typeof ctx.measureText === "function"
    ? (ctx.measureText(rName)?.width || rName.length * 8.5)
    : rName.length * 8.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(entriesX + 19, entryCenterY);
  ctx.lineTo(entriesX + 23 + textW, entryCenterY);
  ctx.stroke();
}

async function _drawDetailsRuneEntry(ctx, { rune, entryCenterY, entryH, entriesX, entriesW, branchColor, ranksMap, currencyIcons }) {
  const rRank = rune ? Number(ranksMap.get(String(rune.id)) || 0) : 0;
  const isUnlocked = rRank > 0;
  const runeMaxRank = rune ? getMaxRank(rune) : 1;
  const entryTopY = entryCenterY - entryH / 2;

  ctx.fillStyle = isUnlocked ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.015)";
  drawRoundedRect(ctx, entriesX, entryTopY, entriesW, entryH, 5);
  ctx.fill();

  if (!rune) return;

  const rName = (rune.name_zh || rune.name || "").slice(0, 8);
  if (isUnlocked) {
    await _drawDetailsRuneUnlocked(ctx, {
      rune,
      rName,
      rRank,
      runeMaxRank,
      entryCenterY,
      entryTopY,
      entriesX,
      entriesW,
      branchColor,
      currencyIcons
    });
  } else {
    _drawDetailsRuneLocked(ctx, { rName, entryCenterY, entriesX });
  }
}

async function _drawDetailsDiceBox(ctx, { node, boxX, boxY, boxSize, ranksMap }) {
  if (!node) {
    drawText(ctx, "—", boxX + boxSize / 2, boxY + boxSize / 2, {
      size: 14,
      color: "#4d3d63",
      weight: 600,
      align: "center"
    });
    return;
  }

  const iconSize = 48;
  const iconX = boxX - 5;
  const iconY = boxY - 7;
  const iconFilename = resolveNode3Icon(node) || "Dice_Fire3.png";
  const diceImg = await loadImageAsync(`icons/${iconFilename}`);

  if (diceImg) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(diceImg, iconX, iconY, iconSize, iconSize);
    ctx.restore();
  }

  const rank = Number(ranksMap.get(String(node.id))) || 1;
  if (rank > 1) {
    ctx.fillStyle = "rgba(245, 211, 88, 0.25)";
    drawRoundedRect(ctx, boxX + boxSize - 24, boxY + boxSize - 13, 24, 13, 3);
    ctx.fill();
    drawText(ctx, `Lv.${rank}`, boxX + boxSize - 12, boxY + boxSize - 6.5, {
      size: 8.5,
      color: "#f5d358",
      weight: 800,
      align: "center"
    });
  }

  const cleanName = stripDiceSuffix(node.name_zh || node.name || "");
  drawText(ctx, cleanName, boxX + boxSize / 2, boxY - 7, {
    size: 9.5,
    color: "#ffffff",
    weight: 700,
    align: "center"
  });
}

async function _drawDetailsDiceRuneLinks(ctx, { runes, slotCenterY, boxX, boxSize, entriesX, entriesW, branchColor, ranksMap, currencyIcons }) {
  const entryCenterOffsets = [-22, 0, 22];
  const entryH = 19;

  for (let rIdx = 0; rIdx < 3; rIdx += 1) {
    const entryCenterY = slotCenterY + entryCenterOffsets[rIdx] - 4;
    const rune = runes[rIdx];

    const startLineX = boxX + boxSize;
    const startLineY = slotCenterY - 4;
    const endLineX = entriesX;
    const endLineY = entryCenterY;

    const isUnlocked = rune ? (Number(ranksMap.get(String(rune.id)) || 0) > 0) : false;
    ctx.beginPath();
    ctx.moveTo(startLineX, startLineY);
    ctx.bezierCurveTo(startLineX + 14, startLineY, endLineX - 10, endLineY, endLineX, endLineY);
    ctx.strokeStyle = isUnlocked ? branchColor : "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = isUnlocked ? 1.5 : 1;
    ctx.stroke();

    await _drawDetailsRuneEntry(ctx, {
      rune,
      entryCenterY,
      entryH,
      entriesX,
      entriesW,
      branchColor,
      ranksMap,
      currencyIcons
    });
  }
}

async function _drawDetailsDiceSlot(ctx, { node, slotCenterY, nodesMap, ranksMap, currencyIcons, geometry }) {
  const { leftX, boxSize, entriesX, entriesW } = geometry;
  const boxX = leftX + 2;
  const boxY = Math.round(slotCenterY - boxSize / 2 - 4);
  const branchColor = node ? (FACTION_DATA[node.faction || node.branch]?.color || "#ffd859") : "#5d4d7a";

  ctx.fillStyle = "rgba(18, 14, 28, 0.94)";
  drawRoundedRect(ctx, boxX, boxY, boxSize, boxSize, 9);
  ctx.fill();

  const borderColor = node ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.08)";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = node ? 1.5 : 1;
  drawRoundedRect(ctx, boxX, boxY, boxSize, boxSize, 9);
  ctx.stroke();

  await _drawDetailsDiceBox(ctx, { node, boxX, boxY, boxSize, ranksMap });

  const runes = node ? getRunesForDiceNode(node, nodesMap) : [];
  await _drawDetailsDiceRuneLinks(ctx, {
    runes,
    slotCenterY,
    boxX,
    boxSize,
    entriesX,
    entriesW,
    branchColor,
    ranksMap,
    currencyIcons
  });
}

async function _drawDetailsDiceSection(ctx, { teamDice, nodesMap, ranksMap, currencyIcons, geometry }) {
  const { bodyY, bodyBottom, dividerX } = geometry;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dividerX, bodyY);
  ctx.lineTo(dividerX, bodyBottom);
  ctx.stroke();

  const totalSlotHeight = bodyBottom - bodyY;
  const slotH = totalSlotHeight / 5;

  for (let index = 0; index < 5; index += 1) {
    const node = teamDice[index];
    const slotCenterY = Math.round(bodyY + index * slotH + slotH / 2);
    await _drawDetailsDiceSlot(ctx, {
      node,
      slotCenterY,
      nodesMap,
      ranksMap,
      currencyIcons,
      geometry
    });
  }
}

async function _drawSupportTraitRow(ctx, suppTraitNode, suppBranchId, traitRowY, geometry) {
  const traitCenterY = traitRowY + 10;
  const itemX = geometry.rightX + 4;
  const prefixW = 26;
  const colW = geometry.rightW - 8;

  drawText(ctx, `[${FACTION_NAMES[suppBranchId] || "支援"}]`, itemX + 12, traitCenterY, {
    size: 8.5,
    color: getBranchColor(suppBranchId),
    weight: 700,
    align: "center"
  });

  const tIconX = itemX + prefixW + 2;
  const tIconPath = suppTraitNode.icon_file || resolveNode3Icon(suppTraitNode);
  const tImg = tIconPath ? await loadImageAsync(tIconPath) : null;
  if (tImg) {
    ctx.drawImage(tImg, tIconX, traitCenterY - 7.5, 15, 15);
  } else {
    drawText(ctx, "◆", tIconX + 7.5, traitCenterY, { size: 8, color: getBranchColor(suppBranchId), align: "center" });
  }

  const tName = suppTraitNode.name_zh || suppTraitNode.name || "強化";
  drawText(ctx, tName.slice(0, 11), tIconX + 19, traitCenterY, {
    size: 10,
    color: "#ffffff",
    weight: 600,
    align: "left"
  });

  const tBaseVal = Number.parseFloat(suppTraitNode.passive_value) || 0;
  if (tBaseVal > 0) {
    const tIsPercent = (suppTraitNode.description_zh || "").includes("%");
    const tDisplayVal = `+${tBaseVal}${tIsPercent ? "%" : ""}`;
    drawText(ctx, tDisplayVal, itemX + colW - 34, traitCenterY, {
      size: 9.5,
      color: "#5eead4",
      weight: 700,
      align: "right"
    });
  }
}

async function _drawDetailsSupportSection(ctx, { activeSupportNode, nodesMap, ranksMap, geometry, w }) {
  const { bodyY, rightX, rightW, boxSize } = geometry;
  const suppBoxX = rightX + 4;
  const suppBoxY = bodyY + 4;
  const suppBranchId = activeSupportNode ? (Number(activeSupportNode.branch) || 1) : 1;
  const suppBranchColor = activeSupportNode ? getBranchColor(suppBranchId) : "rgba(255, 255, 255, 0.08)";

  ctx.fillStyle = "rgba(18, 14, 28, 0.94)";
  drawRoundedRect(ctx, suppBoxX, suppBoxY, boxSize, boxSize, 9);
  ctx.fill();

  ctx.strokeStyle = suppBranchColor;
  ctx.lineWidth = activeSupportNode ? 1.5 : 1;
  drawRoundedRect(ctx, suppBoxX, suppBoxY, boxSize, boxSize, 9);
  ctx.stroke();

  if (activeSupportNode) {
    const suppIconSize = 48;
    const suppIconX = suppBoxX - 5;
    const suppIconY = suppBoxY - 7;
    const suppImg = activeSupportNode.icon_file ? await loadImageAsync(activeSupportNode.icon_file) : null;
    if (suppImg) {
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.drawImage(suppImg, suppIconX, suppIconY, suppIconSize, suppIconSize);
      ctx.restore();
    }

    const suppInfoX = suppBoxX + boxSize + 10;
    const suppName = activeSupportNode.name_zh || activeSupportNode.name || "支援夥伴";
    drawText(ctx, suppName, suppInfoX, suppBoxY + 10, {
      size: 12.5,
      color: "#ffffff",
      weight: 800,
      align: "left"
    });

    const branchText = FACTION_NAMES[suppBranchId] || "全域";
    const branchTextW = typeof ctx.measureText === "function" ? (ctx.measureText(branchText)?.width || 24) : 24;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    drawRoundedRect(ctx, suppInfoX + 60, suppBoxY + 3, branchTextW + 10, 14, 3);
    ctx.fill();
    drawText(ctx, branchText, suppInfoX + 60 + (branchTextW + 10) / 2, suppBoxY + 10, {
      size: 8.5,
      color: "#e9dcff",
      weight: 700,
      align: "center"
    });

    const descText = activeSupportNode.description_zh || activeSupportNode.desc || "";
    drawMultilineText(ctx, descText, suppInfoX, suppBoxY + 23, {
      maxWidth: rightW - (suppInfoX - rightX) - 4,
      lineHeight: 12,
      maxLines: 3,
      size: 9,
      color: "#c2b5d8"
    });
  } else {
    drawText(ctx, "—", suppBoxX + boxSize / 2, suppBoxY + boxSize / 2, {
      size: 14,
      color: "#4d3d63",
      align: "center"
    });
    drawText(ctx, "未選擇支援夥伴", suppBoxX + boxSize + 14, suppBoxY + boxSize / 2, {
      size: 11,
      color: "rgba(255, 255, 255, 0.2)",
      align: "left"
    });
  }

  const suppTraitId = (activeSupportNode?.next_nodes || []).find((nid) => SUPPORT_TRAIT_IDS.has(String(nid)));
  const suppTraitNode = suppTraitId ? nodesMap.get(String(suppTraitId)) : null;
  const suppTraitRank = suppTraitNode ? Number(ranksMap.get(String(suppTraitNode.id)) || 0) : 0;
  const isTraitUnlocked = suppTraitRank > 0;

  let sepY = bodyY + 68;
  if (activeSupportNode && suppTraitNode && isTraitUnlocked) {
    const traitRowY = bodyY + 54;
    await _drawSupportTraitRow(ctx, suppTraitNode, suppBranchId, traitRowY, geometry);
    sepY = traitRowY + 22;
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rightX + 4, sepY);
  ctx.lineTo(w - 16, sepY);
  ctx.stroke();

  return sepY;
}

async function _drawPassiveRow(ctx, item, itemX, itemY, itemCenterY, geometry) {
  const prefixW = 26;
  const colW = geometry.rightW - 8;
  const branchNames = ["自然", "工學", "魔法", "秩序", "渾沌", "侵略者"];
  const nodeName = item.node.name_zh || item.node.name || "";
  const hasBranchInName = branchNames.some((b) => nodeName.includes(b));
  const branchId = Number(item.node.branch) || (item.node.id ? Math.floor(Number(item.node.id) / 1000) : 1);
  const branchName = FACTION_NAMES[branchId] || "自然";

  if (!hasBranchInName) {
    drawText(ctx, `[${branchName}]`, itemX + 12, itemCenterY, {
      size: 8.5,
      color: getBranchColor(branchId),
      weight: 700,
      align: "center"
    });
  }

  const iconX = itemX + prefixW + 2;
  const pIconPath = item.node.icon_file || resolveNode3Icon(item.node);
  const pImg = pIconPath ? await loadImageAsync(pIconPath) : null;
  if (pImg) {
    ctx.drawImage(pImg, iconX, itemCenterY - 7.5, 15, 15);
  } else {
    drawText(ctx, "◆", iconX + 7.5, itemCenterY, {
      size: 8,
      color: getBranchColor(branchId),
      align: "center"
    });
  }

  const nameX = iconX + 19;
  const cleanName = nodeName.slice(0, 11);
  drawText(ctx, cleanName, nameX, itemCenterY, {
    size: 10,
    color: "#ffffff",
    weight: 600,
    align: "left"
  });

  const baseVal = Number.parseFloat(item.node.passive_value) || 0;
  const addVal = Number.parseFloat(item.node.passive_rank_add) || 0;
  const currentVal = baseVal + (item.rank - 1) * addVal;
  const isPercent = (item.node.description_zh || "").includes("{0}%") || (item.node.description_zh || "").includes("%");
  const valStr = Number.isInteger(currentVal) ? String(currentVal) : currentVal.toFixed(1);
  const displayVal = `+${valStr}${isPercent ? "%" : ""}`;

  drawText(ctx, displayVal, itemX + colW - 34, itemCenterY, {
    size: 9.5,
    color: "#5eead4",
    weight: 700,
    align: "right"
  });

  if (item.maxRank > 1) {
    drawText(ctx, `Lv.${item.rank}`, itemX + colW - 2, itemCenterY, {
      size: 9.5,
      color: "#f5d358",
      weight: 800,
      align: "right"
    });
  }
}

async function _drawDetailsPassiveSection(ctx, { nodesMap, ranksMap, passivesStartY, geometry }) {
  const { rightX, rightW, bodyBottom } = geometry;
  const candidatePassives = [];

  ranksMap.forEach((val, id) => {
    const node = nodesMap.get(String(id));
    const rank = Number(val || 0);
    if (!node || rank <= 0 || node.node_type !== "PLAYER_PASSIVE") return;
    if (SUPPORT_TRAIT_IDS.has(String(node.id))) return;
    const maxRank = getMaxRank(node);
    if (maxRank > 1 && rank === 1) return;
    candidatePassives.push({ node, rank, maxRank });
  });

  candidatePassives.sort((a, b) => (Number(a.node.branch) - Number(b.node.branch)) || (Number(a.node.index) - Number(b.node.index)));

  const passiveRowH = 21;
  for (let i = 0; i < candidatePassives.length; i += 1) {
    const item = candidatePassives[i];
    const itemX = rightX + 4;
    const itemY = passivesStartY + i * passiveRowH;
    if (itemY + passiveRowH > bodyBottom) break;
    const itemCenterY = itemY + passiveRowH / 2;
    await _drawPassiveRow(ctx, item, itemX, itemY, itemCenterY, geometry);
  }

  if (candidatePassives.length === 0) {
    drawText(ctx, "—", rightX + rightW / 2, passivesStartY + 40, {
      size: 13,
      color: "rgba(255, 255, 255, 0.2)",
      align: "center"
    });
  }
}

function _drawDetailsCostFooter(ctx, { watermark, w, h }) {
  drawText(ctx, watermark, w - 20, h - 10, { size: 9, color: "#5d4d7a", weight: 600, align: "right" });
}

function _drawDetailsCardBackground(ctx, w, h) {
  if (typeof ctx.save === "function") ctx.save();
  drawRoundedRect(ctx, 0, 0, w, h, 18);
  if (typeof ctx.clip === "function") ctx.clip();

  ctx.fillStyle = "#1e192c";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 8, 8, w - 16, h - 16, 14);
  ctx.stroke();
}

function _resolveDetailsTeamDice(simulation, nodesMap, ranksMap) {
  const rawDice = Array.isArray(simulation?.team?.dice) ? simulation.team.dice.filter(Boolean) : [];
  return rawDice.slice(0, 5).map((d) => {
    const node = nodesMap.get(String(d?.id || d));
    if (!node) return null;
    const r = Number(ranksMap.get(String(node.id)) || 0);
    return r > 0 ? node : null;
  });
}

function _resolveDetailsActiveSupportNode(simulation, nodesMap, ranksMap) {
  const teamSupport = simulation?.team?.support;
  if (teamSupport) {
    const suppCandidate = nodesMap.get(String(teamSupport?.id || teamSupport));
    if (suppCandidate && Number(ranksMap.get(String(suppCandidate.id)) || 0) > 0) {
      return suppCandidate;
    }
  }
  for (const n of nodesMap.values()) {
    if (n.node_type === "PERK") {
      const pRank = Number(ranksMap.get(String(n.id)) || 0);
      if (pRank > 0) return n;
    }
  }
  return null;
}

/**
 * 產生非樹狀結構的純「配置詳情卡片」圖片 (精緻 560x480 左右形式，圖示左上破格，骰子下方白色名稱，詞條刪除線與金幣膠囊，支援專屬詞條與單列對齊被動)
 */
export async function generateSimulationDetailsCardImage({
  simulation,
  treeData,
  title = "配點配置詳情",
  watermark = "Random Dice 2 Lab",
  locale = "zh-tw",
  width = 560,
  height = 480,
  scale = 2,
  format = "image/png",
  quality = 0.92,
  canvas: suppliedCanvas
} = {}) {
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

    _drawDetailsCardBackground(ctx, w, h);

    const [solarIconImg, coreIconImg, goldIconImg] = await Promise.all([
      loadImageAsync("icons/item_stone_solar.png"),
      loadImageAsync("icons/TreeShadow_sprite-186.png"),
      loadImageAsync("icons/TreeShadow_sprite-185.png")
    ]);
    const currencyIcons = { solarIconImg, coreIconImg, goldIconImg };

    const resolvedTitle = resolveDetailsTitle(title, locale);
    await _drawDetailsHeader(ctx, { title: resolvedTitle, spent: simulation?.spent, w });

    const nodesMap = getNodeMap(treeData?.nodes || []);
    const ranksMap = simulation?.ranks instanceof Map
      ? simulation.ranks
      : new Map(Object.entries(simulation?.ranks || {}));

    const teamDice = _resolveDetailsTeamDice(simulation, nodesMap, ranksMap);

    const bodyY = 56;
    const bodyBottom = h - 16;
    const leftX = 16;
    const boxSize = 42;
    const entriesX = leftX + boxSize + 16;
    const entriesW = 160;
    const dividerX = 246;
    const rightX = dividerX + 14;
    const rightW = w - rightX - 16;
    const geometry = { bodyY, bodyBottom, leftX, boxSize, entriesX, entriesW, dividerX, rightX, rightW };

    await _drawDetailsDiceSection(ctx, { teamDice, nodesMap, ranksMap, currencyIcons, geometry });

    const activeSupportNode = _resolveDetailsActiveSupportNode(simulation, nodesMap, ranksMap);
    const sepY = await _drawDetailsSupportSection(ctx, { activeSupportNode, nodesMap, ranksMap, geometry, w });
    await _drawDetailsPassiveSection(ctx, { nodesMap, ranksMap, passivesStartY: sepY + 8, geometry });
    _drawDetailsCostFooter(ctx, { watermark, w, h });

    if (typeof ctx.restore === "function") ctx.restore();

    return await _exportCanvasResult(canvas, format, quality, layout);
  } catch (error) {
    return { ok: false, error: error?.message || "details-image-generation-failed", layout };
  }
}
