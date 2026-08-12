/**
 * @fileoverview 詳細能力 (Detailed Stats) 領域純計算模組
 * @module domain/detailed_stats
 */

import { FACTION_DATA } from "./faction_data.js";

/**
 * 格式化數值字串 (最多保留 2 位小數，自動去除末尾無效 0)
 * @param {number} value
 * @returns {string}
 */
export function formatStatValue(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  let formatted = rounded.toFixed(2);
  while (formatted.endsWith("0")) formatted = formatted.slice(0, -1);
  return formatted.endsWith(".") ? formatted.slice(0, -1) : formatted;
}

function stripColorSections(value) {
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
    cursor = close + closeToken.length;
  }
  return result;
}

function normalizeNodeList(nodes) {
  if (nodes instanceof Map) return Array.from(nodes.values());
  if (Array.isArray(nodes)) return nodes;
  if (nodes && typeof nodes === "object") {
    return Object.entries(nodes).map(([key, value]) => (
      typeof value === "object" && value !== null ? { ...value, _key: key } : value
    ));
  }
  return [];
}

function createStatsResult() {
  return {
    global: [],
    branches: {
      1: { id: 1, name: FACTION_DATA[1]?.name || "自然", color: FACTION_DATA[1]?.color || "#8ae665", stats: [] },
      2: { id: 2, name: FACTION_DATA[2]?.name || "工學", color: FACTION_DATA[2]?.color || "#f9da67", stats: [] },
      3: { id: 3, name: FACTION_DATA[3]?.name || "魔法", color: FACTION_DATA[3]?.color || "#4591f0", stats: [] },
      4: { id: 4, name: FACTION_DATA[4]?.name || "秩序", color: FACTION_DATA[4]?.color || "#9c97bc", stats: [] },
      5: { id: 5, name: FACTION_DATA[5]?.name || "渾沌", color: FACTION_DATA[5]?.color || "#aa3cea", stats: [] }
    }
  };
}

function isGlobalPassive(node, name) {
  return (!node.passive_group || node.passive_group === "None")
    || name.startsWith("所有骰子")
    || name.includes("全域")
    || name.includes("起始SP")
    || name.includes("生命值")
    || (node.passive_id && (node.passive_id.startsWith("PlayerStartSpUp") || node.passive_id.startsWith("PlayerStartHpUp")));
}

function statTemplate(node) {
  return stripColorSections(node._canonical_description_zh || node.description_zh || "")
    .replaceAll(/<\/?[a-z][^>]*>/gi, "")
    .trim();
}

function accumulatePassiveNode(node, activeRanks, globalMap, branchMaps) {
  if (node?.node_type !== "PLAYER_PASSIVE") return;
  const rank = activeRanks === null || activeRanks === undefined
    ? node.max_rank || 1
    : Number(activeRanks[node.id]) || Number(activeRanks[node._key]) || 0;
  if (rank <= 0) return;
  const currentValue = (Number.parseFloat(node.passive_value) || 0)
    + (rank - 1) * (Number.parseFloat(node.passive_rank_add) || 0);
  if (currentValue <= 0) return;

  const name = node._canonical_name_zh || node.name_zh || "";
  const template = statTemplate(node);
  if (!template) return;
  const hasPlaceholder = template.includes("{0}");
  const templateKey = hasPlaceholder ? template.replaceAll("{0}", "__VAL__") : template;
  const branchId = Number(node.branch) || 1;
  const targetMap = isGlobalPassive(node, name) ? globalMap : (branchMaps[branchId] || branchMaps[1]);
  if (!targetMap.has(templateKey)) {
    targetMap.set(templateKey, {
      key: templateKey,
      name,
      sourceKey: node._descriptionKey || null,
      template,
      hasPlaceholder,
      totalValue: 0,
      order: Number(node.index) || 0
    });
  }
  targetMap.get(templateKey).totalValue += currentValue;
}

function globalPriority(template) {
  if (template.includes("所有骰子") || template.includes("子彈傷害")) return 1;
  if (template.includes("起始SP")) return 2;
  if (template.includes("生命值")) return 3;
  return 4;
}

function formatStatItem(item) {
  return {
    key: item.key,
    name: item.name,
    sourceKey: item.sourceKey,
    totalValue: Math.round(item.totalValue * 10000) / 10000,
    text: item.hasPlaceholder ? item.template.replaceAll("{0}", formatStatValue(item.totalValue)) : item.template,
    order: item.order
  };
}

/**
 * 彙總詳細能力 (純領域計算，零外部依賴)
 *
 * @param {Record<string, any>|any[]} nodes - 骰子樹節點集合
 * @param {Record<string, number>|null} [activeRanks=null] - 模擬模式下的已配置階級映射，若為 null 則視為普通模式 (全滿級加總)
 * @returns {{
 *   global: Array<{ key: string, name: string, totalValue: number, text: string, order: number }>,
 *   branches: Record<number, { id: number, name: string, color: string, stats: Array<{ key: string, name: string, totalValue: number, text: string, order: number }> }>
 * }}
 */
export function aggregateDetailedStats(nodes, activeRanks = null) {
  const nodeList = normalizeNodeList(nodes);
  const result = createStatsResult();

  const globalMap = new Map();
  const branchMaps = {
    1: new Map(),
    2: new Map(),
    3: new Map(),
    4: new Map(),
    5: new Map()
  };

  for (const node of nodeList) {
    accumulatePassiveNode(node, activeRanks, globalMap, branchMaps);
  }

  // 定義全域條目的優先排序權重：1. 所有骰子傷害, 2. 起始SP, 3. 最大生命值, 4. 其他
  result.global = Array.from(globalMap.values())
    .sort((a, b) => {
      const pA = globalPriority(a.template);
      const pB = globalPriority(b.template);
      if (pA !== pB) return pA - pB;
      return a.order - b.order;
    })
    .map(formatStatItem);

  // 轉換並格式化各陣營條目
  for (const branchId of [1, 2, 3, 4, 5]) {
    const map = branchMaps[branchId];
    result.branches[branchId].stats = Array.from(map.values())
      .sort((a, b) => a.order - b.order)
      .map(formatStatItem);
  }

  return result;
}
