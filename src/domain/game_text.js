/**
 * @fileoverview 遊戲文案格式化、佔位符替換與純字串安全消毒模組 (零 DOM 依賴)
 * @module domain/game_text
 */

export const DEFAULT_TAG_MAP = Object.freeze({
  BURN: "燙傷",
  THORN: "尖刺",
  BULLET: "子彈",
  SLOW: "減速",
  POISON: "中毒",
  CRITICAL: "暴擊",
  FROZEN: "冰凍",
  LOCK: "封印",
  DECAY: "腐敗",
  DEATH: "暴斃",
  EFFECT_DEATH: "暴斃",
  NORMAL_MONSTER: "一般怪物",
  ELITE_MONSTER: "菁英怪物",
  SPEED_MONSTER: "快速怪物",
  BIG_MONSTER: "巨大怪物",
  BOSS_MONSTER: "首領怪物",
  GOLEM_MONSTER: "SP魔像",
  BLOOM: "綻放",
  BLESS: "祝福",
  SOW: "果實",
  TRANSFER: "SP怪物",
  TAEGEUK: "陰陽",
  HARMONY: "極致和諧",
  ALIGNMENT: "排序",
  ALONE: "孤獨",
  TYRANT: "暴君化",
  PREDATOR: "吞噬",
  MUTATION: "變種",
  FAILURE: "失敗品",
  RESONANCE: "共鳴",
  DOOM: "破滅",
  BIGTHORN: "巨型尖刺",
  BUBBLE: "泡泡",
  COMBO: "連擊",
  ELEMENT: "原子",
  EXECUTIONER: "執行劍",
  LASER: "光線",
  OVERSHURIKEN: "強化魔彈",
  PILLAR: "巨石",
  POTION: "藥水",
  SAW: "鋸齒",
  SHURIKEN: "魔彈",
  STUN: "僵硬",
  MERGE: "合成時",
  SPAWN: "召喚時",
  SUMMON: "召喚",
  COPY: "複製",
  SWAP: "替換",
  GROWTH: "成長",
  CONNECT: "連接",
  STONE: "石頭",
  THUNDERHAMMER: "雷錘",
  FLOW: "流動",
  COUNTDOWN: "倒數",
  SP_GAIN: "獲得SP",
  SP_SCALE: "SP等比",
  SP_BURN: "燒毀",
  BUFF_ATKSPD: "攻擊速度增加",
  DEBUFF_ATKSPD: "攻擊速度減少",
  AREA_DAMAGE: "範圍傷害",
  CHAIN: "連鎖",
  AURA: "光環",
  CHARGE: "補充",
  ACTIVATION: "啟用條件"
});

