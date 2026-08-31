import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

export const MAP_RENDER_MANIFEST = "map-render-manifest.json";
export const MAP_TILE_LOGICAL_SIZE = 512;
export const MAP_RENDER_SCALES = Object.freeze([1, 2, 3]);
export const MAP_RASTER_TOTAL_BUDGET = 32 * 1024 * 1024;
export const MAP_RASTER_INITIAL_BUDGET = 14 * 1024 * 1024;
export const MAP_ATLAS_MAX_TEXTURE_SIZE = 2048;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const NODE_CELL_SIZE = 192;

export function getNodeVariantCss(variant) {
  if (variant === "dice-locked") {
    // Keep the frame and shadow in their normal colors. Only the actual dice
    // or support icon is disabled in the simulation atlas.
    return ".node-body .node-icon,.node-body .node-icon-flat,.node-body .node-icon-deep{filter:grayscale(1) brightness(.6)!important}";
  }
  if (variant === "rune-locked") return ".node{opacity:.2}";
  if (variant === "passive-locked") {
    // Passive locks use the game's dimmed purple treatment. Do not filter
    // node-icon here: for passive SVG groups it is the colored outer frame,
    // not the inner passive glyph.
    return ".node{opacity:.52;filter:none!important}.node-body>circle{fill:#5c4d83!important}";
  }
  return "";
}

function getAtlasPageLayout(scale) {
  // Keep decoded pages small enough that a viewport does not retain a large
  // atlas texture just to draw a few nearby nodes. Keep each page under the
  // 2048px texture limit while using a moderate page count; too many tiny
  // pages make a fresh resolution promotion wait on dozens of image decodes.
  if (scale >= 3) return { columns: 3, rows: 3 };
  if (scale === 2) return { columns: 4, rows: 4 };
  return { columns: 4, rows: 4 };
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([name, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngPredictor(filter, left, above, upperLeft) {
  if (filter === 1) return left;
  if (filter === 2) return above;
  if (filter === 3) return Math.floor((left + above) / 2);
  if (filter === 4) return paethPredictor(left, above, upperLeft);
  return 0;
}

function pngNeighbors(decoded, rowIndex, rowOffset, previousOffset, column, bytesPerPixel) {
  return {
    left: column >= bytesPerPixel ? decoded[rowOffset + column - bytesPerPixel] : 0,
    above: rowIndex > 0 ? decoded[previousOffset + column] : 0,
    upperLeft: rowIndex > 0 && column >= bytesPerPixel
      ? decoded[previousOffset + column - bytesPerPixel]
      : 0
  };
}

function decodePngRow(scanlines, sourceOffset, decoded, rowIndex, rowLength, bytesPerPixel) {
  const filter = scanlines[sourceOffset];
  if (filter > 4) return null;
  const rowOffset = rowIndex * rowLength;
  const previousOffset = rowOffset - rowLength;
  for (let column = 0; column < rowLength; column += 1) {
    const neighbors = pngNeighbors(decoded, rowIndex, rowOffset, previousOffset, column, bytesPerPixel);
    const predictor = pngPredictor(filter, neighbors.left, neighbors.above, neighbors.upperLeft);
    decoded[rowOffset + column] = (scanlines[sourceOffset + column + 1] + predictor) & 0xff;
  }
  return sourceOffset + rowLength + 1;
}

function decodePngRows(scanlines, width, height, bytesPerPixel) {
  const rowLength = width * bytesPerPixel;
  if (scanlines.length !== height * (rowLength + 1)) return null;
  const decoded = Buffer.alloc(height * rowLength);
  let sourceOffset = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    sourceOffset = decodePngRow(scanlines, sourceOffset, decoded, rowIndex, rowLength, bytesPerPixel);
    if (sourceOffset === null) return null;
  }
  return decoded;
}

function scorePngFilter(decoded, rowIndex, rowLength, bytesPerPixel, filter) {
  const rowOffset = rowIndex * rowLength;
  const previousOffset = rowOffset - rowLength;
  let score = 0;
  for (let column = 0; column < rowLength; column += 1) {
    const neighbors = pngNeighbors(decoded, rowIndex, rowOffset, previousOffset, column, bytesPerPixel);
    const predictor = pngPredictor(filter, neighbors.left, neighbors.above, neighbors.upperLeft);
    const difference = (decoded[rowOffset + column] - predictor) & 0xff;
    score += Math.min(difference, 256 - difference);
  }
  return score;
}

function choosePngFilter(decoded, rowIndex, rowLength, bytesPerPixel) {
  let bestType = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let filter = 0; filter <= 4; filter += 1) {
    const score = scorePngFilter(decoded, rowIndex, rowLength, bytesPerPixel, filter);
    if (score < bestScore) {
      bestScore = score;
      bestType = filter;
    }
  }
  return bestType;
}

function encodePngRow(decoded, filtered, outputOffset, rowIndex, rowLength, bytesPerPixel, filter) {
  const rowOffset = rowIndex * rowLength;
  const previousOffset = rowOffset - rowLength;
  for (let column = 0; column < rowLength; column += 1) {
    const neighbors = pngNeighbors(decoded, rowIndex, rowOffset, previousOffset, column, bytesPerPixel);
    const predictor = pngPredictor(filter, neighbors.left, neighbors.above, neighbors.upperLeft);
    filtered[outputOffset + column] = (decoded[rowOffset + column] - predictor) & 0xff;
  }
  return outputOffset + rowLength;
}

function encodePngRows(decoded, width, height, bytesPerPixel) {
  const rowLength = width * bytesPerPixel;
  const filtered = Buffer.alloc(height * (rowLength + 1));
  let outputOffset = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const bestType = choosePngFilter(decoded, rowIndex, rowLength, bytesPerPixel);
    filtered[outputOffset++] = bestType;
    outputOffset = encodePngRow(decoded, filtered, outputOffset, rowIndex, rowLength, bytesPerPixel, bestType);
  }
  return filtered;
}

