import { formatGameText, escapeHtml } from "../domain/game_text.js";
import { calculateFullDiceBonus, POWERUP_LABELS, DOT_LABELS } from "../domain/dice_bonus.js";
import { shouldPlaceTooltipBelow } from "../domain/tooltip_position.js";
import { resolveNode3Icon } from "../domain/dice_icon.js";
import { ActionTypes } from "../app/store/app_store.js";
import { getRank, getUnlockConditionLabel, evaluateNode, planBatchUnlock, planRevokeNode, isInitialSimulationNode } from "../domain/simulation_plan.js";
import { installImageFallbacks } from "./image_fallback.js";

export { DICE_3_ALIASES } from "../domain/dice_icon.js";
export { resolveNode3Icon };

function forceReflow(element) {
  return element.offsetWidth;
}

const FACTION_DATA = {
  1: { name: "自然", color: "#7ee352", surface: "rgba(126, 227, 82, 0.14)", border: "rgba(126, 227, 82, 0.35)", ink: "#071203" },
  2: { name: "工學", color: "#f5d358", surface: "rgba(245, 211, 88, 0.14)", border: "rgba(245, 211, 88, 0.35)", ink: "#140d02" },
  3: { name: "魔法", color: "#5da0ff", surface: "rgba(93, 160, 255, 0.14)", border: "rgba(93, 160, 255, 0.35)", ink: "#030c18" },
  4: { name: "秩序", color: "#baa6e0", surface: "rgba(186, 166, 224, 0.14)", border: "rgba(186, 166, 224, 0.35)", ink: "#11091a" },
  5: { name: "渾沌", color: "#cb65ff", surface: "rgba(203, 101, 255, 0.14)", border: "rgba(203, 101, 255, 0.35)", ink: "#14031a" },
};

const NODE_TYPE_NAMES = {
  DICE: "骰子",
  DICE_RUNE: "骰子符文",
  PLAYER_PASSIVE: "全域被動",
  PERK: "輔助特性",
};

const SVG_ICONS = {
  stats: `<svg class="section-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"></path><path d="M13 19l6-6"></path><path d="M16 16l4 4"></path><path d="M19 21l2-2"></path></svg>`,
  skill: `<svg class="section-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>`,
  awakening: `<svg class="section-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  unlock: `<svg class="section-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`,
  upgrade: `<svg class="section-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,
  gold: `<svg class="currency-icon-svg gold-icon" viewBox="0 0 1 1" aria-hidden="true"><use href="#sprite-185" xlink:href="#sprite-185"></use></svg>`,
  core: `<svg class="currency-icon-svg core-icon" viewBox="0 0 1 1" aria-hidden="true"><use href="#sprite-186" xlink:href="#sprite-186"></use></svg>`,
};

function hasClass(el, className) {
  if (!el?.classList) return false;
  if (typeof el.classList.contains === "function") return el.classList.contains(className);
  if (typeof el.classList.has === "function") return el.classList.has(className);
  return false;
}

function addClass(el, ...classNames) {
  if (!el?.classList) return;
  classNames.forEach((cn) => {
    if (typeof el.classList.add === "function") el.classList.add(cn);
  });
}

function removeClass(el, ...classNames) {
  if (!el?.classList) return;
  classNames.forEach((cn) => {
    if (typeof el.classList.remove === "function") el.classList.remove(cn);
    else if (typeof el.classList.delete === "function") el.classList.delete(cn);
  });
}

function getRankCost(costs, index, unlockCost) {
  if (costs[index] !== undefined) return costs[index];
  if (index === 0) return unlockCost;
  return 0;
}

function collectRelevantTagKeys(descHtml, tagDefinitions) {
  const keys = [];
  for (const match of descHtml.matchAll(/data-tag-key="([^"]+)"/g)) {
    const tagKey = match[1];
    if (tagDefinitions[tagKey] && !keys.includes(tagKey)) keys.push(tagKey);
  }
  return keys;
}

function createHashtagRow(tagDefinitions, tagKeys) {
  const row = document.createElement("div");
  row.className = "tooltip-hashtag-row";
  tagKeys.forEach((tagKey) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tooltip-hashtag-chip";
    button.dataset.tagKey = tagKey;
    button.textContent = `#${tagDefinitions[tagKey]?.name_zh || tagKey}`;
    row.append(button);
  });
  return row;
}

function appendDescriptionSection(view, container, node, currentRank) {
  const descText = node.description_zh || node.desc || "";
  const descHtml = formatGameText(descText, node.params || node, currentRank, { tagDefinitions: view.tagDefinitions });
  if (!descHtml) return;

  const section = document.createElement("div");
  section.className = "detail-section";
  const paragraph = document.createElement("p");
  paragraph.className = "detail-copy";
  paragraph.innerHTML = descHtml;
  section.append(paragraph);

  const tagKeys = collectRelevantTagKeys(descHtml, view.tagDefinitions);
  if (tagKeys.length > 0) section.append(createHashtagRow(view.tagDefinitions, tagKeys));
  container.append(section);
}

function appendAwakeningSection(view, container, node, currentRank) {
  const awakenText = node.dice_awaken || node.awaken_desc || "";
  if (!awakenText) return;

  const section = document.createElement("div");
  section.className = "detail-section";
  const label = document.createElement("span");
  label.className = "section-label";
  label.textContent = view._t("tooltip.awakening", {}, "Awakening effect");
  const paragraph = document.createElement("p");
  paragraph.className = "detail-copy";
  paragraph.innerHTML = formatGameText(awakenText, node.params || node, currentRank, { tagDefinitions: view.tagDefinitions });
  section.append(label, paragraph);
  container.append(section);
}

function createCombinedBonusButton(className, label, ariaLabel, index) {
  const indexAttribute = index === undefined ? "" : ` data-index="${index}"`;
  return `<button type="button" class="stat-bonus-val stat-bonus-combined ${className}" data-bonus-label="${escapeHtml(label)}" aria-label="${escapeHtml(ariaLabel)}" aria-controls="stat-bonus-popover" aria-expanded="false"${indexAttribute} hidden></button>`;
}

function createDiceStatItem(iconName, label, value, bonusMarkup = "") {
  const item = document.createElement("div");
  item.className = "dice-stat-item";
  item.innerHTML = `
    <div class="dice-stat-icon-box">
      <img src="icons/${iconName}" alt="${escapeHtml(label)}" />
    </div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(label)}</span>
      <span class="dice-stat-val">
        <span class="stat-base-val">${escapeHtml(value)}</span>
        ${bonusMarkup}
      </span>
    </div>
  `;
  return item;
}