/**
 * HTML 實體轉義
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return String(value ?? "").replaceAll(/[&<>"']/g, (c) => map[c]);
}

function stripHtmlTags(value) {
  return String(value ?? "").replaceAll(/<[^<>]*>/g, "");
}

const GREEN_COLOR_VALUES = new Set(["#00ff00", "#0f0", "green"]);

function transformColorSections(value, shouldTransform, transform) {
  const source = String(value ?? "");
  const lower = source.toLowerCase();
  const openToken = "<color=";
  const closeToken = "</color>";
  let result = "";
  let cursor = 0;
  while (cursor < source.length) {
    const open = lower.indexOf(openToken, cursor);
    if (open < 0) return result + source.slice(cursor);
    result += source.slice(cursor, open);
    const openEnd = source.indexOf(">", open + openToken.length);
    const close = openEnd < 0 ? -1 : lower.indexOf(closeToken, openEnd + 1);
    if (openEnd < 0 || close < 0) return result + source.slice(open);
    const color = source.slice(open + openToken.length, openEnd).trim().toLowerCase();
    const inner = source.slice(openEnd + 1, close);
    result += shouldTransform(color) ? transform(inner) : source.slice(open, close + closeToken.length);
    cursor = close + closeToken.length;
  }
  return result;
}

function replaceGreenColorSections(value, transform) {
  return transformColorSections(value, (color) => GREEN_COLOR_VALUES.has(color), transform);
}

function stripColorTags(value) {
  return transformColorSections(value, () => true, (inner) => inner);
}

const DANGEROUS_TAGS = new Set(["script", "style", "iframe", "object", "embed"]);

function parseTag(source, start, end) {
  let cursor = start + 1;
  let closing = false;
  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  while (source[cursor] === " " || source[cursor] === "\t" || source[cursor] === "\n" || source[cursor] === "\r") cursor += 1;
  const nameStart = cursor;
  while (cursor < end) {
    const code = source.codePointAt(cursor);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isLetter) break;
    cursor += 1;
  }
  if (cursor === nameStart) return null;
  return {
    name: source.slice(nameStart, cursor).toLowerCase(),
    closing,
    remainder: source.slice(cursor, end).trim()
  };
}

function nextTagEnd(source, start) {
  return source.indexOf(">", start + 1);
}

function findClosingTag(source, name, start) {
  const lower = source.toLowerCase();
  const marker = `</${name}`;
  let cursor = start;
  while (cursor < source.length) {
    const candidate = lower.indexOf(marker, cursor);
    if (candidate < 0) return -1;
    const afterName = source[candidate + marker.length];
    if (afterName === ">" || afterName === " " || afterName === "\t" || afterName === "\n" || afterName === "\r") {
      const end = nextTagEnd(source, candidate);
      if (end >= 0) return end;
    }
    cursor = candidate + marker.length;
  }
  return -1;
}

function stripDangerousElements(value) {
  const source = String(value ?? "");
  let result = "";
  for (let index = 0; index < source.length;) {
    if (source[index] !== "<") {
      result += source[index];
      index += 1;
      continue;
    }
    const end = nextTagEnd(source, index);
    if (end < 0) {
      result += source.slice(index);
      break;
    }
    const tag = parseTag(source, index, end);
    if (tag && !tag.closing && DANGEROUS_TAGS.has(tag.name)) {
      const closeEnd = findClosingTag(source, tag.name, end + 1);
      if (closeEnd < 0) break;
      index = closeEnd + 1;
      continue;
    }
    result += source.slice(index, end + 1);
    index = end + 1;
  }
  return result;
}

function isAsciiWord(value) {
  if (!value) return false;
  for (const character of value) {
    const code = character.codePointAt(0);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isDigit = code >= 48 && code <= 57;
    if (!isLetter && !isDigit && character !== "_") return false;
  }
  return true;
}

function allowedTagMarkup(source, start, end) {
  const tag = parseTag(source, start, end);
  if (!tag || tag.closing) return null;
  let canonicalOpen = null;
  if (tag.name === "strong" && !tag.remainder) {
    canonicalOpen = "<strong>";
  } else if (tag.name === "span" && tag.remainder.toLowerCase() === 'class="stat-green-add"') {
    canonicalOpen = '<span class="stat-green-add">';
  } else if (tag.name === "u") {
    const prefix = 'class="tooltip-tag-inline" data-tag-key="';
    const suffix = '" role="button" tabindex="0"';
    const lowerRemainder = tag.remainder.toLowerCase();
    if (lowerRemainder.startsWith(prefix) && lowerRemainder.endsWith(suffix)) {
      const tagKey = tag.remainder.slice(prefix.length, tag.remainder.length - suffix.length);
      if (isAsciiWord(tagKey)) {
        canonicalOpen = `<u class="tooltip-tag-inline" data-tag-key="${tagKey}" role="button" tabindex="0">`;
      }
    }
  }
  if (!canonicalOpen) return null;
  const closeToken = `</${tag.name}>`;
  const closeStart = source.toLowerCase().indexOf(closeToken, end + 1);
  if (closeStart < 0) return null;
  const inner = source.slice(end + 1, closeStart);
  return {
    end: closeStart + closeToken.length,
    html: `${canonicalOpen}${escapeHtml(inner)}${closeToken}`
  };
}

/**
 * 純字串白名單標籤消毒器（零 DOM 依賴）
 * 僅保留 <strong>, <span class="stat-green-add">, <u class="tooltip-tag-inline" ...>
 *
 * @param {string} markup
 * @returns {string}
 */