/**
 * Repack a resvg RGBA PNG with stronger lossless filtering/compression. This
 * only changes the PNG container; decoded pixels remain byte-for-byte equal.
 */
function parsePngChunks(png) {
  const chunks = [];
  const idat = [];
  let position = 8;
  let width = 0;
  let height = 0;
  let eligible = true;
  while (position + 12 <= png.length) {
    const length = png.readUInt32BE(position);
    const end = position + 12 + length;
    if (end > png.length) return null;
    const type = png.toString("ascii", position + 4, position + 8);
    const data = png.subarray(position + 8, position + 8 + length);
    if (type === "IHDR") {
      if (data.length < 13) return null;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      eligible = data[8] === 8 && data[9] === 6 && data[10] === 0 && data[11] === 0 && data[12] === 0;
    } else if (type === "IDAT") {
      idat.push(data);
    }
    chunks.push({ type, raw: png.subarray(position, end) });
    position = end;
    if (type === "IEND") break;
  }
  if (!eligible || !width || !height || !idat.length || position !== png.length) return null;
  return { chunks, idat, width, height };
}

function recompressPngIdat(idat, width, height) {
  let decoded;
  try {
    decoded = decodePngRows(inflateSync(Buffer.concat(idat)), width, height, 4);
  } catch {
    return null;
  }
  if (!decoded) return null;
  let encoded;
  try {
    encoded = deflateSync(encodePngRows(decoded, width, height, 4), { level: 9 });
  } catch {
    return null;
  }
  return { encoded, originalLength: Buffer.concat(idat).length };
}

function replacePngIdat(signature, chunks, encoded) {
  const output = [signature];
  let inserted = false;
  for (const chunk of chunks) {
    if (chunk.type !== "IDAT") {
      output.push(chunk.raw);
    } else if (!inserted) {
      output.push(pngChunk("IDAT", encoded));
      inserted = true;
    }
  }
  return Buffer.concat(output);
}

function optimizeRgbaPng(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(signature)) return png;
  const parsed = parsePngChunks(png);
  if (!parsed) return png;
  const recompressed = recompressPngIdat(parsed.idat, parsed.width, parsed.height);
  if (!recompressed || recompressed.encoded.length >= recompressed.originalLength) return png;
  return replacePngIdat(signature, parsed.chunks, recompressed.encoded);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseNumber(value, fallback = 0) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function isAttributeNameChar(character) {
  return /[A-Za-z0-9_.:-]/.test(character);
}

function skipToAttributeStart(source, cursor) {
  while (cursor < source.length && !/[A-Za-z_:]/.test(source[cursor])) cursor += 1;
  return cursor;
}

function skipAttributeName(source, cursor) {
  while (cursor < source.length && isAttributeNameChar(source[cursor])) cursor += 1;
  return cursor;
}

function skipWhitespace(source, cursor) {
  while (/\s/.test(source[cursor] || "")) cursor += 1;
  return cursor;
}

function parseAttributeEntries(tag) {
  const source = String(tag);
  const entries = [];
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipToAttributeStart(source, cursor);
    const start = cursor;
    cursor = skipAttributeName(source, cursor);
    if (cursor === start) break;
    const name = source.slice(start, cursor);
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] !== "=") continue;
    cursor = skipWhitespace(source, cursor + 1);
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") continue;
    cursor += 1;
    const valueStart = cursor;
    const valueEnd = source.indexOf(quote, valueStart);
    if (valueEnd < 0) break;
    entries.push({ name, value: source.slice(valueStart, valueEnd), start, end: valueEnd + 1 });
    cursor = valueEnd + 1;
  }
  return entries;
}

function readAttributes(tag) {
  const attributes = {};
  for (const entry of parseAttributeEntries(tag)) attributes[entry.name] = entry.value;
  return attributes;
}

function rewriteSvgOpeningTags(svgText, rewriteTag) {
  return String(svgText).replace(/<[A-Za-z][A-Za-z0-9:_-]*(?:\s[^>]*)?>/g, (tag) => rewriteTag(tag));
}

function removeSvgAttributes(svgText, shouldRemove) {
  return rewriteSvgOpeningTags(svgText, (tag) => {
    const entries = parseAttributeEntries(tag).filter((entry) => shouldRemove(entry));
    entries.sort((left, right) => right.start - left.start);
    let result = tag;
    for (const entry of entries) {
      result = result.slice(0, entry.start) + result.slice(entry.end);
    }
    return result;
  });
}

