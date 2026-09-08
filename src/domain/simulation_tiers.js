/**
 * @fileoverview 模擬階段梯隊與優先度成長線領域核心 (Domain Core - Zero Dependencies)
 * @module domain/simulation_tiers
 */

/**
 * 梯隊資料結構工廠
 * @param {Object} params
 * @param {string} params.id 梯隊唯一 ID，如 "t0", "t1"
 * @param {string} params.name 顯示簡稱，如 "T0", "T1"
 * @param {string} [params.label=""] 階段說明標籤，如 "核心下限 (必備)"
 * @param {boolean} [params.isBaseline=false] 是否為最低啟動門檻下限 (沒點到玩不起來)
 * @param {string} [params.note=""] 戰術備註
 * @param {Object.<string, number>} [params.allocations={}] 該梯隊各節點加點 { [nodeId]: rank }
 * @param {{ gold: number, dice: number, solarCores: number }} [params.cost] 累積消耗
 * @returns {Object}
 */
export function createProgressionTier({
  id = "t0",
  name = "T0",
  label = "",
  isBaseline = false,
  note = "",
  allocations = {},
  cost = { gold: 0, dice: 0, solarCores: 0 }
}) {
  return {
    id: String(id),
    name: String(name),
    label: String(label || (isBaseline ? "核心下限" : "")),
    isBaseline: Boolean(isBaseline),
    note: String(note || ""),
    allocations: { ...allocations },
    cost: {
      gold: Number(cost.gold) || 0,
      dice: Number(cost.dice) || 0,
      solarCores: Number(cost.solarCores) || 0
    }
  };
}

/**
 * 依據節點表計算指定 allocations 的累積資源消耗
 * @param {Object.<string, number>} allocations
 * @param {Map<string, Object>|Object} nodesMap
 * @returns {{ gold: number, dice: number, solarCores: number }}
 */
export function calculateAllocationsCost(allocations = {}, nodesMap) {
  let gold = 0;
  let dice = 0;
  let solarCores = 0;

  if (!nodesMap) return { gold, dice, solarCores };

  const getMapNode = (id) => (nodesMap instanceof Map ? nodesMap.get(id) : nodesMap[id]);

  for (const [nodeId, rank] of Object.entries(allocations)) {
    const r = Number(rank) || 0;
    if (r <= 0) continue;
    const node = getMapNode(nodeId);
    if (!node) continue;

    // 太陽核心特殊節點判斷
    if (node.isSolar || node.requiresSolarCore) {
      solarCores += r;
    }

    // 計算金幣與骰子消耗 (支援 costs 陣列或每級單價)
    if (Array.isArray(node.costs)) {
      for (let i = 0; i < Math.min(r, node.costs.length); i++) {
        const c = node.costs[i];
        if (c) {
          gold += Number(c.gold) || 0;
          dice += Number(c.dice) || 0;
        }
      }
    } else {
      const perGold = Number(node.costGold) || Number(node.gold_cost) || 0;
      const perDice = Number(node.costDice) || Number(node.dice_cost) || 0;
      gold += perGold * r;
      dice += perDice * r;
    }
  }

  return { gold, dice, solarCores };
}

/**
 * 計算兩梯隊之間的資源增量與晉級節點
 * @param {Object} baseTier 基準較低階梯
 * @param {Object} targetTier 目標較高階梯
 * @param {Map<string, Object>|Object} [nodesMap]
 * @returns {{
 *   goldDelta: number,
 *   diceDelta: number,
 *   solarCoresDelta: number,
 *   upgradedNodes: Array<{ nodeId: string, fromRank: number, toRank: number }>
 * }}
 */