export function sanitizeGameMarkup(markup) {
  if (!markup) return "";
  const safeText = stripDangerousElements(markup);
  const { text, tokens } = protectAllowedMarkup(safeText);
  const stripped = stripHtmlTags(text);
  return restoreMarkupTokens(stripped, tokens);
}

function protectAllowedMarkup(value) {
  const tokens = [];
  const addToken = (html) => {
    const placeholder = `__TOKEN_VALID_HTML_${tokens.length}__`;
    tokens.push(html);
    return placeholder;
  };
  let text = "";
  for (let index = 0; index < value.length;) {
    const start = value.indexOf("<", index);
    if (start < 0) {
      text += value.slice(index);
      break;
    }
    text += value.slice(index, start);
    const end = nextTagEnd(value, start);
    if (end < 0) {
      text += value.slice(start);
      break;
    }
    const allowed = allowedTagMarkup(value, start, end);
    if (!allowed) {
      text += value.slice(start, end + 1);
      index = end + 1;
      continue;
    }
    text += addToken(allowed.html);
    index = allowed.end;
  }
  return { text, tokens };
}

function restoreMarkupTokens(value, tokens) {
  return tokens.reduce((text, html, index) => text.replaceAll(`__TOKEN_VALID_HTML_${index}__`, html), value);
}

function parseNumeric(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = typeof val === "number" ? val : Number.parseFloat(String(val));
  return Number.isNaN(num) ? fallback : num;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function formatNumericValue(value, { absolute = false } = {}) {
  if (!hasValue(value)) return "";
  const numeric = parseNumeric(value, Number.NaN);
  if (!Number.isFinite(numeric)) return String(value);
  const displayValue = absolute ? Math.abs(numeric) : numeric;
  return Number.isInteger(displayValue)
    ? String(displayValue)
    : Number.parseFloat(displayValue.toFixed(2)).toString();
}

function calculateRankedRuneValue(value, rankAdd, currentRank) {
  const add = parseNumeric(rankAdd, 0);
  if (hasValue(rankAdd) && add !== 0) {
    return parseNumeric(value, 0) + (currentRank - 1) * add;
  }
  return value ?? "";
}

/**
 * RuneTable stores reductions as negative internal modifiers, while the
 * localized descriptions render their magnitudes. Keep each value axis
 * independent because a rune may combine a normal interval with a negative
 * duration/amount modifier.
 */
function runeValueUsesReductionMagnitude(node, valueField, rankAddField) {
  return parseNumeric(node?.[valueField], 0) < 0 || parseNumeric(node?.[rankAddField], 0) < 0;
}

function resolveTagOptions(optionsOrTagDefs) {
  if (optionsOrTagDefs && (optionsOrTagDefs.tagDefinitions || optionsOrTagDefs.tagMap)) {
    return {
      tagDefs: optionsOrTagDefs.tagDefinitions || {},
      tagMap: optionsOrTagDefs.tagMap || DEFAULT_TAG_MAP
    };
  }
  return { tagDefs: optionsOrTagDefs || {}, tagMap: DEFAULT_TAG_MAP };
}

function formatPassiveNodeText(text, node, currentRank) {
  const baseValue = parseNumeric(node.passive_value, 0);
  const rankAdd = parseNumeric(node.passive_rank_add, 0);
  const currentValue = baseValue + (currentRank - 1) * rankAdd;
  const currentValueText = Number.isInteger(currentValue)
    ? currentValue.toString()
    : Number.parseFloat(currentValue.toFixed(2)).toString();
  const withValue = text.replaceAll("{0}", `<strong>${currentValueText}</strong>`);
  return node.passive_rank_add ? withValue.replaceAll("{1}", String(node.passive_rank_add)) : withValue;
}

function formatRuneNodeText(text, node, currentRank) {
  const value1UsesMagnitude = runeValueUsesReductionMagnitude(node, "rune_value1", "rune_value1_rank_add");
  const currentValue1 = calculateRankedRuneValue(node.rune_value1, node.rune_value1_rank_add, currentRank);
  const currentValue1Text = formatNumericValue(currentValue1, { absolute: value1UsesMagnitude });
  const value2UsesMagnitude = runeValueUsesReductionMagnitude(node, "rune_value2", "rune_value2_rank_add");
  const currentValue2 = calculateRankedRuneValue(node.rune_value2, node.rune_value2_rank_add, currentRank);
  const currentValue2Text = formatNumericValue(currentValue2, { absolute: value2UsesMagnitude });
  const value1AddText = formatNumericValue(node.rune_value1_rank_add, { absolute: value1UsesMagnitude });
  const value2AddText = formatNumericValue(node.rune_value2_rank_add, { absolute: value2UsesMagnitude });
  let firstAdd = value1AddText;
  if (!hasValue(node.rune_value1_rank_add)) {
    firstAdd = currentValue2Text && !text.includes("{2}") ? `<strong>${currentValue2Text}</strong>` : "";
  }
  const replacements = {
    "{0}": currentValue1Text ? `<strong>${currentValue1Text}</strong>` : "",
    "{1}": firstAdd,
    "{2}": currentValue2Text ? `<strong>${currentValue2Text}</strong>` : "",
    "{3}": hasValue(node.rune_value2_rank_add) ? value2AddText : "",
    "{4}": node.rune_duration ? `<strong>${node.rune_duration}</strong>` : "",
    "{5}": node.rune_duration_rank_add ? String(node.rune_duration_rank_add) : ""
  };
  return Object.entries(replacements).reduce((result, [token, replacement]) => result.replaceAll(token, replacement), text);
}

function formatDiceNodeText(text, node) {
  return text
    .replaceAll("{0}", `<strong>${node.dice_attack ?? ""}</strong>`)
    .replaceAll("{1}", `<strong>${node.dice_attack_interval ?? ""}</strong>`);
}

function formatNodeText(text, node, currentRank) {
  if (node.node_type === "PLAYER_PASSIVE") return formatPassiveNodeText(text, node, currentRank);
  if (node.node_type === "DICE_RUNE") return formatRuneNodeText(text, node, currentRank);
  return formatDiceNodeText(text, node);
}

function replaceTagMarkup(text, tagDefs, tagMap) {
  return text.replaceAll(/<tag>(\w+)<\/tag>/gi, (_, tag) => {
    const tagKey = tag.toUpperCase();
    const tagName = tagDefs[tagKey]?.name_zh || tagMap[tagKey] || tag;
    return `<u class="tooltip-tag-inline" data-tag-key="${tagKey}" role="button" tabindex="0">${tagName}</u>`;
  });
}

function isIncrementBody(value) {
  if (!value) return false;
  let hasDigit = false;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= 48 && code <= 57) {
      hasDigit = true;
      continue;
    }
    if (character !== "." && character !== "%" && character !== "秒" && character !== "個" && character !== "次") return false;
  }
  return hasDigit;
}