function normalizeStatIcon(icon) {
  const candidate = /^[A-Za-z0-9_.-]+\.png$/.test(icon || "") ? icon : "Attack_Icon.png";
  return candidate.replace(/^icons\//, "");
}

function createSpecialStatItem(stat, index, bonusAriaLabel) {
  const item = document.createElement("div");
  item.className = "dice-stat-item";
  const iconName = normalizeStatIcon(stat.icon);
  item.innerHTML = `
    <div class="dice-stat-icon-box">
      <img src="icons/${iconName}" alt="${escapeHtml(stat.label)}" data-fallback-src="icons/Attack_Icon.png" />
    </div>
    <div class="dice-stat-text">
      <span class="dice-stat-label">${escapeHtml(stat.label)}</span>
      <span class="dice-stat-val">
        <span class="stat-base-val">${escapeHtml(stat.value)}</span>
        <span class="stat-bonus-val is-gold dice-stat-bonus-special-powerup" data-index="${index}" hidden></span>
        <span class="stat-bonus-val is-purple dice-stat-bonus-special-dot" data-index="${index}" hidden></span>
        ${createCombinedBonusButton("dice-stat-bonus-special-combined", stat.label, bonusAriaLabel, index)}
      </span>
    </div>
  `;
  return item;
}

function appendDiceStats(view, container, node) {
  const divider = document.createElement("hr");
  divider.className = "tooltip-divider";
  container.append(divider);

  const grid = document.createElement("div");
  grid.className = "dice-stat-grid";
  const attackLabel = view._t("stats.attack", {}, "Attack");
  const speedLabel = view._t("stats.attackSpeed", {}, "Attack speed");
  const targetLabel = view._t("stats.target", {}, "Target");
  const bonusAriaLabel = (label) => view._t(
    "tooltip.bonusDetails",
    { label },
    `View ${label} bonus details`
  );
  grid.append(
    createDiceStatItem(
      "Attack_Icon.png",
      attackLabel,
      node.dice_attack || "0",
      `<span class="stat-bonus-val is-gold dice-stat-bonus-atk-powerup" hidden></span><span class="stat-bonus-val is-purple dice-stat-bonus-atk-dot" hidden></span>${createCombinedBonusButton("dice-stat-bonus-atk-combined", attackLabel, bonusAriaLabel(attackLabel))}`
    ),
    createDiceStatItem(
      "attackspeed_icon.png",
      speedLabel,
      node.dice_attack_interval || "0",
      `<span class="stat-bonus-val is-gold dice-stat-bonus-spd-powerup" hidden></span><span class="stat-bonus-val is-purple dice-stat-bonus-spd-dot" hidden></span>${createCombinedBonusButton("dice-stat-bonus-spd-combined", speedLabel, bonusAriaLabel(speedLabel))}`
    ),
    createDiceStatItem("targetingtype_icon.png", targetLabel, node.dice_target_zh || view._t("target.front", {}, "Front"))
  );

  if (Array.isArray(node.special_stats)) {
    node.special_stats.forEach((stat, index) => grid.append(createSpecialStatItem(stat, index, bonusAriaLabel(stat.label))));
  }
  container.append(grid);

  const buttonRow = document.createElement("div");
  buttonRow.className = "dice-upgrade-action-bar dice-upgrade-btns-row";
  buttonRow.innerHTML = `
    <button type="button" class="dice-upgrade-btn btn-powerup" data-mode="powerup">${escapeHtml(view._t("tooltip.powerup", {}, "Power up"))}</button>
    <button type="button" class="dice-upgrade-btn btn-dot" data-mode="dot">${escapeHtml(view._t("tooltip.dot", {}, "Increase pips"))}</button>
  `;
  container.append(buttonRow);
  view._bindUpgradeButtons(buttonRow, node, container);
}

function appendCompactStats(view, container, node) {
  const statItems = [];
  if (node.rune_duration && node.node_type !== "DICE_RUNE") {
    statItems.push([
      view._t("tooltip.duration", {}, "Duration"),
      view._t("tooltip.seconds", { value: node.rune_duration }, `${node.rune_duration} sec`)
    ]);
  }
  if (node.dice_group) statItems.push([view._t("tooltip.group", {}, "Group"), node.dice_group]);
  if (statItems.length === 0) return;

  const list = document.createElement("ul");
  list.className = "stat-compact-list";
  statItems.forEach(([label, value]) => {
    const item = document.createElement("li");
    item.className = "stat-compact-item";
    item.innerHTML = `<span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value)}</span>`;
    list.append(item);
  });
  container.append(list);
}

function createCostParts(gold, core, { includeZero = false, tight = false, wrapNumber = false } = {}) {
  const parts = [];
  const separator = tight ? "" : " ";
  const formatNumber = (value) => wrapNumber ? `<span class="sim-cost-num">${value.toLocaleString()}</span>` : value.toLocaleString();
  if (gold > 0) parts.push(`${SVG_ICONS.gold}${separator}${formatNumber(gold)}`);
  if (core > 0) parts.push(`${SVG_ICONS.core}${separator}${formatNumber(core)}`);
  if (parts.length === 0 && includeZero) parts.push('<span class="sim-cost-num">0</span>');
  return parts;
}

function totalRankCosts(goldCosts, coreCosts, rank, unlockGold, unlockCore) {
  let gold = 0;
  let core = 0;
  for (let index = 0; index < rank; index += 1) {
    gold += getRankCost(goldCosts, index, unlockGold);
    core += getRankCost(coreCosts, index, unlockCore);
  }
  return { gold, core };
}

function createCostContext(view, node, state) {
  const goldCosts = Array.isArray(node.gold_costs) ? node.gold_costs : [];
  const coreCosts = Array.isArray(node.core_costs) ? node.core_costs : [];
  return {
    node,
    state,
    goldCosts,
    coreCosts,
    unlockGold: goldCosts[0] ?? node.unlock_gold ?? 0,
    unlockCore: coreCosts[0] ?? node.unlock_core ?? 0,
    specialCondition: getUnlockConditionLabel(node),
    maxRank: Number(node.max_rank || node.max_level) || 1,
    isSimulation: Boolean(state?.simulation?.active),
    isInitial: isInitialSimulationNode(node)
      || (Array.isArray(state?.simulation?.initialIds) && state.simulation.initialIds.includes(String(node.id)))
      || Boolean(node.is_base),
    previewRank: view._browsePreviewRanks.get(String(node.id)) || 1
  };
}

function appendUnlockPath(view, metaBox, specialCondition) {
  if (!specialCondition) return;
  const line = document.createElement("div");
  line.className = "meta-line";
  line.innerHTML = `
    <span class="cost-label">${escapeHtml(view._t("simulation.unlockPath", {}, "Unlock path"))}</span>
    <span class="meta-cost" style="color: #ffd859; font-weight: 700;">${escapeHtml(specialCondition)}</span>
  `;
  metaBox.append(line);
}

function createSimulationActionButton(view, context, simEval, revokePlan, batchPlan) {
  const { node, unlockGold, unlockCore } = context;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "simulation-action-btn-styled";

  if (simEval.isSpecial) {
    button.classList.add("is-disabled", "is-special");
    button.disabled = true;
    button.innerHTML = `<span class="sim-btn-text">${escapeHtml(view._t("simulation.specialUnlock", {}, "Special unlock condition"))}</span>`;
  } else if (simEval.rank > 0) {
    button.classList.add("is-revoke");
    button.dataset.simAction = "revoke";
    button.dataset.simNodeId = String(node.id);
    const labelKey = revokePlan.isBatchRevoke ? "simulation.cancelToHere" : "simulation.cancelUnlock";
    const fallback = revokePlan.isBatchRevoke ? "Revoke to here" : "Revoke unlock";
    button.innerHTML = `<span class="sim-btn-text">${escapeHtml(view._t(labelKey, {}, fallback))}</span>`;
  } else if (simEval.rank === 0) {
    let costGold = unlockGold;
    let costCore = unlockCore;
    if (!simEval.canUnlock) {
      costGold = batchPlan.total?.gold || 0;
      costCore = batchPlan.total?.core || 0;
    }
    const costParts = createCostParts(costGold, costCore, { includeZero: true, tight: true, wrapNumber: true });
    if (simEval.canUnlock) {
      button.dataset.simAction = "unlock";
      button.dataset.simNodeId = String(node.id);
      button.innerHTML = `<span class="sim-btn-cost">${costParts.join(" ")}</span>`;
    } else if (batchPlan.ok && batchPlan.count > 0) {
      button.dataset.simAction = "batch";
      button.dataset.simNodeId = String(node.id);
      button.innerHTML = `
        <span class="sim-btn-cost">${costParts.join(" ")}</span>
        <span class="simulation-badge-slanted">${escapeHtml(view._t("simulation.unlockToHere", {}, "Unlock to here"))}</span>
      `;
    } else {
      button.classList.add("is-disabled");
      button.disabled = true;
      button.innerHTML = `<span class="sim-btn-text">${escapeHtml(view._t("simulation.cannotUnlock", {}, "Cannot unlock"))}</span>`;
    }
  }
  return button;
}

function createRankSliderShell(view, { currentRank, maxRank, titleKey, titleFallback, ariaKey, ariaFallback }) {
  const totalCostText = view._t("simulation.totalCost", {}, "Total cost");
  const title = view._t(titleKey, {}, titleFallback);
  const ariaLabel = view._t(ariaKey, {}, ariaFallback);
  const sliderWrap = document.createElement("div");
  sliderWrap.className = "rank-slider-wrap";
  sliderWrap.innerHTML = `
    <div class="slider-header">
      <span class="slider-title">${escapeHtml(title)}</span>
      <span class="slider-rank-display">${escapeHtml(view._t("simulation.rankDisplay", { rank: currentRank, max: maxRank }, `Rank ${currentRank} / ${maxRank}`))}</span>
    </div>
    <div class="slider-track-container">
      <input type="range" class="rank-slider-input" min="1" max="${maxRank}" value="${currentRank}" step="1" aria-label="${escapeHtml(ariaLabel)}" />
    </div>
    <div class="slider-cost-row">
      <span class="slider-cost-label">${escapeHtml(totalCostText)}</span>
      <span class="slider-cost-value">—</span>
    </div>
  `;
  return sliderWrap;
}

function setSliderCostText(costElement, gold, core) {
  if (!costElement) return;
  const parts = createCostParts(gold, core);
  costElement.innerHTML = parts.length > 0 ? parts.join(" ") : "—";
}

function refreshRankSliderSummary(view, options) {
  const { metaBox, node, rank, maxRank, goldCosts, coreCosts, unlockGold, unlockCore, updateSingleCost } = options;
  const rankDisplay = metaBox.querySelector(".slider-rank-display");
  if (rankDisplay) rankDisplay.textContent = view._t("simulation.rankDisplay", { rank, max: maxRank }, `Rank ${rank} / ${maxRank}`);

  const rankBadge = view.tooltipEl.querySelector("#tooltip-rank-badge, .rank-badge");
  if (rankBadge) rankBadge.textContent = `${rank}/${maxRank}`;

  const description = node.description_zh || node.desc;
  const copyEl = view.tooltipEl.querySelector(".detail-copy");
  if (copyEl && description) {
    copyEl.innerHTML = formatGameText(description, node.params || node, rank, { tagDefinitions: view.tagDefinitions });
  }

  const totals = totalRankCosts(goldCosts, coreCosts, rank, unlockGold, unlockCore);
  setSliderCostText(metaBox.querySelector(".slider-cost-value"), totals.gold, totals.core);
  if (!updateSingleCost) return;

  const metaLine = metaBox.querySelector(".meta-line-cost");
  if (!metaLine) return;
  const label = metaLine.querySelector(".cost-label");
  if (label) {
    const key = rank === 1 ? "simulation.unlockCost" : "simulation.upgradeCost";
    const fallback = rank === 1 ? "Unlock cost" : "Upgrade cost";
    label.textContent = view._t(key, {}, fallback);
  }
  const value = metaLine.querySelector(".meta-cost");
  const single = createCostParts(
    getRankCost(goldCosts, rank - 1, unlockGold),
    getRankCost(coreCosts, rank - 1, unlockCore)
  );
  if (value) value.innerHTML = single.length > 0 ? single.join(" ") : "—";
}

function appendSimulationRankSlider(view, metaBox, context, currentRank) {
  const sliderWrap = createRankSliderShell(view, {
    currentRank,
    maxRank: context.maxRank,
    titleKey: "simulation.unlockRankAdjust",
    titleFallback: "Adjust unlock rank",
    ariaKey: "simulation.unlockRankAdjust",
    ariaFallback: "Adjust unlock rank"
  });
  const sliderInput = sliderWrap.querySelector(".rank-slider-input");
  const initial = totalRankCosts(context.goldCosts, context.coreCosts, currentRank, context.unlockGold, context.unlockCore);
  setSliderCostText(sliderWrap.querySelector(".slider-cost-value"), initial.gold, initial.core);
  const pct = context.maxRank > 1 ? ((currentRank - 1) / (context.maxRank - 1)) * 100 : 0;
  sliderInput.style.setProperty("--slider-pct", `${pct}%`);
  metaBox.append(sliderWrap);
  view._attachElasticSlider(sliderInput, {
    maxRank: context.maxRank,
    onUpdate: (rank) => refreshRankSliderSummary(view, { ...context, metaBox, rank, updateSingleCost: false }),
    onCommit: (rank) => {
      if (view.store && typeof view.store.dispatch === "function") {
        view.store.dispatch({
          type: ActionTypes.SIMULATION_UNLOCK_NODE,
          payload: { nodeId: context.node.id, targetRank: rank }
        });
      }
    }
  });
}

function appendBrowseCostLine(view, metaBox, context) {
  const { previewRank, goldCosts, coreCosts, unlockGold, unlockCore } = context;
  const singleGold = getRankCost(goldCosts, previewRank - 1, unlockGold);
  const singleCore = getRankCost(coreCosts, previewRank - 1, unlockCore);
  if (!(singleGold > 0 || singleCore > 0 || unlockGold > 0 || unlockCore > 0)) return;

  const line = document.createElement("div");
  line.className = "meta-line meta-line-cost";
  const labelKey = previewRank === 1 ? "simulation.unlockCost" : "simulation.upgradeCost";
  const labelFallback = previewRank === 1 ? "Unlock cost" : "Upgrade cost";
  const parts = createCostParts(singleGold, singleCore);
  line.innerHTML = `<span class="cost-label">${view._t(labelKey, {}, labelFallback)}</span><span class="meta-cost">${parts.length > 0 ? parts.join(" ") : "—"}</span>`;
  metaBox.append(line);
}

function appendBrowseRankSlider(view, metaBox, context) {
  const sliderWrap = createRankSliderShell(view, {
    currentRank: context.previewRank,
    maxRank: context.maxRank,
    titleKey: "simulation.rankAdjust",
    titleFallback: "Rank adjustment",
    ariaKey: "simulation.previewRank",
    ariaFallback: "Adjust rank preview"
  });
  const sliderInput = sliderWrap.querySelector(".rank-slider-input");
  const initial = totalRankCosts(context.goldCosts, context.coreCosts, context.previewRank, context.unlockGold, context.unlockCore);
  setSliderCostText(sliderWrap.querySelector(".slider-cost-value"), initial.gold, initial.core);
  const initialPct = context.maxRank > 1 ? ((context.previewRank - 1) / (context.maxRank - 1)) * 100 : 0;
  sliderInput.style.setProperty("--slider-pct", `${initialPct}%`);
  metaBox.append(sliderWrap);
  view._attachElasticSlider(sliderInput, {
    maxRank: context.maxRank,
    onUpdate: (rank) => {
      view._browsePreviewRanks.set(String(context.node.id), rank);
      refreshRankSliderSummary(view, { ...context, metaBox, rank, updateSingleCost: true });
    },
    onCommit: () => view._triggerPopAnimation()
  });
}

function setBonusElement(element, display, active) {
  if (!element) return;
  element.textContent = display;
  element.hidden = !active;
}

function setCombinedBonusElement(element, bonus, view) {
  if (!element) return;
  const active = Boolean(bonus?.combinedBonus);
  element.textContent = bonus?.combinedDisplay || "";
  element.hidden = !active;
  element.dataset.powerupValue = bonus?.powerupBonus || "";
  element.dataset.dotValue = bonus?.dotBonus || "";
  element.dataset.bonusUnit = bonus?.unit || "";
  const label = element.dataset.bonusLabel || "";
  element.setAttribute(
    "aria-label",
    view._t("tooltip.bonusDetails", { label }, `View ${label} bonus details`)
  );
  if (!active) element.setAttribute("aria-expanded", "false");
}

function updateBonusPairElements(container, selectors, bonus, view) {
  const combinedActive = Boolean(bonus?.combinedBonus);
  setBonusElement(
    container.querySelector(selectors.powerup),
    bonus?.powerupDisplay || "",
    Boolean(bonus?.powerupBonus) && !combinedActive
  );
  setBonusElement(
    container.querySelector(selectors.dot),
    bonus?.dotDisplay || "",
    Boolean(bonus?.dotBonus) && !combinedActive
  );
  setCombinedBonusElement(container.querySelector(selectors.combined), bonus, view);
}

function updateSpecialBonusElements(container, specialStats, view) {
  container.querySelectorAll(".dice-stat-bonus-special-powerup").forEach((element) => {
    const index = Number.parseInt(element.dataset?.index, 10);
    const bonus = specialStats[index];
    setBonusElement(
      element,
      bonus?.powerupDisplay || "",
      Boolean(bonus?.powerupBonus) && !bonus?.combinedBonus
    );
  });
  container.querySelectorAll(".dice-stat-bonus-special-dot").forEach((element) => {
    const index = Number.parseInt(element.dataset?.index, 10);
    const bonus = specialStats[index];
    setBonusElement(
      element,
      bonus?.dotDisplay || "",
      Boolean(bonus?.dotBonus) && !bonus?.combinedBonus
    );
  });
  container.querySelectorAll(".dice-stat-bonus-special-combined").forEach((element) => {
    const index = Number.parseInt(element.dataset?.index, 10);
    setCombinedBonusElement(element, specialStats[index], view);
  });
}

function updateDiceBonusStats(view, container, bonusState) {
  updateBonusPairElements(
    container,
    {
      powerup: ".dice-stat-bonus-atk-powerup",
      dot: ".dice-stat-bonus-atk-dot",
      combined: ".dice-stat-bonus-atk-combined"
    },
    bonusState.attackBonus,
    view
  );
  updateBonusPairElements(
    container,
    {
      powerup: ".dice-stat-bonus-spd-powerup",
      dot: ".dice-stat-bonus-spd-dot",
      combined: ".dice-stat-bonus-spd-combined"
    },
    bonusState.intervalBonus,
    view
  );
  updateSpecialBonusElements(container, bonusState.specialStatsBonus, view);
}

function upgradeButtonLabels(view, buttons, bonusState) {
  const { powerupBtn, dotBtn } = buttons;
  const dotLabel = bonusState.dotIdx === 0
    ? view._t("tooltip.dot", {}, "Increase pips")
    : String(bonusState.dotIdx + 1);
  dotBtn.textContent = dotLabel;
  dotBtn.classList.toggle("is-active", bonusState.isDotActive);

  let powerupLabel = String(bonusState.powerupIdx + 1);
  if (bonusState.powerupIdx === 0) powerupLabel = view._t("tooltip.powerup", {}, "Power up");
  if (bonusState.powerupIdx >= POWERUP_LABELS.length - 1) powerupLabel = view._t("stats.max", {}, "Max");
  powerupBtn.textContent = powerupLabel;
  powerupBtn.classList.toggle("is-active", bonusState.isPowerupActive);
}

function applyUpgradeButtonState(view, buttons, node, container, powerupIdx, dotIdx) {
  const bonusState = calculateFullDiceBonus(node, powerupIdx, dotIdx);
  upgradeButtonLabels(view, buttons, bonusState);
  updateDiceBonusStats(view, container, bonusState);
}

/** Displays node details and handles tooltip interactions. */
export class TooltipView {
  /**
   * @param {object} dependencies
   * @param {import("../app/store/app_store.js").AppStore} dependencies.store
   * @param {import("../app/usecases/select_node.js").SelectNodeUseCase} dependencies.selectNodeUseCase
   * @param {import("../app/usecases/navigate_viewport.js").NavigateViewportUseCase} [dependencies.navigateViewportUseCase]
   * @param {HTMLElement} [dependencies.tooltipElement]
   * @param {Map<string, { x: number, y: number }>} [dependencies.nodePositions]
   * @param {Record<string, object>} [dependencies.tagDefinitions]
   * @param {import("../domain/localization.js").LocalizationService} [dependencies.localization]
   */
  constructor({ store, selectNodeUseCase, navigateViewportUseCase, tooltipElement, nodePositions = new Map(), tagDefinitions = {}, localization }) {
    this.store = store;
    this.selectNodeUseCase = selectNodeUseCase;
    this.navigateViewportUseCase = navigateViewportUseCase;
    this.tooltipEl = tooltipElement;
    this.nodePositions = nodePositions;
    this.tagDefinitions = tagDefinitions || {};
    this.localization = localization || null;

    this.tagPopoverEl = typeof document !== "undefined" ? document.getElementById("tag-popover") : null;
    this.tagPopoverBadge = typeof document !== "undefined" ? document.getElementById("tag-popover-badge") : null;
    this.tagPopoverDesc = typeof document !== "undefined" ? document.getElementById("tag-popover-desc") : null;
    this.statBonusPopoverEl = typeof document !== "undefined" ? document.getElementById("stat-bonus-popover") : null;
    this.statBonusPopoverBadge = typeof document !== "undefined" ? document.getElementById("stat-bonus-popover-badge") : null;
    this.statBonusPopoverDetails = typeof document !== "undefined" ? document.getElementById("stat-bonus-popover-details") : null;

    this.cachedTipWidth = 440;
    this.cachedTipHeight = 320;

    this._closeTimer = null;
    this._enterTimer = null;
    this._switchTimer = null;
    this._unsubscribe = null;
    this._currentNodeId = null;
    this._closingNodeId = null;
    this._tagPopoverKey = null;
    this._bonusPopoverTarget = null;
    this._initialized = false;
    this._lastRenderedSimState = null;
    this._contentNeedsRender = false;
    this._browsePreviewRanks = new Map();
    this._boundTooltipClick = (event) => this._handleClick(event);
    this._boundWindowClick = (event) => {
      const target = event.target;
      if (!target?.closest?.("#tag-popover") && !target?.closest?.(".tooltip-hashtag-chip")) {
        this.hideTagPopover();
      }
      if (!target?.closest?.("#stat-bonus-popover") && !target?.closest?.(".stat-bonus-combined")) {
        this.hideBonusPopover();
      }
    };
    this._boundWindowKeydown = (event) => {
      if (event.key !== "Escape" || !this.statBonusPopoverEl || this.statBonusPopoverEl.hidden) return;
      event.preventDefault?.();
      this.hideBonusPopover(true);
    };
  }

  _t(key, values = {}, fallback = "") {
    return this.localization?.t?.(key, values, fallback) || fallback || key;
  }

  /**
   * Initialize tooltip listeners and subscribe to store updates.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    if (this.tooltipEl && typeof this.tooltipEl.addEventListener === "function") {
      this.tooltipEl.addEventListener("click", this._boundTooltipClick);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("click", this._boundWindowClick);
      window.addEventListener("keydown", this._boundWindowKeydown);
    }
    this._boundViewportDrag = () => {
      if (this.store && this.selectNodeUseCase) {
        const currentSelectedId = this.store.getState()?.selectedNodeId;
        if (currentSelectedId) {
          this.selectNodeUseCase.execute(null);
        }
      }
    };
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("rd2:viewport-drag", this._boundViewportDrag);
    }
    this._unsubscribe = this.store.subscribe((state) => this.render(state));
  }

  _handleClick(e) {
    // 1. Combined stat bonus details
    const combinedBonus = e.target.closest(".stat-bonus-combined");
    if (combinedBonus) {
      e.stopPropagation();
      this.showBonusPopover(combinedBonus);
      return;
    }

    // 2. Prerequisite jump pill
    const pill = e.target.closest(".node-link-pill, .prereq-pill, [data-target-id], [data-prereq-id]");
    if (pill) {
      const targetId = pill.dataset.targetId || pill.dataset.prereqId;
      if (targetId) {
        e.stopPropagation();
        const pos = this.nodePositions.get(String(targetId));
        this.selectNodeUseCase.execute(targetId, {
          point: pos,
          nodePositions: this.nodePositions
        });
        if (this.navigateViewportUseCase) {
          this.navigateViewportUseCase.centerOnNodeForTooltip(targetId, false);
        }
      }
    }

    // 3. Hashtag chip
    const hashtagChip = e.target.closest(".tooltip-hashtag-chip, [data-tag-key]");
    if (hashtagChip) {
      e.stopPropagation();
      const tagKey = hashtagChip.dataset.tagKey;
      this.showTagPopover(tagKey, hashtagChip);
    }

    // Simulation action buttons bubble to SimulationView, which owns the
    // confirmation and focus lifecycle for unlock operations.
  }

  _triggerPopAnimation() {
    if (!this.tooltipEl) return;

    // 1. 等級徽章 (整個容器一起彈跳變大、平滑縮小)
    const rankBadge = this.tooltipEl.querySelector("#tooltip-rank-badge, .rank-badge");
    if (rankBadge && !rankBadge.hidden) {
      rankBadge.classList.remove("is-popping");
      if (typeof rankBadge.offsetWidth === "number") forceReflow(rankBadge);
      rankBadge.classList.add("is-popping");
      rankBadge.addEventListener("animationend", () => rankBadge.classList.remove("is-popping"), { once: true });
    }

    // 2. 說明文字整塊彈跳
    const copyEl = this.tooltipEl.querySelector(".detail-copy");
    if (copyEl) {
      copyEl.classList.remove("is-popping");
      if (typeof copyEl.offsetWidth === "number") forceReflow(copyEl);
      copyEl.classList.add("is-popping");
      copyEl.addEventListener("animationend", () => copyEl.classList.remove("is-popping"), { once: true });
    }

    // 3. 滑桿當前階級數字
    const rankCurEl = this.tooltipEl.querySelector(".slider-rank-current");
    if (rankCurEl) {
      rankCurEl.classList.remove("is-popping");
      if (typeof rankCurEl.offsetWidth === "number") forceReflow(rankCurEl);
      rankCurEl.classList.add("is-popping");
      rankCurEl.addEventListener("animationend", () => rankCurEl.classList.remove("is-popping"), { once: true });
    }
  }

  _didSimulationRankChange(previousSimulation, nextSimulation, nodeId) {
    if (!previousSimulation || !nextSimulation?.active) return false;
    if (previousSimulation.active !== nextSimulation.active) return false;
    return getRank(previousSimulation, nodeId) !== getRank(nextSimulation, nodeId);
  }

  showTagPopover(tagKey, targetEl) {
    if (!this.tagPopoverEl || !tagKey || !targetEl) return;
    this.hideBonusPopover();
    this._tagPopoverKey = String(tagKey);
    this._renderTagPopoverContent();

    this.tagPopoverEl.hidden = false;
    this.tagPopoverEl.setAttribute("aria-hidden", "false");

    const rect = targetEl.getBoundingClientRect();
    const popWidth = Math.min(280, window.innerWidth - 32);
    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - popWidth / 2;

    if (left < 16) left = 16;
    if (left + popWidth > window.innerWidth - 16) {
      left = window.innerWidth - 16 - popWidth;
    }
    if (top + 110 > window.innerHeight) {
      top = rect.top - 100;
    }

    this.tagPopoverEl.style.left = `${Math.round(left)}px`;
    this.tagPopoverEl.style.top = `${Math.round(top)}px`;
  }

  showBonusPopover(targetEl) {
    if (!this.statBonusPopoverEl || !targetEl || typeof window === "undefined") return;
    this.hideTagPopover();
    this._bonusPopoverTarget = targetEl;
    this._renderBonusPopoverContent();

    this.statBonusPopoverEl.hidden = false;
    this.statBonusPopoverEl.setAttribute("aria-hidden", "false");
    targetEl.setAttribute("aria-expanded", "true");

    const rect = targetEl.getBoundingClientRect();
    const popWidth = Math.min(240, window.innerWidth - 32);
    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - popWidth / 2;

    if (left < 16) left = 16;
    if (left + popWidth > window.innerWidth - 16) {
      left = window.innerWidth - 16 - popWidth;
    }
    if (top + 120 > window.innerHeight) {
      top = rect.top - 128;
    }
    if (top < 16) top = 16;

    this.statBonusPopoverEl.style.left = `${Math.round(left)}px`;
    this.statBonusPopoverEl.style.top = `${Math.round(top)}px`;
  }

  setLocalization(localization, tagDefinitions = this.tagDefinitions) {
    this.localization = localization || null;
    this.tagDefinitions = tagDefinitions || {};
    this._contentNeedsRender = true;
    const state = this.store?.getState?.();
    if (state) this.render(state);
    if (this.tagPopoverEl && !this.tagPopoverEl.hidden) this._renderTagPopoverContent();
    if (this.statBonusPopoverEl && !this.statBonusPopoverEl.hidden) this._renderBonusPopoverContent();
  }

  _renderTagPopoverContent() {
    if (!this._tagPopoverKey) return;
    const tDef = this.tagDefinitions?.[this._tagPopoverKey];
    if (this.tagPopoverBadge) this.tagPopoverBadge.textContent = `#${tDef?.name_zh || this._tagPopoverKey}`;
    if (this.tagPopoverDesc) {
      const description = tDef?.desc_zh || this._t("tooltip.tagFallback", {}, "No detailed mechanics are available.");
      this.tagPopoverDesc.innerHTML = formatGameText(description, null, 1, { tagDefinitions: this.tagDefinitions });
    }
  }

  _renderBonusPopoverContent() {
    const targetEl = this._bonusPopoverTarget;
    if (!targetEl) return;

    const label = targetEl.dataset?.bonusLabel || this._t("stats.special", {}, "Special stat");
    if (this.statBonusPopoverBadge) this.statBonusPopoverBadge.textContent = `#${label}`;
    if (!this.statBonusPopoverDetails || typeof document === "undefined") return;

    this.statBonusPopoverDetails.textContent = "";
    const unit = targetEl.dataset?.bonusUnit || "";
    const rows = [
      [this._t("tooltip.powerup", {}, "Power up"), targetEl.dataset?.powerupValue, "is-gold"],
      [this._t("tooltip.dot", {}, "Increase pips"), targetEl.dataset?.dotValue, "is-purple"]
    ].filter(([, value]) => value);

    rows.forEach(([labelText, value, valueClass]) => {
      const row = document.createElement("div");
      row.className = "stat-bonus-detail-row";
      const rowLabel = document.createElement("span");
      rowLabel.className = "stat-bonus-detail-label";
      rowLabel.textContent = labelText;
      const rowValue = document.createElement("strong");
      rowValue.className = `stat-bonus-detail-value ${valueClass}`;
      rowValue.textContent = `${value}${unit}`;
      row.append(rowLabel, rowValue);
      this.statBonusPopoverDetails.append(row);
    });
  }

  hideTagPopover() {
    if (!this.tagPopoverEl || this.tagPopoverEl.hidden) return;
    this._tagPopoverKey = null;
    this.tagPopoverEl.hidden = true;
    this.tagPopoverEl.setAttribute("aria-hidden", "true");
  }

  hideBonusPopover(restoreFocus = false) {
    const targetEl = this._bonusPopoverTarget;
    if (targetEl) targetEl.setAttribute("aria-expanded", "false");
    this._bonusPopoverTarget = null;

    if (this.statBonusPopoverDetails) this.statBonusPopoverDetails.textContent = "";
    if (this.statBonusPopoverEl) {
      this.statBonusPopoverEl.hidden = true;
      this.statBonusPopoverEl.setAttribute("aria-hidden", "true");
    }
    if (restoreFocus && typeof targetEl?.focus === "function") targetEl.focus();
  }

  /**
   * Close tooltip with smooth exit transition.
   * @param {boolean} [immediate]
   */
  close(immediate = false) {
    if (!this.tooltipEl) return;
    this.hideTagPopover();
    this.hideBonusPopover();
    this._browsePreviewRanks.clear();
    if (this._enterTimer) { clearTimeout(this._enterTimer); this._enterTimer = null; }
    if (this._switchTimer) { clearTimeout(this._switchTimer); this._switchTimer = null; }

    if (immediate) {
      if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
      this.tooltipEl.hidden = true;
      removeClass(this.tooltipEl, "is-visible", "is-active", "is-closing", "is-entering");
      if (typeof document !== "undefined") {
        document.body?.classList?.remove("has-active-tooltip");
      }
      if (typeof this.tooltipEl.setAttribute === "function") {
        this.tooltipEl.setAttribute("aria-hidden", "true");
      }
      this._currentNodeId = null;
      this._closingNodeId = null;
      return;
    }

    const isActive = hasClass(this.tooltipEl, "is-active") || !this.tooltipEl.hidden;
    if (this.tooltipEl.hidden && !isActive) {
      return;
    }

    if (!this._closingNodeId) {
      this._closingNodeId = this._currentNodeId;
    }

    removeClass(this.tooltipEl, "is-entering");
    addClass(this.tooltipEl, "is-closing");
    if (typeof document !== "undefined") {
      document.body?.classList?.remove("has-active-tooltip");
    }
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      this.tooltipEl.hidden = true;
      removeClass(this.tooltipEl, "is-visible", "is-active", "is-closing", "is-entering");
      if (typeof this.tooltipEl.setAttribute === "function") {
        this.tooltipEl.setAttribute("aria-hidden", "true");
      }
      this._currentNodeId = null;
      this._closingNodeId = null;
      this._closeTimer = null;
    }, 140);
  }

  /**
   * Render tooltip DOM and adjust placement.
   * @param {object} state
   */
  render(state) {
    if (!this.tooltipEl) return;
    const { selectedNodeId, selectedNode } = state;
    if (!selectedNodeId || !selectedNode) {
      this._closeWithoutSelection(state);
      return;
    }
    if (this._updateActiveSelection(state, selectedNodeId, selectedNode)) return;
    this._prepareSelectionTransition(state, selectedNodeId, selectedNode);
  }

  _closeWithoutSelection(state) {
    if (!this._currentNodeId && this.tooltipEl.hidden) return;
    if (!this._closingNodeId) this._closingNodeId = this._currentNodeId;
    this.close(false);
    if (this._closingNodeId) this._positionTooltip(this._closingNodeId, state);
  }

  _updateActiveSelection(state, selectedNodeId, selectedNode) {
    if (this._currentNodeId !== selectedNodeId) return false;
    if (this._switchTimer || this._enterTimer || this._closeTimer) {
      const targetId = this._closingNodeId || selectedNodeId;
      if (targetId) this._positionTooltip(targetId, state);
      return true;
    }
    const isActive = !this.tooltipEl.hidden && hasClass(this.tooltipEl, "is-active") && !hasClass(this.tooltipEl, "is-closing");
    if (!isActive) return false;
    const previousSimulation = this._lastRenderedSimState;
    if (this._contentNeedsRender || state.simulation !== this._lastRenderedSimState) {
      this._contentNeedsRender = false;
      this._lastRenderedSimState = state.simulation;
      this._renderFullContent(selectedNode, state);
      if (this._didSimulationRankChange(previousSimulation, state.simulation, selectedNodeId)) this._triggerPopAnimation();
    }
    this._positionTooltip(selectedNodeId, state);
    return true;
  }

  _prepareSelectionTransition(state, selectedNodeId, selectedNode) {
    this.hideTagPopover();
    this.hideBonusPopover();
    if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
    if (this._enterTimer) { clearTimeout(this._enterTimer); this._enterTimer = null; }
    if (this._switchTimer) { clearTimeout(this._switchTimer); this._switchTimer = null; }

    const oldSelectedId = this._currentNodeId;
    this._currentNodeId = selectedNodeId;
    this._lastRenderedSimState = state.simulation;
    if (oldSelectedId !== selectedNodeId) this._browsePreviewRanks.clear();

    if (typeof window === "undefined") {
      this._enterTooltip(selectedNodeId, selectedNode, state);
      return;
    }
    const isCurrentlyActive = !this.tooltipEl.hidden && hasClass(this.tooltipEl, "is-active") && !hasClass(this.tooltipEl, "is-closing");
    if (isCurrentlyActive && oldSelectedId && oldSelectedId !== selectedNodeId) {
      this._switchTooltipSelection(oldSelectedId, selectedNodeId, selectedNode, state);
      return;
    }
    this.tooltipEl.hidden = true;
    this._closingNodeId = null;
    this._enterTimer = setTimeout(() => {
      this._enterTooltip(selectedNodeId, selectedNode, state);
      this._enterTimer = null;
    }, 180);
  }

  _enterTooltip(selectedNodeId, selectedNode, state) {
    this._contentNeedsRender = false;
    this._renderFullContent(selectedNode, state);
    removeClass(this.tooltipEl, "is-closing");
    this.tooltipEl.hidden = false;
    if (typeof document !== "undefined") document.body?.classList?.add("has-active-tooltip");
    if (typeof this.tooltipEl.setAttribute === "function") this.tooltipEl.setAttribute("aria-hidden", "false");
    removeClass(this.tooltipEl, "is-active", "is-entering");
    this._positionTooltip(selectedNodeId, state);
    if (typeof this.tooltipEl.offsetWidth === "number") forceReflow(this.tooltipEl);
    addClass(this.tooltipEl, "is-visible", "is-active", "is-entering");
    if (typeof window === "undefined") {
      removeClass(this.tooltipEl, "is-entering");
      return;
    }
    this._switchTimer = setTimeout(() => {
      removeClass(this.tooltipEl, "is-entering");
      this._switchTimer = null;
    }, 260);
  }

  _switchTooltipSelection(oldSelectedId, selectedNodeId, selectedNode, state) {
    this._closingNodeId = oldSelectedId;
    removeClass(this.tooltipEl, "is-entering");
    addClass(this.tooltipEl, "is-closing");
    this._positionTooltip(this._closingNodeId, state);
    this._switchTimer = setTimeout(() => {
      this.tooltipEl.hidden = true;
      this._closingNodeId = null;
      removeClass(this.tooltipEl, "is-closing", "is-active", "is-visible");
      this._switchTimer = null;
      this._enterTimer = setTimeout(() => {
        this._enterTooltip(selectedNodeId, selectedNode, state);
        this._enterTimer = null;
      }, 80);
    }, 130);
  }

  /**
   * Destroy tooltip view instance and clean up listeners.
   */
  destroy() {
    if (typeof document !== "undefined") {
      document.body?.classList?.remove("has-active-tooltip");
    }
    this.hideBonusPopover();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._closeTimer) clearTimeout(this._closeTimer);
    if (this._enterTimer) clearTimeout(this._enterTimer);
    if (this._switchTimer) clearTimeout(this._switchTimer);
    if (this.tooltipEl && typeof this.tooltipEl.removeEventListener === "function") {
      this.tooltipEl.removeEventListener("click", this._boundTooltipClick);
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("click", this._boundWindowClick);
      window.removeEventListener("keydown", this._boundWindowKeydown);
    }
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("rd2:viewport-drag", this._boundViewportDrag);
    }
    this._initialized = false;
  }

  _positionTooltip(selectedNodeId, state) {
    const pos = this.nodePositions.get(String(selectedNodeId));
    const node = state.nodesMap?.get(String(selectedNodeId)) || state.selectedNode;
    const isBelow = this._resolveTooltipPlacement(selectedNodeId, state, pos);

    this.tooltipEl.classList.toggle("is-placed-below", isBelow);
    if (!pos || typeof window === "undefined") return;
    this._applyTooltipScreenPosition(pos, node, state, isBelow);
  }

  _resolveTooltipPlacement(selectedNodeId, state, pos) {
    const classList = this.tooltipEl.classList;
    const hasContains = typeof classList?.contains === "function";
    const isClosing = hasContains ? classList.contains("is-closing") : Boolean(classList?.has?.("is-closing"));
    const isCurrentlyBelow = hasContains ? classList.contains("is-placed-below") : Boolean(classList?.has?.("is-placed-below"));
    if (isClosing) return isCurrentlyBelow;
    return shouldPlaceTooltipBelow({
      nodeId: selectedNodeId,
      pt: pos,
      activePrereqNodeIds: state.showPrereqMode ? state.activePrereqIds : null,
      nodePositions: this.nodePositions
    });
  }

  _applyTooltipScreenPosition(pos, node, state, isBelow) {
    const isMobile = window.innerWidth <= 768;
    const viewport = state.viewport || { scale: 1.0, x: 0, y: 0 };
    const scale = viewport.scale || 1.0;
    const screenX = (viewport.x || 0) + pos.x * scale;
    const screenY = (viewport.y || 0) + pos.y * scale;
    const isLarge = node && ((node.node_type || node.type) === "DICE" || (node.node_type || node.type) === "PERK");
    const nodeRadius = (isLarge ? 52 : 36) * scale;
    const gap = isMobile ? 16 : 14;
    const dimensions = this._readTooltipDimensions(isMobile);
    const rawTop = isBelow
      ? screenY + nodeRadius + gap
      : screenY - nodeRadius - dimensions.height - gap;
    const padding = isMobile ? 12 : 16;
    const maxLeft = Math.max(padding, window.innerWidth - dimensions.width - padding);
    const maxTop = Math.max(padding, window.innerHeight - dimensions.height - padding);
    const left = Math.min(maxLeft, Math.max(padding, screenX - dimensions.width / 2));
    const top = Math.min(maxTop, Math.max(padding, rawTop));
    const roundedLeft = Math.round(left);
    this.tooltipEl.style.left = `${roundedLeft}px`;
    this.tooltipEl.style.top = `${Math.round(top)}px`;
    if (typeof this.tooltipEl.style?.setProperty === "function") {
      const computedStyle = typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(this.tooltipEl)
        : null;
      const borderLeft = Number.parseFloat(computedStyle?.borderLeftWidth || "0") || 0;
      const borderRight = Number.parseFloat(computedStyle?.borderRightWidth || "0") || 0;
      const arrowInset = 14;
      const innerWidth = Math.max(arrowInset * 2, dimensions.width - borderLeft - borderRight);
      const arrowX = Math.min(
        Math.max(screenX - roundedLeft - borderLeft, arrowInset),
        innerWidth - arrowInset
      );
      this.tooltipEl.style.setProperty("--tooltip-arrow-x", `${Math.round(arrowX)}px`);
    }
  }

  _readTooltipDimensions(isMobile) {
    if (this.tooltipEl.offsetHeight) this.cachedTipHeight = this.tooltipEl.offsetHeight;
    if (this.tooltipEl.offsetWidth) this.cachedTipWidth = this.tooltipEl.offsetWidth;
    return {
      width: this.cachedTipWidth || (isMobile ? Math.min(385, window.innerWidth - 24) : 440),
      height: this.cachedTipHeight || 320
    };
  }

  _renderFullContent(node, state) {
    const context = this._getNodeRenderContext(node, state);
    this._renderNodeHeader(node, context);
    this._renderNodeIcon(node);
    this._renderNodePanels(node, state, context.currentDisplayRank);
  }

  _getNodeRenderContext(node, state) {
    const faction = FACTION_DATA[node.faction || node.branch] || FACTION_DATA[1];
    const rawType = String(node.node_type || node.type || "").toLowerCase();
    const typeKey = rawType === "player_passive" ? "passive" : rawType;
    const type = this._t(`node.type.${typeKey}`, {}, NODE_TYPE_NAMES[node.node_type || node.type] || this._t("tooltip.nodeFallback", {}, "Node"));
    const factionKey = String(node.faction || node.branch || "");
    const isSimulation = Boolean(state?.simulation?.active);
    const simRank = isSimulation ? (state.simulation.ranks?.[String(node.id)] || 0) : 0;
    const browseRank = this._browsePreviewRanks.get(String(node.id)) || 1;
    return {
      faction,
      type,
      branchName: this._t(`faction.${factionKey}`, {}, faction.name),
      maxRank: Number(node.max_rank || node.max_level) || 1,
      isDice: (node.node_type || node.type) === "DICE",
      currentDisplayRank: isSimulation ? Math.max(1, simRank) : browseRank
    };
  }

  _renderNodeHeader(node, context) {
    const { faction, type, branchName, maxRank, isDice, currentDisplayRank } = context;
    this.tooltipEl.classList.toggle("is-dice-node", isDice);
    this.tooltipEl.classList.toggle("is-non-dice", !isDice);
    if (typeof this.tooltipEl.style?.setProperty === "function") {
      this.tooltipEl.style.setProperty("--node-faction", faction.color);
      this.tooltipEl.style.setProperty("--node-faction-surface", faction.surface);
      this.tooltipEl.style.setProperty("--node-faction-border", faction.border);
      this.tooltipEl.style.setProperty("--node-faction-ink", faction.ink);
    }
    const title = this.tooltipEl.querySelector("#tooltip-title, .tooltip-title, #tooltip-node-name");
    if (title) title.textContent = node.name_zh || node.name || this._t("tooltip.nodeFallback", {}, "Unnamed node");
    const branchBadge = this.tooltipEl.querySelector("#tooltip-branch-badge, .branch-badge");
    if (branchBadge) branchBadge.textContent = branchName;
    const typeBadge = this.tooltipEl.querySelector("#tooltip-type-badge, .type-badge");
    if (typeBadge) typeBadge.textContent = type;
    this._renderRankBadge(maxRank, currentDisplayRank);
  }

  _renderRankBadge(maxRank, currentDisplayRank) {
    const rankBadge = this.tooltipEl.querySelector("#tooltip-rank-badge, .rank-badge");
    if (!rankBadge) return;
    const hasRanks = maxRank > 1;
    rankBadge.hidden = !hasRanks;
    rankBadge.style.display = hasRanks ? "" : "none";
    if (hasRanks) rankBadge.textContent = `${currentDisplayRank}/${maxRank}`;
  }

  _renderNodeIcon(node) {
    const diceVisual = this.tooltipEl.querySelector("#tooltip-dice-visual, .tooltip-dice-visual");
    const diceImg = this.tooltipEl.querySelector("#tooltip-dice-img, .tooltip-dice-img");
    if (!diceImg) return;
    const iconFilename = resolveNode3Icon(node);
    const hasIcon = Boolean(iconFilename);
    diceImg.src = hasIcon ? `icons/${iconFilename}` : "";
    diceImg.alt = node.name_zh || node.name || this._t("tooltip.diceIcon", {}, "Dice icon");
    diceImg.hidden = !hasIcon;
    if (diceVisual) diceVisual.style.display = hasIcon ? "" : "none";
  }

  _renderNodePanels(node, state, currentRank) {
    const body = this.tooltipEl.querySelector("#tooltip-body, .tooltip-body");
    if (body) {
      body.innerHTML = "";
      this._buildBodyHtml(body, node, state, currentRank);
      installImageFallbacks(body);
    }
    const costPanel = this.tooltipEl.querySelector("#tooltip-cost-panel, .tooltip-cost-panel");
    if (costPanel) {
      costPanel.innerHTML = "";
      this._buildCostPanel(costPanel, node, state);
    }
  }

  _buildBodyHtml(container, node, state, currentRank = 1) {
    appendDescriptionSection(this, container, node, currentRank);
    appendAwakeningSection(this, container, node, currentRank);
    if ((node.node_type || node.type) === "DICE") {
      appendDiceStats(this, container, node);
      return;
    }
    appendCompactStats(this, container, node);
  }

  _buildCostPanel(container, node, state) {
    container.innerHTML = "";
    const context = createCostContext(this, node, state);
    const metaBox = document.createElement("div");
    metaBox.className = "tooltip-meta-box";
    if (context.isSimulation) this._renderSimulationCostPanel(metaBox, context);
    else this._renderBrowseCostPanel(metaBox, context);
    if (metaBox.childNodes.length > 0) {
      container.append(metaBox);
      container.hidden = false;
      container.style.display = "";
    } else {
      container.hidden = true;
      container.style.display = "none";
    }
  }

  _renderSimulationCostPanel(metaBox, context) {
    const { node, state } = context;
    appendUnlockPath(this, metaBox, context.specialCondition);
    const simEval = evaluateNode(node.id, state.simulation, state.nodesMap);
    if (!context.isInitial) {
      const actionButton = createSimulationActionButton(
        this,
        context,
        simEval,
        planRevokeNode(node.id, state.simulation, state.nodesMap),
        planBatchUnlock(node.id, state.simulation, state.nodesMap)
      );
      metaBox.append(actionButton);
    }
    if (context.maxRank > 1 && simEval.rank > 0) {
      const currentRank = Math.max(1, Math.min(context.maxRank, simEval.rank));
      appendSimulationRankSlider(this, metaBox, context, currentRank);
    }
  }

  _renderBrowseCostPanel(metaBox, context) {
    appendUnlockPath(this, metaBox, context.specialCondition);
    appendBrowseCostLine(this, metaBox, context);
    if (context.maxRank > 1) appendBrowseRankSlider(this, metaBox, context);
  }

  _bindUpgradeButtons(btnRow, node, container) {
    const powerupBtn = btnRow.querySelector(".btn-powerup");
    const dotBtn = btnRow.querySelector(".btn-dot");
    if (!powerupBtn || !dotBtn) return;

    let dotIdx = 0;
    let powerupIdx = 0;
    const buttons = { powerupBtn, dotBtn };
    const updateStats = () => applyUpgradeButtonState(this, buttons, node, container, powerupIdx, dotIdx);

    powerupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      powerupIdx = (powerupIdx + 1) % POWERUP_LABELS.length;
      updateStats();
    });

    dotBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dotIdx = (dotIdx + 1) % DOT_LABELS.length;
      updateStats();
    });
  }

  _attachElasticSlider(sliderInput, { maxRank = 50, onUpdate, onCommit } = {}) {
    if (!sliderInput) return;
    const gesture = { isDragging: false, activePointerId: null };
    const updateSliderUI = (rank, pct, overshootX = 0) => {
      sliderInput.value = String(rank);
      if (typeof sliderInput.style?.setProperty === "function") {
        sliderInput.style.setProperty("--slider-pct", `${pct}%`);
        sliderInput.style.setProperty("--overshoot-x", overshootX ? `${overshootX.toFixed(2)}px` : "0px");
      }
      if (typeof onUpdate === "function") onUpdate(rank, pct, overshootX);
    };
    const handlePointerMove = (event) => this._handleElasticSliderMove(sliderInput, gesture, maxRank, event, updateSliderUI);
    const handlePointerDown = (event) => this._beginElasticSliderDrag(sliderInput, gesture, event, handlePointerMove);
    const handlePointerUp = () => this._finishElasticSliderDrag(sliderInput, gesture, maxRank, updateSliderUI, onCommit);

    sliderInput.addEventListener("pointerdown", handlePointerDown);
    sliderInput.addEventListener("pointermove", handlePointerMove);
    sliderInput.addEventListener("pointerup", handlePointerUp);
    sliderInput.addEventListener("pointercancel", handlePointerUp);
    sliderInput.addEventListener("input", (event) => {
      const rank = this._readElasticSliderRank(event.target, maxRank);
      const pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
      updateSliderUI(rank, pct, 0);
    });
    sliderInput.addEventListener("change", (event) => {
      const rank = this._readElasticSliderRank(event.target, maxRank);
      if (typeof onCommit === "function") onCommit(rank);
    });
  }

  _handleElasticSliderMove(sliderInput, gesture, maxRank, event, updateSliderUI) {
    if (!gesture.isDragging || (gesture.activePointerId !== null && event.pointerId !== gesture.activePointerId)) return;
    const rect = sliderInput.getBoundingClientRect();
    if (!rect.width) return;
    const rawOffset = event.clientX - rect.left;
    const progress = rawOffset / rect.width;
    if (progress < 0) {
      const overshootX = -(Math.abs(rawOffset) * 26) / (Math.abs(rawOffset) + 48);
      updateSliderUI(1, 0, overshootX);
      return;
    }
    if (progress > 1) {
      const deltaX = rawOffset - rect.width;
      const overshootX = (deltaX * 26) / (deltaX + 48);
      updateSliderUI(maxRank, 100, overshootX);
      return;
    }
    const rank = Math.max(1, Math.min(maxRank, Math.round(1 + progress * (maxRank - 1))));
    const pct = maxRank > 1 ? ((rank - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(rank, pct, 0);
  }

  _beginElasticSliderDrag(sliderInput, gesture, event, handlePointerMove) {
    if (event.button !== 0) return;
    gesture.isDragging = true;
    gesture.activePointerId = event.pointerId;
    sliderInput.classList.add("is-dragging");
    sliderInput.classList.remove("is-springing");
    this._clearSliderPopState();
    try {
      sliderInput.setPointerCapture(gesture.activePointerId);
    } catch (_) {
      // Pointer capture is unavailable in the lightweight test DOM.
    }
    handlePointerMove(event);
  }

  _clearSliderPopState() {
    const selectors = [".detail-copy", "#tooltip-rank-badge, .rank-badge", ".slider-rank-current"];
    selectors.forEach((selector) => this.tooltipEl?.querySelector(selector)?.classList?.remove("is-popping"));
  }

  _finishElasticSliderDrag(sliderInput, gesture, maxRank, updateSliderUI, onCommit) {
    if (!gesture.isDragging) return;
    gesture.isDragging = false;
    try {
      if (gesture.activePointerId !== null) sliderInput.releasePointerCapture(gesture.activePointerId);
    } catch (_) {
      // Pointer capture may already have been released by the browser.
    }
    gesture.activePointerId = null;
    sliderInput.classList.remove("is-dragging");
    sliderInput.classList.add("is-springing");
    const currentRank = this._readElasticSliderRank(sliderInput, maxRank);
    const targetPct = maxRank > 1 ? ((currentRank - 1) / (maxRank - 1)) * 100 : 0;
    updateSliderUI(currentRank, targetPct, 0);
    if (typeof onCommit === "function") onCommit(currentRank);
    setTimeout(() => sliderInput.classList.remove("is-springing"), 380);
  }

  _readElasticSliderRank(sliderInput, maxRank) {
    return Math.max(1, Math.min(maxRank, Number.parseInt(sliderInput.value, 10) || 1));
  }

  _updateDynamicValues(node, state) {
    // Keep dynamic values synced
  }

}