export function calculateTierDelta(baseTier, targetTier, nodesMap) {
  const baseCost = baseTier?.cost || (nodesMap ? calculateAllocationsCost(baseTier?.allocations, nodesMap) : { gold: 0, dice: 0, solarCores: 0 });
  const targetCost = targetTier?.cost || (nodesMap ? calculateAllocationsCost(targetTier?.allocations, nodesMap) : { gold: 0, dice: 0, solarCores: 0 });

  const goldDelta = Math.max(0, (targetCost.gold || 0) - (baseCost.gold || 0));
  const diceDelta = Math.max(0, (targetCost.dice || 0) - (baseCost.dice || 0));
  const solarCoresDelta = Math.max(0, (targetCost.solarCores || 0) - (baseCost.solarCores || 0));

  const upgradedNodes = [];
  const baseAlloc = baseTier?.allocations || {};
  const targetAlloc = targetTier?.allocations || {};

  const allNodeIds = new Set([...Object.keys(baseAlloc), ...Object.keys(targetAlloc)]);
  for (const nodeId of allNodeIds) {
    const fromRank = Number(baseAlloc[nodeId]) || 0;
    const toRank = Number(targetAlloc[nodeId]) || 0;
    if (toRank > fromRank) {
      upgradedNodes.push({ nodeId, fromRank, toRank });
    }
  }

  return {
    goldDelta,
    diceDelta,
    solarCoresDelta,
    upgradedNodes
  };
}

/**
 * 檢查梯隊序列的單調遞進性 (較高級梯隊不可倒退低於較低級梯隊加點)
 * @param {Array<Object>} tiers
 * @returns {{ isValid: boolean, violations: string[] }}
 */
export function validateTierMonotonicity(tiers = []) {
  if (!Array.isArray(tiers) || tiers.length <= 1) {
    return { isValid: true, violations: [] };
  }

  const violations = [];
  for (let i = 0; i < tiers.length - 1; i++) {
    const cur = tiers[i];
    const next = tiers[i + 1];
    const curAlloc = cur.allocations || {};
    const nextAlloc = next.allocations || {};

    for (const [nodeId, rank] of Object.entries(curAlloc)) {
      const nextRank = Number(nextAlloc[nodeId]) || 0;
      if (nextRank < rank) {
        violations.push(`${next.name || `梯隊${i+1}`} 節點 ${nodeId} 等級 (${nextRank}) 低於前一階 ${cur.name || `梯隊${i}`} 等級 (${rank})`);
      }
    }
  }

  return {
    isValid: violations.length === 0,
    violations
  };
}

/**
 * 智慧階梯生成演算法 (Smart Progression Tiers Suggester)
 * 當玩家配了一套滿配加點，自動推導出 T0 (核心下限)、T1 (過渡)、T2 (成型)、T3 (完全體)
 * @param {Object.<string, number>} fullAllocations 滿配配置
 * @param {Map<string, Object>|Object} nodesMap
 * @returns {Array<Object>}
 */