function parseViewBox(svgText) {
  const root = /<svg\b[^>]*>/i.exec(String(svgText))?.[0] || "";
  const attributes = readAttributes(root);
  const values = String(attributes.viewBox || "").trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("dice_tree.svg is missing a valid viewBox.");
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function getNodeId(tag) {
  return readAttributes(tag)["data-node-id"] || "";
}

function getTranslate(tag) {
  const transform = readAttributes(tag).transform || "";
  const match = /translate\s*\(\s*([\d.+-]+)(?:\s*,\s*|\s+)([\d.+-]+)\s*\)/i.exec(transform);
  if (!match) return null;
  return { x: parseNumber(match[1]), y: parseNumber(match[2]) };
}

/**
 * Extract outer node groups with a balanced tag scan. A regular expression
 * cannot safely find these groups because every node contains nested groups.
 */
export function extractNodeGroups(svgText) {
  const groups = [];
  const stack = [];
  const tagPattern = /<\/?g\b[^>]*>/gi;
  for (const match of String(svgText).matchAll(tagPattern)) {
    const tag = match[0];
    if (/^<\/g/i.test(tag)) {
      const opening = stack.pop();
      if (opening?.nodeId) {
        groups.push({
          id: opening.nodeId,
          start: opening.start,
          end: match.index + tag.length,
          source: String(svgText).slice(opening.start, match.index + tag.length),
          position: opening.position
        });
      }
      continue;
    }
    if (/\/\s*>$/.test(tag)) continue;
    stack.push({
      start: match.index,
      nodeId: getNodeId(tag),
      position: getTranslate(tag)
    });
  }
  return groups.filter((group) => group.id && group.position);
}

function extractGroupsByClass(svgText, className) {
  const groups = [];
  const stack = [];
  const tagPattern = /<\/?g\b[^>]*>/gi;
  for (const match of String(svgText).matchAll(tagPattern)) {
    const tag = match[0];
    if (/^<\/g/i.test(tag)) {
      const opening = stack.pop();
      if (opening?.classes?.includes(className)) {
        groups.push({
          start: opening.start,
          end: match.index + tag.length,
          source: String(svgText).slice(opening.start, match.index + tag.length)
        });
      }
      continue;
    }
    if (/\/\s*>$/.test(tag)) continue;
    const attributes = readAttributes(tag);
    stack.push({
      start: match.index,
      classes: String(attributes.class || "").split(/\s+/).filter(Boolean)
    });
  }
  return groups;
}

function removeGroupsByClass(svgText, className) {
  let result = String(svgText);
  for (const group of extractGroupsByClass(result, className).sort((left, right) => right.start - left.start)) {
    result = result.slice(0, group.start) + result.slice(group.end);
  }
  return result;
}

function inlineSvgImages(svgText, siteDir) {
  return String(svgText).replace(/((?:xlink:)?href\s*=\s*["'])((?:icons)\/[A-Z0-9][A-Z0-9_.-]*\.png)(["'])/gi, (_match, prefix, relativePath, suffix) => {
    const imagePath = path.join(siteDir, relativePath.replaceAll("/", path.sep));
    if (!fs.existsSync(imagePath)) throw new Error(`Missing raster source icon: ${relativePath}`);
    const bytes = fs.readFileSync(imagePath);
    return `${prefix}data:image/png;base64,${bytes.toString("base64")}${suffix}`;
  });
}

function removeNodeGroups(svgText, groups) {
  let result = String(svgText);
  for (const group of [...groups].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, group.start)}${result.slice(group.end)}`;
  }
  return result;
}

function makeBaseSvg(svgText, groups, viewBox) {
  const withoutNodes = removeNodeGroups(svgText, groups);
  const withoutDynamicCenter = removeGroupsByClass(withoutNodes, "tree-center-core-btn");
  const dynamicClasses = ["tree-center-stat-name", "tree-center-stat-value", "compendium-core-compact-title"];
  let baseSvg = withoutDynamicCenter;
  for (const className of dynamicClasses) baseSvg = removeGroupsByClass(baseSvg, className);
  baseSvg = removeTextElementsByClass(baseSvg, dynamicClasses);
  return setRootSvgAttributes(baseSvg, viewBox);
}

function removeTextElementsByClass(svgText, classNames) {
  const classSet = new Set(classNames);
  const source = String(svgText);
  const removals = [];
  for (const match of source.matchAll(/<text\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    const classes = new Set(String(attributes.class || "").split(/\s+/).filter(Boolean));
    if (!classNames.some((className) => classSet.has(className) && classes.has(className))) continue;
    const closing = /<\/text\s*>/gi;
    closing.lastIndex = match.index + match[0].length;
    const closingMatch = closing.exec(source);
    if (closingMatch) removals.push({ start: match.index, end: closingMatch.index + closingMatch[0].length });
  }
  let result = source;
  removals.sort((left, right) => right.start - left.start);
  for (const removal of removals) {
    result = result.slice(0, removal.start) + result.slice(removal.end);
  }
  return result;
}

function replaceFirstSvgAttribute(tag, name, value) {
  const entry = parseAttributeEntries(tag).find((candidate) => candidate.name.toLowerCase() === name);
  if (!entry) return tag;
  return tag.slice(0, entry.start) + `${name}="${value}"` + tag.slice(entry.end);
}

function setRootSvgAttributes(svgText, viewBox) {
  return String(svgText).replace(/<svg\b[^>]*>/i, (tag) => {
    let result = replaceFirstSvgAttribute(tag, "width", viewBox.width);
    result = replaceFirstSvgAttribute(result, "height", viewBox.height);
    return replaceFirstSvgAttribute(result, "shape-rendering", "geometricPrecision");
  });
}

function makeCenterAssetSvg(svgText, variant, defs) {
  const source = extractGroupsByClass(svgText, "tree-center-core-btn")[0]?.source;
  if (!source) throw new Error("dice_tree.svg is missing the central compendium group.");
  const body = removeSvgAttributes(removeGroupsByClass(source, "compendium-core-title-group"), (entry) => {
    if (entry.name.toLowerCase() === "transform") return /^translate\s*\(/i.test(entry.value);
    return ["id", "role", "tabindex", "aria-label"].includes(entry.name.toLowerCase());
  });
  const isSimulation = variant === "simulation";
  const style = "<style>" +
    ".compendium-core-title-group{display:none!important}" +
    ".compendium-core-mark{display:" + (isSimulation ? "none" : "block") + "!important}" +
    ".simulation-center-dice-icon{display:" + (isSimulation ? "block" : "none") + "!important}" +
    "</style>";
  return "<svg xmlns=\"" + SVG_NAMESPACE + "\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"280\" height=\"220\" viewBox=\"0 0 280 220\">" +
    style + "<defs>" + defs + "</defs><g transform=\"translate(140 110)\">" + body + "</g></svg>";
}

function nodeType(node) {
  return String(node?.node_type || node?.type || "").toUpperCase();
}

function isLargePassive(node) {
  return nodeType(node) === "PLAYER_PASSIVE" && Boolean(node?.is_big);
}

function geometryForNode(node) {
  const type = nodeType(node);
  if (type === "DICE") return { width: 164, height: 190, shape: "dice" };
  if (type === "PERK") return { width: 164, height: 112, shape: "perk" };
  if (type === "DICE_RUNE") return { width: 118, height: 128, shape: "rune" };
  if (isLargePassive(node)) return { width: 154, height: 154, shape: "large-passive" };
  return { width: 122, height: 132, shape: "small-passive" };
}

function roundRasterNumber(value) {
  return Number(Number(value).toFixed(3));
}

function firstSvgTag(source, tagName) {
  return new RegExp(String.raw`<${tagName}\b[^>]*>`, "i").exec(String(source))?.[0] || "";
}

function firstSvgTagWithClass(source, tagName, className) {
  const pattern = new RegExp(String.raw`<${tagName}\b[^>]*>`, "gi");
  for (const match of String(source).matchAll(pattern)) {
    const classes = new Set(String(readAttributes(match[0]).class || "").split(/\s+/).filter(Boolean));
    if (classes.has(className)) return match[0];
  }
  return "";
}

function getSvgScale(source) {
  for (const match of String(source).matchAll(/<g\b[^>]*>/gi)) {
    const transform = readAttributes(match[0]).transform || "";
    const scale = /^(?:scale)\s*\(\s*([-\d.]+)/i.exec(transform.trim());
    if (scale) return parseNumber(scale[1], 1);
  }
  return 1;
}

function readRequiredNumbers(tag, names) {
  const attributes = readAttributes(tag);
  if (!names.every((name) => Object.hasOwn(attributes, name))) return null;
  const values = names.map((name) => parseNumber(attributes[name], Number.NaN));
  return values.every(Number.isFinite) ? values : null;
}

export function extractCostBadgeAnchor(source) {
  const text = String(source || "");
  const scale = getSvgScale(text);
  const badge = extractGroupsByClass(text, "cost-badge")[0]?.source || "";
  const rect = firstSvgTag(badge, "rect");
  const values = readRequiredNumbers(rect, ["x", "y", "width", "height"]);
  if (!values) return null;
  const [offsetX, offsetY, width, height] = values;
  return {
    offsetX: roundRasterNumber((offsetX + width / 2) * scale),
    offsetY: roundRasterNumber(offsetY * scale),
    width: roundRasterNumber(width * scale),
    height: roundRasterNumber(height * scale),
    scale: roundRasterNumber(scale)
  };
}

/**
 * Extract the canonical rank counter geometry before the SVG node is turned
 * into an atlas sprite. Rank badges are intentionally dynamic in the Canvas
 * renderer, but their size and vertical offset still belong to the source
 * artwork (large passives use a different placement than ordinary nodes).
 */
export function extractRankBadgeAnchor(source) {
  const text = String(source || "");
  const scale = getSvgScale(text);
  const badge = extractGroupsByClass(text, "rank-badge")[0]?.source || "";
  const rect = firstSvgTag(badge, "rect");
  const value = firstSvgTagWithClass(badge, "text", "rank-value");
  const rectValues = readRequiredNumbers(rect, ["x", "y", "width", "height", "rx"]);
  const valueValues = readRequiredNumbers(value, ["x", "y"]);
  if (!rectValues || !valueValues) return null;
  const [offsetX, offsetY, width, height, radius] = rectValues;
  const [textOffsetX, textOffsetY] = valueValues;
  if (![offsetX, offsetY, width, height, radius, textOffsetX, textOffsetY, scale].every(Number.isFinite)
    || width <= 0 || height <= 0 || radius <= 0 || scale <= 0) return null;
  return {
    offsetX: roundRasterNumber((offsetX + width / 2) * scale),
    offsetY: roundRasterNumber(offsetY * scale),
    width: roundRasterNumber(width * scale),
    height: roundRasterNumber(height * scale),
    radius: roundRasterNumber(radius * scale),
    textOffsetX: roundRasterNumber(textOffsetX * scale),
    textOffsetY: roundRasterNumber(textOffsetY * scale),
    textSize: roundRasterNumber(14 * scale),
    strokeWidth: roundRasterNumber(1.5 * scale),
    scale: roundRasterNumber(scale)
  };
}

export function extractNodeArtworkBounds(source) {
  const text = String(source || "");
  const scale = getSvgScale(text);
  const body = extractGroupsByClass(text, "node-body")[0]?.source || "";
  const uses = [...body.matchAll(/<use\b[^>]*>/gi)].map((match) => match[0]);
  const artwork = uses.find((tag) => /\bclass=["'][^"']*\bnode-icon-flat\b[^"']*["']/i.test(tag))
    || uses.find((tag) => /\bclass=["'][^"']*\bnode-icon\b[^"']*["']/i.test(tag)
      && !/\bclass=["'][^"']*\bdice-shadow\b[^"']*["']/i.test(tag));
  if (!artwork) return null;
  const attributes = readAttributes(artwork);
  const x = parseNumber(attributes.x);
  const y = parseNumber(attributes.y);
  const width = parseNumber(attributes.width);
  const height = parseNumber(attributes.height);
  if (![x, y, width, height, scale].every(Number.isFinite) || width <= 0 || height <= 0 || scale <= 0) return null;
  return {
    x: roundRasterNumber(x * scale),
    y: roundRasterNumber(y * scale),
    width: roundRasterNumber(width * scale),
    height: roundRasterNumber(height * scale),
    scale: roundRasterNumber(scale)
  };
}

function sanitizeNodeSource(source) {
  // Labels, cost badges and rank counters are dynamic state. Keeping them in
  // the sprite would duplicate stale language and simulation values.
  return String(source)
    .replace(/<g\b[^>]*class="[^"]*\b(?:node-name-badge|cost-badge|rank-badge)\b[^"]*"[^>]*>[\s\S]*?<\/g>/gi, "")
    .replace(/<g\b[^>]*class='[^']*\b(?:node-name-badge|cost-badge|rank-badge)\b[^']*'[^>]*>[\s\S]*?<\/g>/gi, "")
    .replace(/\sdata-node-id\s*=\s*(?:"[^"]*"|'[^']*')/i, "")
    .replace(/\stransform\s*=\s*(?:"[^"]*"|'[^']*')/i, "");
}

function renderPng(svgText, options) {
  const renderer = new Resvg(svgText, {
    fitTo: { mode: "zoom", value: options.scale },
    crop: options.crop,
    font: { loadSystemFonts: true },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
    logLevel: "off"
  });
  const png = renderer.render().asPng();
  return options.optimize ? optimizeRgbaPng(png) : png;
}

function renderTile(baseSvg, viewBox, scale, column, row) {
  const left = column * MAP_TILE_LOGICAL_SIZE * scale;
  const top = row * MAP_TILE_LOGICAL_SIZE * scale;
  const right = Math.min(viewBox.width * scale, left + MAP_TILE_LOGICAL_SIZE * scale);
  const bottom = Math.min(viewBox.height * scale, top + MAP_TILE_LOGICAL_SIZE * scale);
  // Crop only inside the source viewBox. Boundary tiles are allowed to be
  // partial; their logical dimensions are recorded in the manifest.
  return renderPng(baseSvg, { scale, crop: { left, top, right, bottom } });
}

function buildAtlas(svgByNode, nodes, outputDir, scale, variant, ids) {
  const selected = nodes.filter((node) => ids.has(String(node.id))).sort((left, right) => {
    const leftPosition = svgByNode.positions?.get(String(left.id)) || left;
    const rightPosition = svgByNode.positions?.get(String(right.id)) || right;
    return Number(leftPosition.y || 0) - Number(rightPosition.y || 0)
      || Number(leftPosition.x || 0) - Number(rightPosition.x || 0)
      || String(left.id).localeCompare(String(right.id));
  });
  if (selected.length === 0) return { path: null, pages: [], frames: {}, bytes: 0 };
  const pageLayout = getAtlasPageLayout(scale);
  const pageCapacity = pageLayout.columns * pageLayout.rows;
  const cell = NODE_CELL_SIZE * scale;
  const variantCss = getNodeVariantCss(variant);
  const frames = {};
  const pages = [];
  let bytes = 0;
  for (let pageIndex = 0; pageIndex * pageCapacity < selected.length; pageIndex += 1) {
    const pageNodes = selected.slice(pageIndex * pageCapacity, (pageIndex + 1) * pageCapacity);
    const columns = Math.min(pageLayout.columns, Math.max(1, pageNodes.length));
    const rows = Math.ceil(pageNodes.length / columns);
    const logicalWidth = columns * NODE_CELL_SIZE;
    const logicalHeight = rows * NODE_CELL_SIZE;
    const textureWidth = logicalWidth * scale;
    const textureHeight = logicalHeight * scale;
    if (textureWidth > MAP_ATLAS_MAX_TEXTURE_SIZE || textureHeight > MAP_ATLAS_MAX_TEXTURE_SIZE) {
      throw new Error(`Map atlas page exceeds ${MAP_ATLAS_MAX_TEXTURE_SIZE}px: ${variant}-${scale}x-${pageIndex} (${textureWidth}x${textureHeight}).`);
    }
    const atlasSvg = `<svg xmlns="${SVG_NAMESPACE}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${logicalWidth}" height="${logicalHeight}" viewBox="0 0 ${logicalWidth} ${logicalHeight}"><style>${svgByNode.style || ""}.node-name-badge,.cost-badge,.rank-badge{display:none!important}</style><defs>${svgByNode.defs}</defs>${pageNodes.map((node, pageOffset) => {
      const col = pageOffset % columns;
      const row = Math.floor(pageOffset / columns);
      return `<g transform="translate(${col * NODE_CELL_SIZE + NODE_CELL_SIZE / 2} ${row * NODE_CELL_SIZE + NODE_CELL_SIZE / 2})">${sanitizeNodeSource(svgByNode.groups.get(String(node.id)) || "")}</g>`;
    }).join("")}</svg>`;
    const withVariantCss = atlasSvg.replace("<style>", `<style>${variantCss}`);
    const png = renderPng(withVariantCss, {
      scale,
      optimize: scale >= 2,
      crop: { left: 0, top: 0, right: logicalWidth * scale, bottom: logicalHeight * scale }
    });
    const filename = `map/atlas/${variant}-${scale}x-${pageIndex}.png`;
    const destination = path.join(outputDir, filename.replaceAll("/", path.sep));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, png);
    bytes += png.byteLength;
    pages.push({
      path: filename,
      columns,
      rows,
      width: logicalWidth * scale,
      height: logicalHeight * scale,
      bytes: png.byteLength
    });
    pageNodes.forEach((node, pageOffset) => {
      const col = pageOffset % columns;
      const row = Math.floor(pageOffset / columns);
      frames[String(node.id)] = {
        page: pageIndex,
        x: col * cell,
        y: row * cell,
        width: cell,
        height: cell,
        logicalX: col * NODE_CELL_SIZE,
        logicalY: row * NODE_CELL_SIZE,
        logicalWidth: NODE_CELL_SIZE,
        logicalHeight: NODE_CELL_SIZE
      };
    });
  }
  const width = Math.max(...pages.map((page) => page.width));
  const height = Math.max(...pages.map((page) => page.height));
  return {
    path: null,
    pages,
    frames,
    bytes,
    columns: pageLayout.columns,
    rows: pageLayout.rows,
    width,
    height
  };
}

function collectEdgePaths(svgText, nodePositions) {
  const edges = [];
  const seen = new Set();
  for (const match of String(svgText).matchAll(/<path\b[^>]*>/gi)) {
    const tag = match[0];
    const attributes = readAttributes(tag);
    const classes = new Set(String(attributes.class || "").split(/\s+/));
    if (!classes.has("edge") || classes.has("tree-center-link")) continue;
    const d = attributes.d || "";
    const line = /M\s*([\d.+-]+)[ ,]+([\d.+-]+)\s+L\s*([\d.+-]+)[ ,]+([\d.+-]+)/i.exec(d);
    if (!line) continue;
    const points = [
      { x: parseNumber(line[1]), y: parseNumber(line[2]) },
      { x: parseNumber(line[3]), y: parseNumber(line[4]) }
    ];
    const ids = points.map((point) => {
      let best = null;
      let distance = Infinity;
      for (const [id, position] of nodePositions) {
        const nextDistance = Math.hypot(point.x - position.x, point.y - position.y);
        if (nextDistance < distance) { distance = nextDistance; best = id; }
      }
      return distance < 20 ? best : null;
    });
    if (!ids[0] || !ids[1]) continue;
    const key = `${ids[0]}->${ids[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ key, from: ids[0], to: ids[1], d: `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}` });
  }
  return edges;
}