function isInsideIncrementSpan(source, index) {
  const open = source.lastIndexOf('<span class="stat-green-add">', index);
  const close = source.lastIndexOf("</span>", index);
  return open > close;
}

function wrapIncrementMarkers(value) {
  const source = String(value ?? "");
  let result = "";
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("(+", cursor);
    if (start < 0) {
      result += source.slice(cursor);
      break;
    }
    result += source.slice(cursor, start);
    const close = source.indexOf(")", start + 2);
    if (close < 0) {
      result += source.slice(start);
      break;
    }
    const body = source.slice(start + 2, close);
    if (isIncrementBody(body) && !isInsideIncrementSpan(source, start)) {
      result += `<span class="stat-green-add">(+${body})</span>`;
    } else {
      result += source.slice(start, close + 1);
    }
    cursor = close + 1;
  }
  return result;
}

function normalizeFormattedMarkup(text) {
  return wrapIncrementMarkers(text)
    .replaceAll(/\(\+\s*%?\)/g, "")
    .replaceAll(/<span class="stat-green-add">\(\+\s*%?\)<\/span>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll(/<br\s*\/?>/gi, " ")
    .trim();
}

/**
 * 格式化遊戲文案 (包含佔位符替換、階級計算、滿級增量剝除與標籤解析)
 *
 * @param {string} rawText - 原始範本文案
 * @param {Object} [node] - 關聯的節點資料
 * @param {number} [currentRank=1] - 目前階級 (1~max_rank)
 * @param {Object} [optionsOrTagDefs] - 標籤字典或選項物件
 * @returns {string} - 安全的 HTML 格式化字串
 */
export function formatGameText(rawText, node, currentRank = 1, optionsOrTagDefs = {}) {
  if (!rawText) return "";
  let text = String(rawText);

  const maxRank = node?.max_rank || 1;
  const isMaxRank = maxRank > 1 && currentRank >= maxRank;
  const { tagDefs, tagMap } = resolveTagOptions(optionsOrTagDefs);
  if (node) text = formatNodeText(text, node, currentRank);

  // 滿級或單階無升級時，隱藏下一階級預覽增量
  if (isMaxRank || (maxRank <= 1 && (!node?.rune_value1_rank_add && !node?.rune_value2_rank_add && !node?.passive_rank_add))) {
    text = replaceGreenColorSections(text, () => "");
  }

  text = replaceGreenColorSections(text, (inner) => `<span class="stat-green-add">${inner}</span>`);
  text = normalizeFormattedMarkup(replaceTagMarkup(text, tagDefs, tagMap));
  return sanitizeGameMarkup(stripColorTags(text));
}

function resolvePassiveText(text, node) {
  return text
    .replaceAll("{0}", node.passive_value || "0")
    .replaceAll("{1}", node.passive_rank_add ? `(+${node.passive_rank_add}%)` : "");
}

function resolveRuneText(text, node) {
  const value1UsesMagnitude = runeValueUsesReductionMagnitude(node, "rune_value1", "rune_value1_rank_add");
  const value2UsesMagnitude = runeValueUsesReductionMagnitude(node, "rune_value2", "rune_value2_rank_add");
  const value1 = formatNumericValue(node.rune_value1, { absolute: value1UsesMagnitude });
  const value2 = formatNumericValue(node.rune_value2, { absolute: value2UsesMagnitude });
  const value1Add = formatNumericValue(node.rune_value1_rank_add, { absolute: value1UsesMagnitude });
  const value2Add = formatNumericValue(node.rune_value2_rank_add, { absolute: value2UsesMagnitude });
  const firstAdd = hasValue(node.rune_value1_rank_add)
    ? `(+${value1Add})`
    : value2;
  const replacements = {
    "{0}": value1,
    "{1}": firstAdd,
    "{2}": value2,
    "{3}": hasValue(node.rune_value2_rank_add) ? `(+${value2Add})` : "",
    "{4}": node.rune_duration || "",
    "{5}": node.rune_duration_rank_add ? `(+${node.rune_duration_rank_add}秒)` : ""
  };
  return Object.entries(replacements).reduce((result, [token, replacement]) => result.replaceAll(token, replacement), text);
}

function resolveNodeText(text, node) {
  if (node.node_type === "PLAYER_PASSIVE") return resolvePassiveText(text, node);
  if (node.node_type === "DICE_RUNE") return resolveRuneText(text, node);
  return text;
}

function resolveTextTags(text, tagDefs, tagMap) {
  return text.replaceAll(/<tag>(\w+)<\/tag>/gi, (_, tag) => {
    const tagKey = tag.toUpperCase();
    return tagDefs[tagKey]?.name_zh || tagMap[tagKey] || tag;
  });
}

function decodeTextEntities(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll(/<br\s*\/?>/gi, " ")
    .trim();
}

/**
 * 解析純文字文案 (用於倒排搜尋索引與無標籤標籤)
 *
 * @param {string} value
 * @param {Object} [node]
 * @param {Object} [options]
 * @returns {string}
 */
export function resolveGameText(value, node, options = {}) {
  if (!value) return "";
  let text = String(value);
  const tagDefs = options.tagDefinitions || {};
  const tagMap = options.tagMap || DEFAULT_TAG_MAP;
  if (node) text = resolveNodeText(text, node);
  text = resolveTextTags(text, tagDefs, tagMap);
  return decodeTextEntities(stripColorTags(stripHtmlTags(text)));
}
