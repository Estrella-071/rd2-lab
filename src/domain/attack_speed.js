/**
 * @fileoverview 戰場棋盤攻擊速度計算領域核心 (Domain Core - Zero Dependencies)
 * @module domain/attack_speed
 */

export const BATTLEFIELD_ROWS = 3;
export const BATTLEFIELD_COLS = 5;
export const TOTAL_BATTLEFIELD_SLOTS = 15;
export const MIN_ATTACK_INTERVAL = 0.01;

export function getSlotCoords(slotIndex) {
  if (typeof slotIndex !== "number" || slotIndex < 0 || slotIndex >= TOTAL_BATTLEFIELD_SLOTS) {
    return { row: -1, col: -1 };
  }
  return {
    row: Math.floor(slotIndex / BATTLEFIELD_COLS),
    col: slotIndex % BATTLEFIELD_COLS
  };
}

export function areSlotsAdjacent(slotA, slotB) {
  if (slotA === slotB) return false;
  const a = getSlotCoords(slotA);
  const b = getSlotCoords(slotB);
  if (a.row === -1 || b.row === -1) return false;
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

export function getAdjacentSlotIndices(slotIndex) {
  const coords = getSlotCoords(slotIndex);
  if (coords.row === -1) return [];
  const adjacent = [];
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];
  for (const [dr, dc] of deltas) {
    const nr = coords.row + dr;
    const nc = coords.col + dc;
    if (nr >= 0 && nr < BATTLEFIELD_ROWS && nc >= 0 && nc < BATTLEFIELD_COLS) {
      adjacent.push(nr * BATTLEFIELD_COLS + nc);
    }
  }
  return adjacent;
}

export function calculateReductionTime(baseInterval, bonusRate) {
  if (!baseInterval || baseInterval <= 0 || !bonusRate || bonusRate <= 0) {
    return 0;
  }
  return baseInterval * (bonusRate / (1 + bonusRate));
}

export function computeAttackSpeed({ baseInterval = 1.0, sources = [] }) {
  const base = Math.max(0.01, Number(baseInterval) || 1.0);
  let totalReduction = 0;
  const reductions = [];

  for (const src of sources) {
    const rate = Math.max(0, Number(src.bonusRate) || 0);
    const reducedTime = calculateReductionTime(base, rate);
    totalReduction += reducedTime;
    reductions.push({
      id: src.id || "unknown",
      name: src.name || "未指定加成",
      bonusRate: rate,
      reducedTime
    });
  }

  const rawInterval = base - totalReduction;
  const isClamped = rawInterval < MIN_ATTACK_INTERVAL;
  const finalInterval = Math.max(MIN_ATTACK_INTERVAL, rawInterval);
  const attacksPerSecond = 1 / finalInterval;
  const speedMultiplier = base / finalInterval;

  return {
    baseInterval: Number(base.toFixed(4)),
    finalInterval: Number(finalInterval.toFixed(4)),
    attacksPerSecond: Number(attacksPerSecond.toFixed(2)),
    speedMultiplier: Number(speedMultiplier.toFixed(2)),
    totalReduction: Number(totalReduction.toFixed(4)),
    isClamped,
    reductions
  };
}

export function calculateLightDiceBonusRate({ dot = 1, classLevel = 7, powerUpLevel = 1 }) {
  const validDot = Math.min(7, Math.max(1, Number(dot) || 1));
  const validClass = Math.min(15, Math.max(7, Number(classLevel) || 7));
  const validPower = Math.min(5, Math.max(1, Number(powerUpLevel) || 1));

  const perDotRate = 0.06 + (validClass - 7) * 0.006 + (validPower - 1) * 0.015;
  const starMultiplier = validDot === 7 ? 1.15 : 1.0;

  return perDotRate * validDot * starMultiplier;
}

export function calculateResonanceBonusRate({ matchingAdjacentCount = 0, classLevel = 7, powerUpLevel = 1 }) {
  const count = Math.min(4, Math.max(0, Number(matchingAdjacentCount) || 0));
  if (count === 0) return 0;
  const validClass = Math.min(15, Math.max(7, Number(classLevel) || 7));
  const validPower = Math.min(5, Math.max(1, Number(powerUpLevel) || 1));

  const perCountRate = 0.12 + (validClass - 7) * 0.01 + (validPower - 1) * 0.02;
  return perCountRate * count;
}

export function evaluateBattlefieldTarget({
  board = [],
  targetIndex = 7,
  customBaseInterval = 1.0,
  treeBonusRate = 0,
  blessingBonusRate = 0,
  eventBonusRate = 0
}) {
  const targetSlot = board[targetIndex];
  const baseInterval = customBaseInterval || (targetSlot && targetSlot.baseInterval) || 1.0;

  const adjacentIndices = getAdjacentSlotIndices(targetIndex);
  const activeRayLinks = [];
  let lightBonusSum = 0;
  let resonanceBonusSum = 0;

  for (const adjIdx of adjacentIndices) {
    const adjSlot = board[adjIdx];
    if (!adjSlot) continue;

    if (adjSlot.type === "light" || adjSlot.id === "dice_light" || adjSlot.diceName === "光") {
      const rate = calculateLightDiceBonusRate({
        dot: adjSlot.dot || 1,
        classLevel: adjSlot.classLevel || 7,
        powerUpLevel: adjSlot.powerUpLevel || 1
      });
      lightBonusSum += rate;
      activeRayLinks.push({
        fromIndex: adjIdx,
        toIndex: targetIndex,
        type: "light",
        rate
      });
    }

    if (adjSlot.type === "resonance" || adjSlot.id === "dice_resonance" || adjSlot.diceName === "共鳴") {
      const resAdj = getAdjacentSlotIndices(adjIdx);
      let matchCount = 0;
      for (const raIdx of resAdj) {
        if (board[raIdx] && board[raIdx].dot === adjSlot.dot) {
          matchCount++;
        }
      }
      const rate = calculateResonanceBonusRate({
        matchingAdjacentCount: matchCount,
        classLevel: adjSlot.classLevel || 7,
        powerUpLevel: adjSlot.powerUpLevel || 1
      });
      resonanceBonusSum += rate;
      activeRayLinks.push({
        fromIndex: adjIdx,
        toIndex: targetIndex,
        type: "resonance",
        rate
      });
    }
  }

  const sources = [];
  if (lightBonusSum > 0) {
    sources.push({ id: "light", name: "光骰子相鄰加成", bonusRate: lightBonusSum });
  }
  if (resonanceBonusSum > 0) {
    sources.push({ id: "resonance", name: "共鳴骰子連線", bonusRate: resonanceBonusSum });
  }
  if (treeBonusRate > 0) {
    sources.push({ id: "tree", name: "骰子樹攻速加成", bonusRate: treeBonusRate });
  }
  if (blessingBonusRate > 0) {
    sources.push({ id: "blessing", name: "祝福詞條加成", bonusRate: blessingBonusRate });
  }
  if (eventBonusRate > 0) {
    sources.push({ id: "event", name: "戰術事件增益", bonusRate: eventBonusRate });
  }

  const speedResult = computeAttackSpeed({ baseInterval, sources });

  return {
    targetIndex,
    targetSlot,
    adjacentIndices,
    activeRayLinks,
    speedResult
  };
}