function collectCenterLinkPaths(svgText) {
  const links = [];
  for (const match of String(svgText).matchAll(/<path\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    const classes = new Set(String(attributes.class || "").split(/\s+/));
    if (!classes.has("tree-center-link")) continue;
    const d = attributes.d || "";
    const line = /M\s*([\d.+-]+)[ ,]+([\d.+-]+)\s+L\s*([\d.+-]+)[ ,]+([\d.+-]+)/i.exec(d);
    if (!line) throw new Error("Raster source center link has invalid line geometry.");
    const from = { x: parseNumber(line[1]), y: parseNumber(line[2]) };
    const to = { x: parseNumber(line[3]), y: parseNumber(line[4]) };
    links.push({
      key: `center-${links.length + 1}`,
      branch: links.length + 1,
      from,
      to,
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`
    });
  }
  return links;
}

function getDefs(svgText) {
  return /<defs\b[^>]*>([\s\S]*?)<\/defs>/i.exec(String(svgText))?.[1] || "";
}

function getSvgStyle(svgText) {
  return /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(String(svgText))?.[1] || "";
}

function writeRasterFile(stagingDir, relativePath, bytes) {
  const fullPath = path.join(stagingDir, relativePath.replaceAll("/", path.sep));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bytes);
  return bytes.byteLength;
}

function removeRasterOutput(stagingDir) {
  const mapDir = path.join(stagingDir, "map");
  if (fs.existsSync(mapDir)) fs.rmSync(mapDir, { recursive: true, force: true });
  const manifestPath = path.join(stagingDir, MAP_RENDER_MANIFEST);
  if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath, { force: true });
}

function loadRasterSource(siteDir) {
  const treeJsonPath = path.join(siteDir, "data", "dice_tree.json");
  const treeSvgPath = path.join(siteDir, "data", "dice_tree.svg");
  const treeJsonBytes = fs.readFileSync(treeJsonPath);
  const treeSvgBytes = fs.readFileSync(treeSvgPath);
  const treeData = JSON.parse(treeJsonBytes.toString("utf8"));
  const sourceSvg = treeSvgBytes.toString("utf8");
  const viewBox = parseViewBox(sourceSvg);
  const groups = extractNodeGroups(sourceSvg);
  const groupMap = new Map(groups.map((group) => [String(group.id), group]));
  const nodes = Array.isArray(treeData.nodes) ? treeData.nodes : [];
  if (groups.length !== nodes.length || groups.length !== 239) {
    throw new Error(`Raster source node count mismatch: SVG=${groups.length}, JSON=${nodes.length}.`);
  }
  const positions = new Map();
  for (const node of nodes) {
    const group = groupMap.get(String(node.id));
    if (!group?.position) throw new Error(`Raster source is missing geometry for node ${node.id}.`);
    positions.set(String(node.id), group.position);
  }
  const svgWithImages = inlineSvgImages(sourceSvg, siteDir);
  const inlinedGroups = extractNodeGroups(svgWithImages);
  const inlinedGroupMap = new Map(inlinedGroups.map((group) => [String(group.id), group.source]));
  const baseSvg = makeBaseSvg(svgWithImages, inlinedGroups, viewBox);
  return {
    treeJsonBytes,
    treeSvgBytes,
    treeData,
    sourceSvg,
    viewBox,
    nodes,
    positions,
    svgWithImages,
    inlinedGroupMap,
    baseSvg
  };
}

function generateRasterTiles(stagingDir, baseSvg, viewBox) {
  const generatedFiles = [];
  const tiles = {};
  const tileColumns = Math.ceil(viewBox.width / MAP_TILE_LOGICAL_SIZE);
  const tileRows = Math.ceil(viewBox.height / MAP_TILE_LOGICAL_SIZE);
  let rasterBytes = 0;
  const initialFiles = [];
  for (const scale of MAP_RENDER_SCALES) {
    const key = `${scale}x`;
    tiles[key] = { scale, columns: tileColumns, rows: tileRows, files: [] };
    for (let row = 0; row < tileRows; row += 1) {
      for (let column = 0; column < tileColumns; column += 1) {
        const relativePath = `map/tiles/${key}/${column}-${row}.png`;
        const bytes = renderTile(baseSvg, viewBox, scale, column, row);
        rasterBytes += writeRasterFile(stagingDir, relativePath, bytes);
        generatedFiles.push(relativePath);
        tiles[key].files.push({
          column,
          row,
          path: relativePath,
          width: Math.min(MAP_TILE_LOGICAL_SIZE, viewBox.width - column * MAP_TILE_LOGICAL_SIZE),
          height: Math.min(MAP_TILE_LOGICAL_SIZE, viewBox.height - row * MAP_TILE_LOGICAL_SIZE),
          bytes: bytes.byteLength
        });
        if (scale === 1 && row < 2 && column < 3) initialFiles.push(relativePath);
      }
    }
  }
  return { generatedFiles, initialFiles, tiles, tileColumns, tileRows, rasterBytes };
}

function prepareAtlasInputs(nodes, inlinedGroupMap) {
  const atlasGroups = {
    normal: new Map(),
    "dice-locked": new Map(),
    "rune-locked": new Map(),
    "passive-locked": new Map()
  };
  const diceIds = new Set(nodes.filter((node) => ["DICE", "PERK"].includes(nodeType(node))).map((node) => String(node.id)));
  const runeIds = new Set(nodes.filter((node) => nodeType(node) === "DICE_RUNE").map((node) => String(node.id)));
  const passiveIds = new Set(nodes.filter((node) => nodeType(node) === "PLAYER_PASSIVE").map((node) => String(node.id)));
  for (const [id, source] of inlinedGroupMap) atlasGroups.normal.set(id, source);
  for (const id of diceIds) atlasGroups["dice-locked"].set(id, inlinedGroupMap.get(id));
  for (const id of runeIds) atlasGroups["rune-locked"].set(id, inlinedGroupMap.get(id));
  for (const id of passiveIds) atlasGroups["passive-locked"].set(id, inlinedGroupMap.get(id));
  return {
    atlasGroups,
    variantSets: {
      normal: new Set(nodes.map((node) => String(node.id))),
      "dice-locked": diceIds,
      "rune-locked": runeIds,
      "passive-locked": passiveIds
    }
  };
}

function generateAtlases({ nodes, stagingDir, svgWithImages, positions, atlasGroups, variantSets }) {
  const atlas = {};
  const generatedFiles = [];
  const initialFiles = [];
  let rasterBytes = 0;
  const defs = getDefs(svgWithImages);
  const style = getSvgStyle(svgWithImages);
  for (const scale of MAP_RENDER_SCALES) {
    for (const variant of Object.keys(variantSets)) {
      const selected = nodes.filter((node) => variantSets[variant].has(String(node.id)));
      const sourceMap = new Map(selected.map((node) => [String(node.id), atlasGroups[variant].get(String(node.id))]));
      const atlasResult = buildAtlas(
        { groups: sourceMap, defs, style, positions },
        selected,
        stagingDir,
        scale,
        variant,
        variantSets[variant]
      );
      atlas[`${variant}-${scale}x`] = atlasResult;
      const pagePaths = atlasResult.pages.map((page) => page.path);
      generatedFiles.push(...pagePaths);
      rasterBytes += atlasResult.bytes;
      if (scale === 1) initialFiles.push(...pagePaths);
    }
  }
  return { atlas, generatedFiles, initialFiles, rasterBytes };
}

function generateCenterAssets(svgWithImages, stagingDir) {
  const center = {};
  const generatedFiles = [];
  const initialFiles = [];
  let rasterBytes = 0;
  const defs = getDefs(svgWithImages);
  for (const variant of ["normal", "simulation"]) {
    center[variant] = {};
    const source = makeCenterAssetSvg(svgWithImages, variant, defs);
    for (const scale of MAP_RENDER_SCALES) {
      const relativePath = `map/center/${variant}-${scale}x.png`;
      const bytes = renderPng(source, {
        scale,
        crop: { left: 0, top: 0, right: 280 * scale, bottom: 220 * scale }
      });
      rasterBytes += writeRasterFile(stagingDir, relativePath, bytes);
      generatedFiles.push(relativePath);
      if (scale === 1) initialFiles.push(relativePath);
      center[variant][`${scale}x`] = {
        path: relativePath,
        width: 280 * scale,
        height: 220 * scale,
        bytes: bytes.byteLength
      };
    }
  }
  return { center, generatedFiles, initialFiles, rasterBytes };
}

function collectRasterEdges(treeData, sourceSvg, positions) {
  const edges = collectEdgePaths(sourceSvg, positions);
  const expectedEdges = treeData.summary?.edge_count || 246;
  if (edges.length !== Number(expectedEdges)) {
    throw new Error(`Raster source edge count mismatch: SVG=${edges.length}, expected=${expectedEdges}.`);
  }
  const centerLinks = collectCenterLinkPaths(sourceSvg);
  if (centerLinks.length !== 5) {
    throw new Error(`Raster source center link count mismatch: SVG=${centerLinks.length}, expected=5.`);
  }
  return { edges, centerLinks };
}

function resolveNodeVariants(node) {
  const type = nodeType(node);
  let locked = "dice-locked";
  if (type === "DICE_RUNE") locked = "rune-locked";
  else if (type === "PLAYER_PASSIVE") locked = "passive-locked";
  let special = "normal";
  if (type === "PLAYER_PASSIVE") special = "passive-locked";
  return {
    locked,
    special
  };
}

function buildManifestNodes(nodes, positions, inlinedGroupMap, atlas, variantSets) {
  return nodes.map((node) => {
    const id = String(node.id);
    const position = positions.get(id);
    const geometry = geometryForNode(node);
    const labelAnchor = extractCostBadgeAnchor(inlinedGroupMap.get(id));
    const rankAnchor = extractRankBadgeAnchor(inlinedGroupMap.get(id));
    const artworkBounds = extractNodeArtworkBounds(inlinedGroupMap.get(id));
    const frames = {};
    for (const scale of MAP_RENDER_SCALES) {
      for (const variant of Object.keys(variantSets)) {
        const frame = atlas[`${variant}-${scale}x`]?.frames?.[id];
        if (frame) frames[`${variant}-${scale}x`] = frame;
      }
    }
    const variants = resolveNodeVariants(node);
    return {
      id,
      x: position.x,
      y: position.y,
      branch: Number(node.branch || node.faction || 1) || 1,
      nodeType: nodeType(node),
      isBig: Boolean(node.is_big),
      geometry,
      labelAnchor,
      rankAnchor,
      artworkBounds,
      hitBox: { x: position.x - geometry.width / 2, y: position.y - geometry.height / 2, width: geometry.width, height: geometry.height },
      labelKey: node.id,
      frames,
      variants
    };
  });
}

function buildAtlasManifest(atlas) {
  return Object.fromEntries(Object.entries(atlas).map(([key, result]) => [key,
    result.pages.length > 0
      ? { columns: result.columns, rows: result.rows, width: result.width, height: result.height, bytes: result.bytes, pages: result.pages }
      : null]));
}

function calculateInitialRasterBytes(stagingDir, initialFiles) {
  return initialFiles.reduce((sum, relativePath) => (
    sum + fs.statSync(path.join(stagingDir, relativePath.replaceAll("/", path.sep))).size
  ), 0);
}

/**
 * Generate the browser-facing raster contract. All output is intentionally
 * written below .pages; the reviewed SVG remains the canonical input and is
 * never replaced by generated data.
 */
export function buildMapRaster({ rootDir, siteDir, stagingDir }) {
  const source = loadRasterSource(siteDir);
  const {
    treeData,
    treeJsonBytes,
    treeSvgBytes,
    sourceSvg,
    viewBox,
    nodes,
    positions,
    svgWithImages,
    inlinedGroupMap,
    baseSvg
  } = source;
  removeRasterOutput(stagingDir);

  const tileResult = generateRasterTiles(stagingDir, baseSvg, viewBox);
  const atlasInputs = prepareAtlasInputs(nodes, inlinedGroupMap);
  const atlasResult = generateAtlases({
    nodes,
    stagingDir,
    svgWithImages,
    positions,
    atlasGroups: atlasInputs.atlasGroups,
    variantSets: atlasInputs.variantSets
  });
  const centerResult = generateCenterAssets(svgWithImages, stagingDir);
  const edgeResult = collectRasterEdges(treeData, sourceSvg, positions);
  const generatedFiles = [...tileResult.generatedFiles, ...atlasResult.generatedFiles, ...centerResult.generatedFiles];
  const initialFiles = [...tileResult.initialFiles, ...atlasResult.initialFiles, ...centerResult.initialFiles];
  const rasterBytes = tileResult.rasterBytes + atlasResult.rasterBytes + centerResult.rasterBytes;
  const manifestNodes = buildManifestNodes(
    nodes,
    positions,
    inlinedGroupMap,
    atlasResult.atlas,
    atlasInputs.variantSets
  );
  const atlasManifest = buildAtlasManifest(atlasResult.atlas);
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/build_map_raster.mjs",
    source: {
      svg: "data/dice_tree.svg",
      json: "data/dice_tree.json",
      svgSha256: sha256(treeSvgBytes),
      jsonSha256: sha256(treeJsonBytes)
    },
    assetVersion: sha256(Buffer.concat([treeSvgBytes, treeJsonBytes])).slice(0, 16),
    viewBox,
    tile: {
      logicalSize: MAP_TILE_LOGICAL_SIZE,
      scales: MAP_RENDER_SCALES.map((value) => `${value}x`),
      columns: tileResult.tileColumns,
      rows: tileResult.tileRows,
      tiles: tileResult.tiles
    },
    atlas: atlasManifest,
    center: centerResult.center,
    nodes: manifestNodes,
    edges: edgeResult.edges,
    centerLinks: edgeResult.centerLinks,
    initial: { maxBytes: MAP_RASTER_INITIAL_BUDGET, paths: initialFiles },
    budgets: { initialBytes: 0, totalBytes: rasterBytes, maxInitialBytes: MAP_RASTER_INITIAL_BUDGET, maxTotalBytes: MAP_RASTER_TOTAL_BUDGET },
    generatedFiles: []
  };
  const initialBytes = calculateInitialRasterBytes(stagingDir, initialFiles);
  manifest.budgets.initialBytes = initialBytes;
  manifest.generatedFiles = [...generatedFiles, MAP_RENDER_MANIFEST].sort(compareText);
  const finalizedBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeRasterFile(stagingDir, MAP_RENDER_MANIFEST, finalizedBytes);
  if (initialBytes > MAP_RASTER_INITIAL_BUDGET) throw new Error(`Initial raster payload exceeds ${MAP_RASTER_INITIAL_BUDGET} bytes: ${initialBytes}.`);
  const totalWithManifest = rasterBytes + finalizedBytes.byteLength;
  if (totalWithManifest > MAP_RASTER_TOTAL_BUDGET) throw new Error(`Raster payload exceeds ${MAP_RASTER_TOTAL_BUDGET} bytes: ${totalWithManifest}.`);
  manifest.budgets.totalBytes = totalWithManifest;
  fs.writeFileSync(path.join(stagingDir, MAP_RENDER_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, generatedFiles: manifest.generatedFiles, initialBytes, totalBytes: totalWithManifest, rootDir };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const siteDir = path.join(rootDir, "site");
  const stagingDir = path.join(rootDir, ".pages");
  const result = buildMapRaster({ rootDir, siteDir, stagingDir });
  console.log(`Map raster built: ${result.generatedFiles.length} files, ${result.totalBytes} bytes.`);
}