export function generateSmartProgressionTiers(fullAllocations = {}, nodesMap) {
  const entries = Object.entries(fullAllocations).filter(([_, rank]) => Number(rank) > 0);
  if (entries.length === 0) {
    return [createProgressionTier({ id: "t0", name: "T0", label: "核心下限", isBaseline: true, allocations: {} })];
  }

  const getMapNode = (id) => (nodesMap instanceof Map ? nodesMap.get(id) : (nodesMap ? nodesMap[id] : null));

  // 節點權重評分：核心打手與光輔助優先級最高，特性次之，一般點數再次之
  const scoredNodes = entries.map(([nodeId, maxRank]) => {
    const node = getMapNode(nodeId);
    let priority = 1; // 預設優先度
    const name = node?.name || node?.title || "";
    const desc = node?.desc || node?.description || "";

    if (name.includes("光") || desc.includes("光") || name.includes("共鳴") || desc.includes("共鳴")) {
      priority = 4; // 光與共鳴是核心輔助
    } else if (node?.isMastery || node?.isTrait || name.includes("特性")) {
      priority = 3; // 特性
    } else if (name.includes("攻擊") || name.includes("暴擊") || desc.includes("攻擊速度")) {
      priority = 3;
    } else if (name.includes("SP") || desc.includes("SP")) {
      priority = 2;
    }

    return { nodeId, maxRank, priority, node };
  });

  // 1. 【T0 核心下限】：僅取高優先度節點，且等級折半 (最低啟動門檻)
  const t0Alloc = {};
  for (const { nodeId, maxRank, priority } of scoredNodes) {
    if (priority >= 3) {
      // 核心節點達到 1/3 ~ 1/2
      t0Alloc[nodeId] = Math.max(1, Math.floor(maxRank * 0.4));
    } else if (priority === 2) {
      t0Alloc[nodeId] = Math.max(1, Math.floor(maxRank * 0.25));
    }
  }
  // 若 T0 空白，至少保證前 3 個節點有基礎等級
  if (Object.keys(t0Alloc).length === 0) {
    for (const { nodeId, maxRank } of scoredNodes.slice(0, 3)) {
      t0Alloc[nodeId] = Math.max(1, Math.floor(maxRank * 0.5));
    }
  }
  const t0Cost = calculateAllocationsCost(t0Alloc, nodesMap);
  const t0 = createProgressionTier({
    id: "t0",
    name: "T0",
    label: "核心下限 (必備門檻)",
    isBaseline: true,
    note: "未點到此門檻組合難以正常啟動，強烈建議優先解鎖此階段",
    allocations: t0Alloc,
    cost: t0Cost
  });

  // 2. 【T1 過渡體系】：核心升至約 70%，其餘節點開鎖 40%
  const t1Alloc = { ...t0Alloc };
  for (const { nodeId, maxRank, priority } of scoredNodes) {
    const current = t1Alloc[nodeId] || 0;
    const target = priority >= 3 ? Math.floor(maxRank * 0.75) : Math.floor(maxRank * 0.5);
    t1Alloc[nodeId] = Math.max(current, target);
  }
  const t1Cost = calculateAllocationsCost(t1Alloc, nodesMap);
  const t1 = createProgressionTier({
    id: "t1",
    name: "T1",
    label: "基礎體系成型",
    isBaseline: false,
    note: "核心輔助與主力等級初步成型，具備常規推波能力",
    allocations: t1Alloc,
    cost: t1Cost
  });

  // 3. 【T2 完全體】：全部配置
  const t2Cost = calculateAllocationsCost(fullAllocations, nodesMap);
  const t2 = createProgressionTier({
    id: "t2",
    name: "T2",
    label: "極限完全體",
    isBaseline: false,
    note: "全部節點與特性完全滿配，發揮陣容 100% 潛力",
    allocations: { ...fullAllocations },
    cost: t2Cost
  });

  return [t0, t1, t2];
}

/**
 * 序列化梯隊資料結構為乾淨的傳輸物件
 * @param {Array<Object>} tiers
 * @returns {Array<Object>}
 */
export function exportTiersForShare(tiers = []) {
  return tiers.map(tier => ({
    id: tier.id,
    name: tier.name,
    label: tier.label || "",
    isBaseline: Boolean(tier.isBaseline),
    note: tier.note || "",
    allocations: tier.allocations || {}
  }));
}

/**
 * 從分享或存檔資料復原梯隊資料結構
 * @param {Array<Object>|Object} rawData 可能是梯隊陣列，或舊版單一 ranks 物件
 * @param {Map<string, Object>|Object} [nodesMap]
 * @returns {Array<Object>}
 */
export function importTiersFromShare(rawData, nodesMap) {
  if (Array.isArray(rawData) && rawData.length > 0) {
    return rawData.map((t, idx) => {
      const alloc = t.allocations || {};
      const cost = t.cost || (nodesMap ? calculateAllocationsCost(alloc, nodesMap) : { gold: 0, dice: 0, solarCores: 0 });
      return createProgressionTier({
        id: t.id || `t${idx}`,
        name: t.name || `T${idx}`,
        label: t.label || "",
        isBaseline: Boolean(t.isBaseline || (idx === 0)),
        note: t.note || "",
        allocations: alloc,
        cost
      });
    });
  }

  // 向下相容：若 rawData 為單一加點物件 { [nodeId]: rank }
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const singleAlloc = rawData.ranks || rawData;
    const cost = nodesMap ? calculateAllocationsCost(singleAlloc, nodesMap) : { gold: 0, dice: 0, solarCores: 0 };
    return [
      createProgressionTier({
        id: "t0",
        name: "T0",
        label: "核心配置",
        isBaseline: true,
        note: "預設配置",
        allocations: singleAlloc,
        cost
      })
    ];
  }

  return [
    createProgressionTier({
      id: "t0",
      name: "T0",
      label: "核心下限",
      isBaseline: true,
      note: "未配置節點",
      allocations: {},
      cost: { gold: 0, dice: 0, solarCores: 0 }
    })
  ];
}
